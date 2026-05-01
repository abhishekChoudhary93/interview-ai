import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, MessageSquare, Send, Mic, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getInterview,
  updateInterview,
  startInterviewSession,
  interviewSessionTurn,
  interviewSessionComplete,
} from '@/api/interviews';
import { invokeLLM } from '@/api/llm';
import VoiceRecorder from "../components/VoiceRecorder";
import VideoCallInterface from "../components/VideoCallInterface";
import InterviewTranscript from "../components/InterviewTranscript";

const TOTAL_QUESTIONS = 5;

function buildDisplayMessages(interview, currentQuestion) {
  const list = [];
  const turns = interview?.conversation_turns;
  if (turns?.length) {
    for (const t of turns) {
      list.push({ role: t.role, content: t.content });
    }
  } else {
    for (const q of interview?.questions || []) {
      list.push({ role: "interviewer", content: q.question });
      list.push({ role: "candidate", content: q.answer });
    }
  }
  const last = list[list.length - 1];
  if (
    currentQuestion &&
    (last?.content !== currentQuestion || last?.role !== "interviewer")
  ) {
    list.push({ role: "interviewer", content: currentQuestion });
  }
  return list;
}

function modeLabel(mode) {
  if (mode === "video") return "Video";
  if (mode === "audio") return "Audio";
  return "Chat";
}

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
  const [orchState, setOrchState] = useState(null);
  const sessionStartedRef = useRef(false);

  const useOrchestration = Boolean(interview?.template_id);

  const displayMessages = useMemo(
    () => buildDisplayMessages(interview, currentQuestion),
    [interview, currentQuestion]
  );

  useEffect(() => {
    if (!interviewId) {
      navigate('/setup');
      return;
    }
    let cancelled = false;
    getInterview(interviewId)
      .then(async (data) => {
        if (cancelled) return;
        setInterview(data);
        if (data.template_id && data.status === 'in_progress') {
          if (sessionStartedRef.current) return;
          sessionStartedRef.current = true;
          setIsGenerating(true);
          let openingMsg = '';
          try {
            const session = await startInterviewSession(interviewId);
            if (cancelled) return;
            openingMsg = session.interviewer_message || '';
            setCurrentQuestion(openingMsg);
            setOrchState(session.orchestrator_state);
            const fresh = await getInterview(interviewId);
            if (!cancelled) setInterview(fresh);
          } catch {
            if (!cancelled) navigate('/dashboard');
            return;
          }
          setIsGenerating(false);
          if (data.interview_mode !== "chat") {
            setTimeout(() => speakQuestion(openingMsg), 400);
          }
        } else if (!data.template_id) {
          generateQuestion(data, 0);
        } else {
          setIsGenerating(false);
        }
      })
      .catch(() => {
        if (!cancelled) navigate('/dashboard');
      });
    return () => {
      cancelled = true;
    };
  }, [interviewId, navigate]);

  const speakQuestion = (text) => {
    if ('speechSynthesis' in window && text) {
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
    const ft =
      interviewData.interview_type === "technical" ? "system_design" : interviewData.interview_type || "mixed";
    const prompt = `You are an expert technology interview coach (software engineering IC or engineering leadership). Generate exactly ONE interview question for:
- Role: ${interviewData.role_title}
- Company: ${interviewData.company}
- Experience Level: ${interviewData.experience_level}
- Interview focus: ${ft}
- Tech domain: ${interviewData.industry || "General software"}
- Question number: ${qIdx + 1} of ${TOTAL_QUESTIONS}
${previousQs ? `\nPrevious questions (DO NOT REPEAT):\n- ${previousQs}` : ""}
${ft === "behavioral" ? "Ask ONE behavioral question using STAR (Situation, Task, Action, Result). Focus on technical scope, leadership, conflict, delivery, or mentoring as appropriate for the role." : ""}
${ft === "system_design" ? "Ask ONE system design question: clarify requirements if needed, then probe architecture, components, APIs, data stores, scaling, consistency, and failure modes. Stay in one coherent design thread." : ""}
${ft === "mixed" ? `Ask exactly ONE question. For this turn use a ${qIdx % 2 === 0 ? "system design (architecture, scale, trade-offs)" : "behavioral STAR (scope, conflict, outcomes)"} style question appropriate for a senior tech interview.` : ""}
Return ONLY the question text, nothing else.`;

    const question = await invokeLLM({ prompt });
    setCurrentQuestion(question);
    setIsGenerating(false);
    if (interviewData.interview_mode !== "chat") {
      setTimeout(() => speakQuestion(question), 400);
    }
  };

  const handleOrchestratedAnswer = async (transcript) => {
    setIsUserSpeaking(false);
    setIsProcessing(true);
    try {
      const result = await interviewSessionTurn(interviewId, transcript);
      const fresh = await getInterview(interviewId);
      setInterview(fresh);
      setAnswers(fresh.questions || []);
      setOrchState(result.orchestrator_state);
      setQuestionIndex((fresh.questions?.length || 1) - 1);
      setCurrentQuestion(result.interviewer_message || '');
      if (fresh.interview_mode !== "chat" && result.interviewer_message) {
        speakQuestion(result.interviewer_message);
      }
      if (result.done) {
        await interviewSessionComplete(interviewId);
        navigate(`/report?id=${interviewId}`);
        return;
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAnswer = async (transcript) => {
    if (useOrchestration) {
      return handleOrchestratedAnswer(transcript);
    }
    setIsUserSpeaking(false);
    setIsProcessing(true);
    const isVideoMode = interview?.interview_mode === 'video';

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

    const result = await invokeLLM({ prompt, response_json_schema: schema });

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
    const isVideo = interview?.interview_mode === 'video';
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

    const summary = await invokeLLM({
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

    await updateInterview(interviewId, {
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
      await updateInterview(interviewId, { status: 'abandoned' });
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

  const mode = interview.interview_mode || "chat";
  const sectionsTotal = interview.execution_plan?.sections?.length || 0;
  const sectionIdx = (orchState?.current_section_index ?? 0) + 1;

  const questionComposer = (
    <>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-4 h-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-accent mb-1">
            {useOrchestration ? `Turn ${(interview.questions?.length || 0) + 1}` : `Question ${questionIndex + 1}`}
          </p>
          <p className={`text-sm leading-relaxed font-medium ${mode === "chat" ? "text-foreground" : "text-white/90"}`}>
            {currentQuestion}
          </p>
        </div>
      </div>

      {mode === "chat" ? (
        <div className="space-y-3">
          <Textarea
            placeholder="Type your answer here..."
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            className="min-h-28 rounded-xl bg-background border-border text-foreground placeholder:text-muted-foreground resize-none text-sm"
            disabled={isProcessing}
          />
          <Button
            onClick={() => { if (chatInput.trim()) { handleAnswer(chatInput.trim()); setChatInput(""); } }}
            disabled={!chatInput.trim() || isProcessing}
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground h-11 rounded-xl font-semibold gap-2"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Submit answer</>}
          </Button>
          {isProcessing && (
            <p className="text-xs text-center text-muted-foreground">Evaluating…</p>
          )}
        </div>
      ) : (
        <div>
          <VoiceRecorder
            onTranscript={handleAnswer}
            isProcessing={isProcessing}
            onRecordingStart={() => setIsUserSpeaking(true)}
            onRecordingStop={() => setIsUserSpeaking(false)}
          />
          {isProcessing && (
            <div className="text-center mt-4">
              <Loader2 className="w-5 h-5 animate-spin text-accent mx-auto mb-1" />
              <p className="text-xs text-white/40">Evaluating your answer...</p>
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate">{interview.role_title} at {interview.company}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {mode === "chat" && <MessageSquare className="w-3 h-3" />}
                {mode === "audio" && <Mic className="w-3 h-3" />}
                {mode === "video" && <Video className="w-3 h-3" />}
                {modeLabel(mode)}
              </span>
              {useOrchestration && sectionsTotal > 0 ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    Section {sectionIdx}/{sectionsTotal}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {orchState?.elapsed_minutes != null
                      ? `${Math.round(orchState.elapsed_minutes)} min elapsed`
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  {Array.from({ length: TOTAL_QUESTIONS }).map((_, i) => (
                    <div key={i} className={`h-1.5 w-8 rounded-full transition-colors ${
                      i < questionIndex ? "bg-emerald-500" : i === questionIndex ? "bg-accent" : "bg-muted"
                    }`} />
                  ))}
                  <span className="text-xs text-muted-foreground ml-1">{questionIndex + 1}/{TOTAL_QUESTIONS}</span>
                </>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={exitInterview} className="rounded-xl flex-shrink-0">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-6 items-stretch">
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-16 rounded-3xl border border-border bg-card/50">
                  <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto mb-4" />
                  <p className="text-muted-foreground">Preparing interview...</p>
                </motion.div>
              ) : mode === "chat" ? (
                <motion.div
                  key="chat-shell"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-3xl border border-border bg-card shadow-sm overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Chat practice</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Read each prompt and reply in writing</p>
                    </div>
                  </div>
                  <div className="p-5 md:p-6">
                    {questionComposer}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="call-shell" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                  <VideoCallInterface
                    interview={interview}
                    isBotSpeaking={isBotSpeaking}
                    isUserSpeaking={isUserSpeaking}
                    micOn={micOn}
                    camOn={camOn}
                    onToggleMic={() => setMicOn(m => !m)}
                    onToggleCam={() => setCamOn(c => !c)}
                  >
                    {questionComposer}
                  </VideoCallInterface>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <InterviewTranscript
            messages={displayMessages}
            className="w-full lg:w-[min(100%,380px)] lg:flex-shrink-0 h-[min(320px,42vh)] lg:h-[min(620px,calc(100vh-9rem))]"
          />
        </div>
      </div>
    </div>
  );
}
