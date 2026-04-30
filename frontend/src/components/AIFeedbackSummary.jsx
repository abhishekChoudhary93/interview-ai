import { motion } from "framer-motion";
import { Sparkles, TrendingUp, Target, MessageCircle } from "lucide-react";

const scoreLabel = (score) => {
  if (score >= 90) return { text: "Excellent", color: "text-emerald-500", bg: "bg-emerald-500/10" };
  if (score >= 75) return { text: "Good", color: "text-blue-500", bg: "bg-blue-500/10" };
  if (score >= 60) return { text: "Fair", color: "text-amber-500", bg: "bg-amber-500/10" };
  return { text: "Needs Work", color: "text-red-500", bg: "bg-red-500/10" };
};

export default function AIFeedbackSummary({ interview }) {
  const isVideo = interview.interview_mode === "video";
  const qlLabel = scoreLabel(interview.score_answer_quality);
  const clLabel = scoreLabel(interview.score_english_clarity);
  const cmLabel = scoreLabel(interview.score_communication);
  const eyeLabel = scoreLabel(interview.score_eye_contact);
  const bodyLabel = scoreLabel(interview.score_body_language);

  const metrics = [
    {
      icon: Target,
      label: "Answer Quality",
      score: interview.score_answer_quality,
      badge: qlLabel,
      desc: "How well your answers addressed the question with relevant examples and structure.",
    },
    {
      icon: MessageCircle,
      label: "English Clarity",
      score: interview.score_english_clarity,
      badge: clLabel,
      desc: "Grammar, vocabulary range, sentence fluency and articulation.",
    },
    {
      icon: TrendingUp,
      label: "Communication",
      score: interview.score_communication,
      badge: cmLabel,
      desc: "Confidence, tone, conciseness and professional presence.",
    },
    ...(isVideo ? [
      { icon: Target, label: "Eye Contact", score: interview.score_eye_contact, badge: eyeLabel, desc: "Directness, engagement and visual presence during the call." },
      { icon: TrendingUp, label: "Body Language", score: interview.score_body_language, badge: bodyLabel, desc: "Posture, gestures and physical confidence on camera." },
    ] : []),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bg-card rounded-3xl border border-border/50 p-8 mb-8"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="font-space text-lg font-semibold">AI Performance Summary</h2>
          <p className="text-xs text-muted-foreground">Personalized insights from your interview session</p>
        </div>
      </div>

      {/* Summary paragraph */}
      <div className="bg-gradient-to-br from-accent/5 to-accent/0 border border-accent/10 rounded-2xl p-5 mb-6">
        <p className="text-sm leading-relaxed text-foreground/80">{interview.summary_feedback}</p>
      </div>

      {/* Metric cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.08 }}
            className="rounded-2xl border border-border/50 bg-background p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                <m.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${m.badge.bg} ${m.badge.color}`}>
                {m.badge.text}
              </span>
            </div>
            <div className="mb-2">
              <div className="flex items-end gap-1">
                <span className="font-space text-3xl font-bold">{m.score}</span>
                <span className="text-muted-foreground text-sm mb-1">/100</span>
              </div>
              <p className="font-medium text-sm">{m.label}</p>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${m.score}%` }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.4 + i * 0.1 }}
                className={`h-full rounded-full ${
                  m.score >= 75 ? "bg-emerald-500" : m.score >= 60 ? "bg-amber-500" : "bg-red-500"
                }`}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{m.desc}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}