import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Repeat, Clock, CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import ScoreGauge from "../components/ScoreGauge";
import AIFeedbackSummary from "../components/AIFeedbackSummary";
import { ScoreRadarChart, ScoreProgressionChart, ScoreLegend } from "../components/ScoreBreakdownChart";

export default function Report() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const interviewId = urlParams.get("id");
  const [interview, setInterview] = useState(null);
  const [expandedQ, setExpandedQ] = useState(null);

  useEffect(() => {
    if (!interviewId) { navigate("/dashboard"); return; }
    base44.entities.Interview.get(interviewId).then(setInterview);
  }, [interviewId]);

  if (!interview) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  const formatDuration = (s) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}m ${sec}s`;
  };

  const getGrade = (score) => {
    if (score >= 90) return { grade: "A+", color: "text-emerald-500" };
    if (score >= 80) return { grade: "A", color: "text-emerald-500" };
    if (score >= 70) return { grade: "B+", color: "text-amber-500" };
    if (score >= 60) return { grade: "B", color: "text-amber-500" };
    if (score >= 50) return { grade: "C", color: "text-orange-500" };
    return { grade: "D", color: "text-red-500" };
  };

  const { grade, color } = getGrade(interview.overall_score);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <Button variant="ghost" className="gap-2 rounded-xl" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Button>
        <Button
          onClick={() => navigate("/setup")}
          className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 rounded-xl"
        >
          <Repeat className="w-4 h-4" /> New Interview
        </Button>
      </div>

      {/* Overall Score Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-3xl border border-border/50 p-8 lg:p-10 mb-8"
      >
        <div className="flex flex-col lg:flex-row items-center gap-8">
          <div className="flex-shrink-0">
            <ScoreGauge score={interview.overall_score} size="lg" />
          </div>
          <div className="flex-1 text-center lg:text-left">
            <div className="flex items-center justify-center lg:justify-start gap-3 mb-2">
              <h1 className="font-space text-2xl lg:text-3xl font-bold">Interview Report</h1>
              <span className={`font-space text-3xl font-bold ${color}`}>{grade}</span>
            </div>
            <p className="text-muted-foreground">
              {interview.role_title} at {interview.company}
            </p>
            <div className="flex items-center justify-center lg:justify-start gap-4 mt-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatDuration(interview.duration_seconds || 0)}
              </span>
              <span>{interview.questions?.length || 0} questions</span>
              <span className="capitalize">{interview.interview_type} interview</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Score Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-3 gap-4 mb-8"
      >
        <ScoreCard label="Answer Quality" score={interview.score_answer_quality} desc="Relevance & depth" />
        <ScoreCard label="English Clarity" score={interview.score_english_clarity} desc="Grammar & fluency" />
        <ScoreCard label="Communication" score={interview.score_communication} desc="Confidence & tone" />
      </motion.div>

      {/* Charts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid md:grid-cols-2 gap-4 mb-8"
      >
        <div className="bg-card rounded-3xl border border-border/50 p-6">
          <h3 className="font-space font-semibold mb-1">Performance Radar</h3>
          <p className="text-xs text-muted-foreground mb-4">Overall dimension balance</p>
          <ScoreRadarChart questions={interview.questions} />
        </div>
        <div className="bg-card rounded-3xl border border-border/50 p-6">
          <h3 className="font-space font-semibold mb-1">Score by Question</h3>
          <p className="text-xs text-muted-foreground mb-4">How you performed across questions</p>
          <ScoreProgressionChart questions={interview.questions} />
          <ScoreLegend />
        </div>
      </motion.div>

      {/* AI Feedback Summary */}
      <AIFeedbackSummary interview={interview} />

      {/* Strengths & Improvements */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card rounded-3xl border border-border/50 p-6"
        >
          <h3 className="font-space font-semibold flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-emerald-500" /> Strengths
          </h3>
          <ul className="space-y-3">
            {interview.strengths?.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">{s}</p>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-card rounded-3xl border border-border/50 p-6"
        >
          <h3 className="font-space font-semibold flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Areas to Improve
          </h3>
          <ul className="space-y-3">
            {interview.improvements?.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">{s}</p>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      {/* Question-by-Question */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h2 className="font-space text-lg font-semibold mb-4">Question Breakdown</h2>
        <div className="space-y-3">
          {interview.questions?.map((q, i) => {
            const isOpen = expandedQ === i;
            const qAvg = Math.round((q.score_answer_quality + q.score_english_clarity + q.score_communication) / 3);
            return (
              <div key={i} className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                <button
                  onClick={() => setExpandedQ(isOpen ? null : i)}
                  className="w-full p-5 flex items-center justify-between hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4 text-left">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-space font-bold text-sm ${
                      qAvg >= 70 ? "bg-emerald-500/10 text-emerald-500" : qAvg >= 50 ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"
                    }`}>
                      {qAvg}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Question {i + 1}</p>
                      <p className="text-sm font-medium line-clamp-1">{q.question}</p>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                </button>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    className="px-5 pb-5 border-t border-border/50"
                  >
                    <div className="pt-4 space-y-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Your Answer</p>
                        <p className="text-sm bg-muted/30 rounded-xl p-4 leading-relaxed">{q.answer}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <MiniScore label="Quality" score={q.score_answer_quality} />
                        <MiniScore label="Clarity" score={q.score_english_clarity} />
                        <MiniScore label="Communication" score={q.score_communication} />
                      </div>
                      <div className="bg-accent/5 rounded-xl p-4 border border-accent/10">
                        <p className="text-xs font-medium text-accent mb-1">Feedback</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{q.feedback}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

function ScoreCard({ label, score, desc }) {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5 flex flex-col items-center text-center">
      <ScoreGauge score={score} size="sm" />
      <p className="font-semibold text-sm mt-3">{label}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function MiniScore({ label, score }) {
  const color = score >= 70 ? "text-emerald-500" : score >= 50 ? "text-amber-500" : "text-red-500";
  return (
    <div className="text-center p-3 bg-muted/30 rounded-xl">
      <p className={`font-space text-xl font-bold ${color}`}>{score}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}