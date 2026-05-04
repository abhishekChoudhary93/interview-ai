import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Repeat,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Target,
  Lightbulb,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInterview } from "@/api/interviews";
import ScoreGauge from "../components/ScoreGauge";
import AIFeedbackSummary from "../components/AIFeedbackSummary";
import { ScoreRadarChart, ScoreProgressionChart, ScoreLegend } from "../components/ScoreBreakdownChart";
import { formatInterviewType } from "@/utils/interviewLabels";
import InterviewTranscript from "../components/InterviewTranscript";
import {
  isOrchestratedSession,
  reportedQuestionCountLabel,
  buildReportTranscriptMessages,
  aggregateOrchestratedQuestionsForCharts,
} from "@/utils/interviewReport";

/**
 * The new orchestrator stops writing into `questions[]` and instead persists
 * everything into `session_state` + `debrief`. Detect the new shape so we can
 * skip the legacy 5-pip / per-question chart blocks entirely; old rows still
 * render through the legacy code path further down.
 */
function isNewShape(interview) {
  if (!interview) return false;
  const ss = interview.session_state;
  if (ss && typeof ss === "object" && Object.keys(ss).length > 0) return true;
  if (interview.debrief && typeof interview.debrief === "object") return true;
  return false;
}

function VerdictBadge({ verdict }) {
  const v = String(verdict || "").trim();
  const tone = (() => {
    if (v.startsWith("Strong Hire")) return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
    if (v === "Hire") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    if (v === "No Hire") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
    if (v.startsWith("Strong No Hire")) return "bg-rose-500/15 text-rose-500 border-rose-500/30";
    return "bg-muted text-muted-foreground border-border/50";
  })();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
      {v || "—"}
    </span>
  );
}

function SignalScorePill({ score }) {
  if (score == null) {
    return (
      <span className="inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded-md border border-border/50 bg-background/40 px-2 text-xs font-mono text-muted-foreground">
        —
      </span>
    );
  }
  const tone =
    score >= 4
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
      : score === 3
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
        : score === 2
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
          : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
  return (
    <span className={`inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded-md border px-2 text-xs font-mono font-semibold ${tone}`}>
      {score}/4
    </span>
  );
}

function SectionStatusPill({ status, weighted }) {
  const s = String(status || "").trim() || "completed";
  const tone =
    s === "not_reached"
      ? "bg-muted text-muted-foreground border-border/40"
      : s === "partial"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
        : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${tone}`}>
        {s.replace(/_/g, " ")}
      </span>
      {weighted ? (
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{weighted}</span>
      ) : null}
    </div>
  );
}

/**
 * Section card with per-signal evidence rows. Used for both system_design
 * rubric debriefs (nested SD shape) and the simpler per-section comment shape.
 */
function SectionScoreCard({ id, label, entry }) {
  if (!entry) return null;

  const signals = Array.isArray(entry.signals) ? entry.signals : null;
  const weighted = entry.weighted_score || null;

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Section</p>
          <p className="text-sm font-semibold text-foreground truncate">{label || id}</p>
        </div>
        <SectionStatusPill status={entry.status} weighted={weighted} />
      </div>
      {signals ? (
        signals.length > 0 ? (
          <ul className="space-y-3 border-t border-border/30 pt-3">
            {signals.map((sig, i) => (
              <li key={`${id}-${i}`} className="flex gap-3">
                <SignalScorePill score={sig.score ?? null} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{sig.signal || "Signal"}</p>
                  {sig.evidence ? (
                    <p className="text-xs text-muted-foreground mt-1 italic">&ldquo;{sig.evidence}&rdquo;</p>
                  ) : null}
                  {sig.what_it_means || sig.score_description ? (
                    <p className="text-xs text-muted-foreground/90 mt-1">
                      {sig.what_it_means || sig.score_description}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : entry.status === "not_reached" ? (
          <p className="text-xs text-muted-foreground italic border-t border-border/30 pt-3">
            Section not reached in this session.
          </p>
        ) : null
      ) : entry.comment ? (
        <p className="text-sm text-muted-foreground leading-relaxed border-t border-border/30 pt-3">
          {entry.comment}
        </p>
      ) : null}
    </div>
  );
}

function MomentList({ items, type }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const isStrength = type === "strength";
  const Icon = isStrength ? CheckCircle : AlertTriangle;
  const colorClass = isStrength ? "text-emerald-500" : "text-amber-500";
  const borderClass = isStrength ? "border-emerald-500/30" : "border-amber-500/30";
  return (
    <ul className="space-y-3">
      {items.map((m, i) => {
        const point = m.point || m.moment || m.title || "—";
        const evidence = m.evidence || m.why_it_matters || m.quote || m.detail || "";
        return (
          <li key={i} className={`border-l-2 pl-3 ${borderClass}`}>
            <div className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-4 w-4 ${colorClass} shrink-0`} />
              <p className="font-medium text-sm text-foreground">{point}</p>
            </div>
            {evidence ? (
              <p className="text-xs text-muted-foreground mt-1 ml-6 italic">&ldquo;{evidence}&rdquo;</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function Report() {
  const navigate = useNavigate();
  const interviewId = new URLSearchParams(window.location.search).get("id");
  const [interview, setInterview] = useState(null);
  const [expandedQ, setExpandedQ] = useState(null);

  useEffect(() => {
    if (!interviewId) {
      navigate("/dashboard");
      return;
    }
    getInterview(interviewId).then(setInterview);
  }, [interviewId, navigate]);

  const orchestrated = Boolean(interview && isOrchestratedSession(interview));
  const newShape = Boolean(interview && isNewShape(interview));

  const transcriptMessages = useMemo(() => {
    if (!interview) return [];
    return buildReportTranscriptMessages(interview);
  }, [interview]);

  const chartQuestions = useMemo(() => {
    if (!interview) return [];
    if (isOrchestratedSession(interview)) return aggregateOrchestratedQuestionsForCharts(interview);
    return interview.questions || [];
  }, [interview]);

  const sectionRows = useMemo(() => {
    if (!interview?.debrief?.section_scores) return [];
    const sections =
      interview.interview_config?.sections || interview.execution_plan?.sections || [];
    const labelById = new Map(sections.map((s) => [s.id, s.label || s.name]));
    return Object.entries(interview.debrief.section_scores).map(([id, raw]) => {
      const entry =
        raw != null && typeof raw === "object" && !Array.isArray(raw)
          ? raw
          : { score: raw, comment: "", status: "" };
      return { id, label: labelById.get(id) || id, entry };
    });
  }, [interview]);

  const liveSignals = interview?.session_state?.signals;

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
  const debrief = interview.debrief;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20">
      {/* Top nav */}
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

      {/* Overall card */}
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
            <div className="flex items-center justify-center lg:justify-start gap-4 mt-3 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatDuration(interview.duration_seconds || 0)}
              </span>
              <span>{reportedQuestionCountLabel(interview)}</span>
              <span>{formatInterviewType(interview.interview_type)} interview</span>
              {debrief?.verdict ? <VerdictBadge verdict={debrief.verdict} /> : null}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Transcript */}
      {transcriptMessages.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 mb-3">
            <MessageSquareText className="w-5 h-5 text-accent" />
            <h2 className="font-space text-lg font-semibold">Transcript</h2>
          </div>
          <InterviewTranscript
            messages={transcriptMessages}
            title="Interview transcript"
            subtitle={
              orchestrated
                ? "Full conversation from this design session"
                : "Questions and your answers as recorded"
            }
            className="min-h-0 w-full max-w-4xl max-h-[min(320px,40vh)] sm:max-h-[min(380px,46vh)] md:max-h-[min(420px,50vh)]"
          />
        </motion.div>
      )}

      {/* New-shape: rubric-signal-per-section debrief */}
      {newShape && debrief && typeof debrief === "object" && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-card rounded-3xl border border-border/50 p-8 lg:p-10 mb-8"
        >
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <h2 className="font-space text-lg font-semibold">Interview debrief</h2>
            {debrief.overall_score ? (
              <span className="text-sm font-semibold text-foreground font-mono">
                Overall: {debrief.overall_score}
              </span>
            ) : null}
          </div>
          {debrief.verdict_reason || debrief.verdict_summary ? (
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              {debrief.verdict_reason || debrief.verdict_summary}
            </p>
          ) : null}
          {debrief.completion_note ? (
            <p className="text-xs text-muted-foreground border border-border/40 rounded-xl px-3 py-2 mb-6 bg-muted/20">
              {debrief.completion_note}
            </p>
          ) : null}

          {sectionRows.length > 0 && (
            <div className="space-y-3 mb-8">
              <h3 className="font-space text-sm font-semibold flex items-center gap-2">
                <Target className="h-4 w-4 text-accent" /> Section breakdown
              </h3>
              {sectionRows.map((row) => (
                <SectionScoreCard key={row.id} id={row.id} label={row.label} entry={row.entry} />
              ))}
            </div>
          )}

          {Array.isArray(debrief.top_moments) && debrief.top_moments.length > 0 && (
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div>
                <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500" /> Strong moments
                </h3>
                <MomentList
                  items={debrief.top_moments.filter(
                    (m) => String(m.type).toLowerCase() === "strength"
                  )}
                  type="strength"
                />
              </div>
              <div>
                <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Gaps
                </h3>
                <MomentList
                  items={debrief.top_moments.filter(
                    (m) => String(m.type).toLowerCase() === "gap"
                  )}
                  type="gap"
                />
              </div>
            </div>
          )}

          {(Array.isArray(debrief.strengths) && debrief.strengths.length > 0) ||
          (Array.isArray(debrief.improvements) && debrief.improvements.length > 0) ? (
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {Array.isArray(debrief.strengths) && debrief.strengths.length > 0 && (
                <div>
                  <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" /> Strengths (with evidence)
                  </h3>
                  <MomentList items={debrief.strengths} type="strength" />
                </div>
              )}
              {Array.isArray(debrief.improvements) && debrief.improvements.length > 0 && (
                <div>
                  <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Areas to improve
                  </h3>
                  <MomentList items={debrief.improvements} type="gap" />
                </div>
              )}
            </div>
          ) : null}

          {debrief.faang_bar_assessment ? (
            <div className="rounded-2xl bg-muted/30 border border-border/50 p-5 mb-6">
              <h3 className="font-space text-sm font-semibold mb-2">FAANG bar</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {debrief.faang_bar_assessment}
              </p>
            </div>
          ) : null}

          {Array.isArray(debrief.next_session_focus) && debrief.next_session_focus.length > 0 && (
            <div>
              <h3 className="font-space text-sm font-semibold mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-accent" /> Focus next session
              </h3>
              <ul className="flex flex-col gap-2">
                {debrief.next_session_focus.map((s, i) => {
                  if (s != null && typeof s === "object" && (s.area != null || s.reason != null)) {
                    return (
                      <li
                        key={i}
                        className="rounded-xl bg-accent/10 text-accent-foreground border border-accent/20 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-foreground block">{s.area || "Focus"}</span>
                        {s.reason ? (
                          <span className="text-muted-foreground mt-0.5 block">{s.reason}</span>
                        ) : null}
                      </li>
                    );
                  }
                  return (
                    <li
                      key={i}
                      className="rounded-full bg-accent/10 text-accent-foreground border border-accent/20 px-3 py-1 text-xs"
                    >
                      {String(s)}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {liveSignals &&
            ((Array.isArray(liveSignals.strong) && liveSignals.strong.length > 0) ||
              (Array.isArray(liveSignals.weak) && liveSignals.weak.length > 0)) && (
              <div className="mt-8 pt-6 border-t border-border/40">
                <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" /> Signals captured live
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-emerald-500 font-semibold mb-1.5">
                      Strong
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(liveSignals.strong || []).map((t, i) => (
                        <span
                          key={`s-${i}`}
                          className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-amber-500 font-semibold mb-1.5">
                      Weak
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(liveSignals.weak || []).map((t, i) => (
                        <span
                          key={`w-${i}`}
                          className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
        </motion.div>
      )}

      {/* ====================== LEGACY VIEW ====================== */}
      {/* Pre-orchestrator interviews still render the original 5-pip / per-question shape. */}
      {!newShape && (
        <LegacyReportSections
          interview={interview}
          chartQuestions={chartQuestions}
          orchestrated={orchestrated}
          expandedQ={expandedQ}
          setExpandedQ={setExpandedQ}
        />
      )}
    </div>
  );
}

/* ---------------- Legacy report blocks (pre-new-orchestrator rows) ---------------- */

function LegacyReportSections({ interview, chartQuestions, orchestrated, expandedQ, setExpandedQ }) {
  const SESSION_EXPAND_KEY = "session";
  const sessionBreakdownRow = orchestrated ? chartQuestions[0] : null;
  const sessionAvgScore = sessionBreakdownRow
    ? Math.round(
        (sessionBreakdownRow.score_answer_quality +
          sessionBreakdownRow.score_english_clarity +
          sessionBreakdownRow.score_communication) /
          3
      )
    : 0;

  return (
    <>
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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid md:grid-cols-2 gap-4 mb-8"
      >
        <div className="bg-card rounded-3xl border border-border/50 p-6">
          <h3 className="font-space font-semibold mb-1">Performance radar</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {orchestrated
              ? "Averages across all exchanges in this design session (one exercise)."
              : "Overall dimension balance"}
          </p>
          <ScoreRadarChart questions={chartQuestions} />
        </div>
        <div className="bg-card rounded-3xl border border-border/50 p-6">
          <h3 className="font-space font-semibold mb-1">Score by question</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {orchestrated
              ? "One bar: session-wide averages (not separate interview questions)."
              : "How you performed across questions"}
          </p>
          <ScoreProgressionChart questions={chartQuestions} />
          <ScoreLegend />
        </div>
      </motion.div>

      <AIFeedbackSummary interview={interview} />

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

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <h2 className="font-space text-lg font-semibold mb-4">
          {orchestrated ? "Session breakdown" : "Question breakdown"}
        </h2>
        {orchestrated ? (
          <div className="space-y-3">
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedQ(expandedQ === SESSION_EXPAND_KEY ? null : SESSION_EXPAND_KEY)}
                className="w-full p-5 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-4 text-left">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-space font-bold text-sm ${
                      sessionAvgScore >= 70
                        ? "bg-emerald-500/10 text-emerald-500"
                        : sessionAvgScore >= 50
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-red-500/10 text-red-500"
                    }`}
                  >
                    {sessionAvgScore}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">1 design session</p>
                    <p className="text-sm font-medium line-clamp-2">
                      {sessionBreakdownRow?.question || "System design session"}
                    </p>
                  </div>
                </div>
                {expandedQ === SESSION_EXPAND_KEY ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                )}
              </button>
              {expandedQ === SESSION_EXPAND_KEY && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  className="px-5 pb-5 border-t border-border/50"
                >
                  <div className="pt-4 space-y-6">
                    <div className="grid grid-cols-3 gap-3">
                      <MiniScore label="Quality" score={sessionBreakdownRow?.score_answer_quality} />
                      <MiniScore label="Clarity" score={sessionBreakdownRow?.score_english_clarity} />
                      <MiniScore label="Communication" score={sessionBreakdownRow?.score_communication} />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {interview.questions?.map((q, i) => {
              const isOpen = expandedQ === i;
              const qAvg = Math.round(
                (q.score_answer_quality + q.score_english_clarity + q.score_communication) / 3
              );
              return (
                <div key={i} className="bg-card rounded-2xl border border-border/50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedQ(isOpen ? null : i)}
                    className="w-full p-5 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-space font-bold text-sm ${
                          qAvg >= 70
                            ? "bg-emerald-500/10 text-emerald-500"
                            : qAvg >= 50
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-red-500/10 text-red-500"
                        }`}
                      >
                        {qAvg}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Question {i + 1}</p>
                        <p className="text-sm font-medium line-clamp-1">{q.question}</p>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      className="px-5 pb-5 border-t border-border/50"
                    >
                      <div className="pt-4 space-y-4">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Your answer</p>
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
        )}
      </motion.div>
    </>
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
