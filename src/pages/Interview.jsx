import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import VoiceRecorder from "../components/VoiceRecorder";
import VideoCallInterface from "../components/VideoCallInterface";

const TOTAL_QUESTIONS = 5;

export default function Interview() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const interviewId = urlParams.get("id");

  const [interview, setInterview] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [startTime] = useState(Date.now());
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const questionGeneratedRef = useRef(false);

  useEffect(() => {
    if (!interviewId) { navigate("/setup"); return; }
    base44.entities.Interview.get(interviewId).then(data => {
      setInterview(data);
      generateQuestion(data, 0);
    });
  }, [interviewId]);

  const speakQuestion = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.95;
      utt.pitch = 1;
      setIsBotSpeaking(true);
      utt.onend = () => setIsBotSpeaking(false);
      utt.onerror = () => setIsBotSpeaking(false);
      window.speechSynthesis.speak(utt);
    }
  };

  const generateQuestion = async (interviewData, qIdx) => {
    setIsGenerating(true);
    const previousQs = answers.map(a => a.question).join("\n- ");
    const prompt = `You are an expert interview coach. Generate exactly 1 interview question for:
- Role: ${interviewData.role_title}
- Company: ${interviewData.company}
- Experience Level: ${interviewData.experience_level}
- Interview Type: ${interviewData.interview_type}
- Industry: ${interviewData.industry || "General"}
- Question number: ${qIdx + 1} of ${TOTAL_QUESTIONS}
${previousQs ? `\nPrevious questions (DO NOT REPEAT):\n- ${previousQs}` : ""}
${interviewData.interview_type === "behavioral" ? "Ask a behavioral/situational question using STAR format." : ""}
${interviewData.interview_type === "technical" ? "Ask a role-specific technical question." : ""}
${interviewData.interview_type === "mixed" ? `Ask a ${qIdx % 2 === 0 ? "behavioral" : "technical"} question.` : ""}
Return ONLY the question text, nothing else.`;

    const question = await base44.integrations.Core.InvokeLLM({ prompt });
    setCurrentQuestion(question);
    setIsGenerating(false);
    // Auto-speak for video/audio modes
    if (interviewData.interview_mode !== "chat") {
      setTimeout(() => speakQuestion(question), 400);
    }
  };

  const handleAnswer = async (transcript) => {
    setIsUserSpeaking(false);
    setIsProcessing(true);
    const isVideoMode = interview?.interview_mode === "video";

    const prompt = `You are an expert interview evaluator. Score this interview answer.
Question: "${currentQuestion}"
Answer: "${transcript}"
Role: ${interview.role_title} at ${interview.company}
Experience Level: ${interview.experience_level}
Interview Mode: ${interview.interview_mode}

Score on these dimensions (0-100 each):
1. answer_quality: Relevance, depth, examples, STAR method
2. english_clarity: Grammar, vocabulary, fluency
3. communication: Confidence, conciseness, professional tone
${isVideoMode ? "4. eye_contact: Estimated engagement and directness (score generously based on written answer cues)\n5. body_language: Posture and presence cues inferred from text" : ""}

Provide brief, actionable feedback (2-3 sentences).`;

    const schema = {
      type: "object",
      properties: {
        answer_quality: { type: "number" },
        english_clarity: { type: "number" },
        communication: { type: "number" },
        ...(isVideoMode ? { eye_contact: { type: "number" }, body_language: { type: "number" } } : {}),
        feedback: { type: "string" }
      }
    };

    const result = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });

    const newAnswer = {
      question: currentQuestion,
      answer: transcript,
      score_answer_quality: result.answer_quality,
      score_english_clarity: result.english_clarity,
      score_communication: result.communication,
      ...(isVideoMode ? { score_eye_contact: result.eye_contact, score_body_language: result.body_language } : {}),
      feedback: result.feedback,
    };

    const updatedAnswers = [...answers, newAnswer];
    setAnswers(updatedAnswers);
    setIsProcessing(false);

    if (questionIndex + 1 < TOTAL_QUESTIONS) {
      setQuestionIndex(qi => qi + 1);
      generateQuestion(interview, questionIndex + 1);
    } else {
      await finishInterview(updatedAnswers);
    }
  };

  const finishInterview = async (allAnswers) => {
    setIsProcessing(true);
    const isVideo = interview?.interview_mode === "video";
    const avgQuality = avg(allAnswers, "score_answer_quality");
    const avgClarity = avg(allAnswers, "score_english_clarity");
    const avgComm = avg(allAnswers, "score_communication");
    const avgEye = isVideo ? avg(allAnswers, "score_eye_contact") : null;
    const avgBody = isVideo ? avg(allAnswers, "score_body_language") : null;
    const scores = [avgQuality, avgClarity, avgComm, ...(isVideo ? [avgEye, avgBody] : [])];
    const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const duration = Math.round((Date.now() - startTime) / 1000);

    const summaryPrompt = `Based on this mock interview for ${interview.role_title} at ${interview.company} (mode: ${interview.interview_mode}), provide:
1. A summary feedback paragraph (3-4 sentences)
2. Top 3 strengths
3. Top 3 areas for improvement
${isVideo ? "Include observations about presence, body language and eye contact." : ""}

Questions and scores:
${allAnswers.map((a, i) => `Q${i+1}: ${a.question}\nScores: Quality ${a.score_answer_quality}, Clarity ${a.score_english_clarity}, Communication ${a.score_communication}${isVideo ? `, Eye Contact ${a.score_eye_contact}, Body Language ${a.score_body_language}` : ""}`).join("\n\n")}`;

    const summary = await base44.integrations.Core.InvokeLLM({
      prompt: summaryPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          summary_feedback: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          improvements: { type: "array", items: { type: "string" } },
        }
      }
    });

    await base44.entities.Interview.update(interviewId, {
      status: "completed",
      questions: allAnswers,
      overall_score: overall,
      score_answer_quality: avgQuality,
      score_english_clarity: avgClarity,
      score_communication: avgComm,
      ...(isVideo ? { score_eye_contact: avgEye, score_body_language: avgBody } : {}),
      summary_feedback: summary.summary_feedback,
      strengths: summary.strengths,
      improvements: summary.improvements,
      duration_seconds: duration,
    });

    navigate(`/report?id=${interviewId}`);
  };

  const avg = (arr, key) => Math.round(arr.reduce((s, a) => s + (a[key] || 0), 0) / arr.length);

  const exitInterview = async () => {
    if (confirm("Exit interview? Your progress will be lost.")) {
      window.speechSynthesis?.cancel();
      await base44.entities.Interview.update(interviewId, { status: "abandoned" });
      navigate("/dashboard");
    }
  };

  if (!interview) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  const mode = interview.interview_mode;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{interview.role_title} at {interview.company}</p>
            <div className="flex items-center gap-2 mt-1">
              {Array.from({ length: TOTAL_QUESTIONS }).map((_, i) => (
                <div key={i} className={`h-1.5 w-8 rounded-full transition-colors ${
                  i < questionIndex ? "bg-emerald-500" : i === questionIndex ? "bg-accent" : "bg-muted"
                }`} />
              ))}
              <span className="text-xs text-muted-foreground ml-1">{questionIndex + 1}/{TOTAL_QUESTIONS}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={exitInterview} className="rounded-xl">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            {isGenerating ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto mb-4" />
                <p className="text-muted-foreground">Preparing next question...</p>
              </motion.div>
            ) : (
              <motion.div key={questionIndex} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <VideoCallInterface
                  interview={interview}
                  isBotSpeaking={isBotSpeaking}
                  isUserSpeaking={isUserSpeaking}
                  micOn={micOn}
                  camOn={camOn}
                  onToggleMic={() => setMicOn(m => !m)}
                  onToggleCam={() => setCamOn(c => !c)}
                >
                  {/* Question */}
                  <div className="flex items-start gap-3 mb-5">
                    <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-accent mb-1">Question {questionIndex + 1}</p>
                      <p className="text-sm leading-relaxed font-medium text-white/90">{currentQuestion}</p>
                    </div>
                  </div>

                  {/* Input by mode */}
                  {mode === "chat" ? (
                    <div className="space-y-3">
                      <Textarea
                        placeholder="Type your answer here..."
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        className="min-h-24 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none text-sm"
                        disabled={isProcessing}
                      />
                      <Button
                        onClick={() => { if (chatInput.trim()) { handleAnswer(chatInput.trim()); setChatInput(""); } }}
                        disabled={!chatInput.trim() || isProcessing}
                        className="w-full bg-accent hover:bg-accent/90 text-accent-foreground h-11 rounded-xl font-semibold gap-2"
                      >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Submit Answer</>}
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <VoiceRecorder
                        onTranscript={handleAnswer}
                        isProcessing={isProcessing}
                        onRecordingStart={() => setIsUserSpeaking(true)}
                        onRecordingStop={() => setIsUserSpeaking(false)}
                      />
                    </div>
                  )}

                  {isProcessing && mode !== "chat" && (
                    <div className="text-center mt-4">
                      <Loader2 className="w-5 h-5 animate-spin text-accent mx-auto mb-1" />
                      <p className="text-xs text-white/40">Evaluating your answer...</p>
                    </div>
                  )}
                </VideoCallInterface>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}