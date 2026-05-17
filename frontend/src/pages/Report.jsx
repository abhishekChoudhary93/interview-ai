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
  Sparkles,
  Check,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInterview } from "@/api/interviews";
import ScoreGauge from "../components/ScoreGauge";
import AIFeedbackSummary from "../components/AIFeedbackSummary";
import { ScoreRadarChart, ScoreProgressionChart, ScoreLegend } from "../components/ScoreBreakdownChart";
import { formatInterviewType } from "@/utils/interviewLabels";
import InterviewTranscript from "../components/InterviewTranscript";
import ReportCanvas from "../components/ReportCanvas";
import PaywallOverlay from "../components/PaywallOverlay";
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
    if (v === "No Hire") return "bg-rose-500/10 text-rose-600 border-rose-500/20";
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
      <span className="inline-flex h-6 min-w-[3.5rem] items-center justify-center rounded-md border border-border/50 bg-background/40 px-2 text-xs font-mono text-muted-foreground">
        —
      </span>
    );
  }
  const label =
    score >= 4
      ? "Strong"
      : score === 3
        ? "Solid"
        : "Weak";

  const tone =
    score >= 4
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : score === 3
        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
        : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30";

  return (
    <span className={`inline-flex h-6 min-w-[3.5rem] items-center justify-center rounded-md border px-2 text-[10px] uppercase font-bold tracking-wider ${tone}`}>
      {label}
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
 * Helper to normalize weighted scores like "3.5/4.0", "4.0/4.0", or "88/100" to "xx/100" format.
 */
function formatWeightedScore(scoreStr) {
  if (!scoreStr) return null;
  const s = String(scoreStr).trim();
  if (s === "" || s.startsWith("—")) return null;

  // Check if already in /100 format
  if (s.includes("/100")) return s;

  // Extract leading digits/decimal
  const match = s.match(/^([\d.]+)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (isNaN(val)) return null;

  // If the raw number is <= 4.0, convert out of 4 to out of 100
  if (s.includes("/4") || val <= 4.0) {
    return `${Math.round(val * 25)}/100`;
  }
  return `${Math.round(val)}/100`;
}

/**
 * Section card with per-signal evidence rows. Used for both system_design
 * rubric debriefs (nested SD shape) and the simpler per-section comment shape.
 */
function SectionScoreCard({ id, label, entry, onEvidenceClick }) {
  if (!entry) return null;

  const signals = Array.isArray(entry.signals) ? entry.signals : null;
  const weighted = formatWeightedScore(entry.weighted_score) || null;
  const wentWell =
    signals?.filter((s) => s && s.score != null && Number(s.score) >= 3) || [];
  const wentBad =
    signals?.filter((s) => s && s.score != null && Number(s.score) <= 2) || [];

  const humanize = (s) =>
    String(s || "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase());

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
          <div className="border-t border-border/30 pt-3 space-y-4">
            {(wentWell.length > 0 || wentBad.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-3">
                {wentWell.length > 0 && (
                  <div className="rounded-xl border border-border/40 border-l-4 border-l-emerald-500 bg-card/40 p-4 shadow-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <p className="text-[10px] uppercase tracking-wide font-bold text-emerald-600 dark:text-emerald-400">
                        Went well
                      </p>
                    </div>
                    <ul className="mt-1 space-y-2">
                      {wentWell.slice(0, 4).map((s, i) => (
                        <li
                          key={`ww-${i}`}
                          className="group text-xs text-muted-foreground cursor-pointer hover:bg-muted/20 px-2 py-1 rounded transition-colors"
                          onClick={() => onEvidenceClick && onEvidenceClick(s.evidence || s.signal)}
                          title="Click to see context in transcript"
                        >
                          <span className="font-semibold text-foreground">{humanize(s.signal || "Signal")}</span>
                          {s.evidence ? (
                            <span className="block mt-0.5 italic">
                              &ldquo;{String(s.evidence).slice(0, 140)}&rdquo;
                              <span className="inline-block ml-2 text-[10px] text-accent font-semibold not-italic opacity-0 group-hover:opacity-100 transition-opacity">
                                🔍 view context
                              </span>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {wentBad.length > 0 && (
                  <div className="rounded-xl border border-border/40 border-l-4 border-l-rose-500 bg-card/40 p-4 shadow-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-4 h-4 text-rose-500" />
                      <p className="text-[10px] uppercase tracking-wide font-bold text-rose-600 dark:text-rose-400">
                        Needs work
                      </p>
                    </div>
                    <ul className="mt-1 space-y-2">
                      {wentBad.slice(0, 4).map((s, i) => (
                        <li
                          key={`wb-${i}`}
                          className="group text-xs text-muted-foreground cursor-pointer hover:bg-muted/20 px-2 py-1 rounded transition-colors"
                          onClick={() => onEvidenceClick && onEvidenceClick(s.evidence || s.signal)}
                          title="Click to see context in transcript"
                        >
                          <span className="font-semibold text-foreground">{humanize(s.signal || "Signal")}</span>
                          {s.evidence ? (
                            <span className="block mt-0.5 italic">
                              &ldquo;{String(s.evidence).slice(0, 140)}&rdquo;
                              <span className="inline-block ml-2 text-[10px] text-accent font-semibold not-italic opacity-0 group-hover:opacity-100 transition-opacity">
                                🔍 view context
                              </span>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <ul className="space-y-3">
            {signals.map((sig, i) => (
              <li
                key={`${id}-${i}`}
                className={`group flex gap-3 p-2 rounded-xl transition-colors ${onEvidenceClick ? "cursor-pointer hover:bg-muted/20" : ""}`}
                onClick={() => onEvidenceClick && onEvidenceClick(sig.evidence || sig.signal)}
                title={onEvidenceClick ? "Click to see context in transcript" : undefined}
              >
                <SignalScorePill score={sig.score ?? null} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {humanize(sig.signal || "Signal")}
                  </p>
                  {sig.evidence ? (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      &ldquo;{sig.evidence}&rdquo;
                      {onEvidenceClick && (
                        <span className="inline-block ml-2 text-[10px] text-accent font-semibold not-italic opacity-0 group-hover:opacity-100 transition-opacity">
                          🔍 view context
                        </span>
                      )}
                    </p>
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
          </div>
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

import { cn } from "@/lib/utils";

function MomentList({ items, type, onItemClick }) {
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
        const clickText = evidence || point;
        return (
          <li
            key={i}
            className={cn(
              `group border-l-2 pl-3 transition-colors rounded-r-lg py-1.5 px-2 ${borderClass}`,
              onItemClick && "cursor-pointer hover:bg-muted/30"
            )}
            onClick={() => onItemClick && onItemClick(clickText)}
            title={onItemClick ? "Click to see context in transcript" : undefined}
          >
            <div className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-4 w-4 ${colorClass} shrink-0`} />
              <p className="font-medium text-sm text-foreground">{point}</p>
            </div>
            {evidence ? (
              <p className="text-xs text-muted-foreground mt-1 ml-6 italic">
                &ldquo;{evidence}&rdquo;
                {onItemClick && (
                  <span className="inline-block ml-2 text-[10px] text-accent font-semibold not-italic opacity-0 group-hover:opacity-100 transition-opacity">
                    🔍 view context
                  </span>
                )}
              </p>
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
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [highlightedMsgIndex, setHighlightedMsgIndex] = useState(null);

  useEffect(() => {
    if (!interviewId) {
      navigate("/dashboard");
      return;
    }
    getInterview(interviewId).then(setInterview);
  }, [interviewId, navigate]);

  useEffect(() => {
    if (!interview) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [interviewId, interview]);

  const orchestrated = Boolean(interview && isOrchestratedSession(interview));
  const newShape = Boolean(interview && isNewShape(interview));

  const transcriptMessages = useMemo(() => {
    if (!interview) return [];
    return buildReportTranscriptMessages(interview);
  }, [interview]);

  // Robust fuzzy matching to find matching speech in the transcript
  const findTranscriptMessageIndex = (evidenceText) => {
    if (!evidenceText || !transcriptMessages || transcriptMessages.length === 0) return -1;
    const cleanEvidence = String(evidenceText).toLowerCase().replace(/[^a-z0-9]/g, "").trim();
    if (!cleanEvidence) return -1;

    // 1. Try exact substring match on raw content
    let matchedIndex = transcriptMessages.findIndex(m => 
      m.content && m.content.toLowerCase().includes(String(evidenceText).toLowerCase())
    );
    if (matchedIndex !== -1) return matchedIndex;

    // 2. Try match on stripped non-alphanumeric chars
    matchedIndex = transcriptMessages.findIndex(m => {
      if (!m.content) return false;
      const cleanContent = m.content.toLowerCase().replace(/[^a-z0-9]/g, "");
      return cleanContent.includes(cleanEvidence) || cleanEvidence.includes(cleanContent);
    });
    if (matchedIndex !== -1) return matchedIndex;

    // 3. Fallback to significant word intersection matching (minimum 40% match on words > 3 chars)
    const words = String(evidenceText).toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      let maxMatches = 0;
      let bestIndex = -1;
      transcriptMessages.forEach((m, idx) => {
        if (!m.content) return;
        const contentLower = m.content.toLowerCase();
        const matches = words.filter(w => contentLower.includes(w)).length;
        if (matches > maxMatches) {
          maxMatches = matches;
          bestIndex = idx;
        }
      });
      if (maxMatches >= Math.max(2, words.length * 0.4)) {
        return bestIndex;
      }
    }

    return -1;
  };

  const handleAnchorLink = (evidenceText) => {
    const index = findTranscriptMessageIndex(evidenceText);
    if (index !== -1) {
      setTranscriptOpen(true);
      setHighlightedMsgIndex(index);
      
      // Give React a tick to mount/open the transcript container before scrolling
      setTimeout(() => {
        const element = document.getElementById(`msg-${index}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 180);

      // Clear highlighted state after 2.5 seconds
      setTimeout(() => {
        setHighlightedMsgIndex((curr) => curr === index ? null : curr);
      }, 2500);
    }
  };

  const candyInsight = useMemo(() => {
    if (!interview) return null;
    // Try to find the flagged item in debrief.improvements
    if (interview.debrief?.improvements && Array.isArray(interview.debrief.improvements)) {
      const found = interview.debrief.improvements.find(imp => imp && imp._isCandy);
      if (found) return found;
      if (interview.debrief.improvements.length > 0) return interview.debrief.improvements[0];
    }
    // Try debrief.top_moments
    if (interview.debrief?.top_moments && Array.isArray(interview.debrief.top_moments)) {
      const found = interview.debrief.top_moments.find(m => m && m._isCandy);
      if (found) return found;
    }
    // Try legacy improvements
    if (Array.isArray(interview.improvements) && interview.improvements.length > 0) {
      const firstImp = interview.improvements[0];
      if (typeof firstImp === "object" && firstImp !== null) return firstImp;
      return {
        point: firstImp,
        evidence: "This key gap was identified during your system architecture review.",
      };
    }
    // Ultimate fallback
    return {
      point: "Formalize scalability limits & data partition throughput",
      evidence: "You did not systematically calculate write IOPS or cache hit ratios for concurrent connections under peak loads.",
    };
  }, [interview]);

  const hasCanvasScene = useMemo(
    () => Array.isArray(interview?.canvas_scene?.elements) && interview.canvas_scene.elements.length > 0,
    [interview]
  );

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

  const debrief = interview.debrief;
  const isBasicReport =
    interview.entitlements?.reportLevel === "basic" || Boolean(interview._reportRedacted);

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
              {debrief?.verdict ? <VerdictBadge verdict={debrief.verdict} /> : null}
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
            </div>
          </div>
        </div>
      </motion.div>

      {isBasicReport ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 rounded-2xl border border-accent/30 bg-accent/5 px-5 py-4 text-sm text-muted-foreground leading-relaxed"
        >
          Your overall score is <strong className="text-foreground">{interview.overall_score ?? "—"}%</strong>.
          {debrief?.verdict ? (
            <>
              {" "}
              Verdict: <strong className="text-foreground">{debrief.verdict}</strong>.
            </>
          ) : null}{" "}
          Unlock signal-level evidence, reveal your blind spots, and see the hiring manager's perspective.
        </motion.div>
      ) : null}

      {/* Give Away "One Piece of Candy": Free actionable weakness insight */}
      {isBasicReport && candyInsight && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-6 md:p-8 mb-8 shadow-sm relative overflow-hidden"
        >
          {/* Decorative radial gradient highlight */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full filter blur-2xl pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-start gap-4">
            <div className="rounded-2xl bg-amber-500/15 p-3 shrink-0 self-start">
              <Lightbulb className="w-6 h-6 text-amber-500" />
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/25">
                  Free Preview Insight
                </span>
                <h3 className="font-space text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Critical Growth Area
                </h3>
              </div>

              <p className="font-space text-lg font-bold text-foreground">
                {candyInsight.point}
              </p>

              {candyInsight.evidence ? (
                <div className="mt-3 text-sm text-muted-foreground leading-relaxed italic bg-background/40 border border-border/30 rounded-2xl p-4">
                  &ldquo;{candyInsight.evidence}&rdquo;
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground/80 mt-3 pt-2 border-t border-border/20">
                This is a sample technical growth area. Upgrade your plan to reveal all high-value strengths, design weaknesses, and signal-level transcript evidence.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Relative container for secure skeleton blur gate */}
      <div className="relative mt-10">
        
        {/* Main report layouts - fully rendered with mock data but blurred if basic */}
        <div className={cn(
          "transition-all duration-300",
          isBasicReport && "filter blur-[6px] opacity-35 pointer-events-none select-none"
        )}>
          
          {/* Top Fold Summary & Recommendations */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.02 }}
            className="bg-card rounded-3xl border border-border/50 p-6 mb-8"
          >
            <h2 className="font-space text-lg font-semibold mb-6 flex items-center gap-2 border-b border-border/30 pb-3">
              <Sparkles className="w-5 h-5 text-accent" /> Summary & Recommendations
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left Column: Strengths */}
              <div className="space-y-4">
                {newShape && debrief ? (
                  <>
                    {Array.isArray(debrief.strengths) && debrief.strengths.length > 0 && (
                      <div>
                        <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" /> Strengths
                        </h3>
                        <MomentList items={debrief.strengths} type="strength" onItemClick={handleAnchorLink} />
                      </div>
                    )}

                    {(!debrief.strengths || debrief.strengths.length === 0) && Array.isArray(debrief.top_moments) && debrief.top_moments.filter(m => String(m.type).toLowerCase() === "strength").length > 0 && (
                      <div>
                        <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" /> Strong moments
                        </h3>
                        <MomentList
                          items={debrief.top_moments.filter(m => String(m.type).toLowerCase() === "strength")}
                          type="strength"
                          onItemClick={handleAnchorLink}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {Array.isArray(interview.strengths) && interview.strengths.length > 0 && (
                      <div>
                        <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" /> Strengths
                        </h3>
                        <ul className="space-y-3">
                          {interview.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 flex-shrink-0" />
                              <p className="text-sm text-muted-foreground">{s}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right Column: Areas to improve */}
              <div className="space-y-4">
                {newShape && debrief ? (
                  <>
                    {Array.isArray(debrief.improvements) && debrief.improvements.length > 0 && (
                      <div>
                        <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" /> Areas to improve
                        </h3>
                        <MomentList items={debrief.improvements} type="gap" onItemClick={handleAnchorLink} />
                      </div>
                    )}

                    {(!debrief.improvements || debrief.improvements.length === 0) && Array.isArray(debrief.top_moments) && debrief.top_moments.filter(m => String(m.type).toLowerCase() === "gap").length > 0 && (
                      <div>
                        <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" /> Areas to improve
                        </h3>
                        <MomentList
                          items={debrief.top_moments.filter(m => String(m.type).toLowerCase() === "gap")}
                          type="gap"
                          onItemClick={handleAnchorLink}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {Array.isArray(interview.improvements) && interview.improvements.length > 0 && (
                      <div>
                        <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" /> Areas to improve
                        </h3>
                        <ul className="space-y-3">
                          {interview.improvements.map((s, i) => (
                            <li key={i} className="flex items-start gap-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 flex-shrink-0" />
                              <p className="text-sm text-muted-foreground">{s}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Bottom Section: Focus next session */}
            <div className="border-t border-border/30 pt-6 mt-6">
              <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-accent" /> Focus next session
              </h3>
              {newShape && debrief && Array.isArray(debrief.next_session_focus) && debrief.next_session_focus.length > 0 ? (
                <ul className="grid sm:grid-cols-2 gap-3">
                  {debrief.next_session_focus.map((s, i) => {
                    if (s != null && typeof s === "object" && (s.area != null || s.reason != null)) {
                      return (
                        <li
                          key={i}
                          className="rounded-xl bg-accent/10 text-accent-foreground border border-accent/25 px-3 py-2.5 text-xs flex flex-col justify-center"
                        >
                          <span className="font-semibold text-foreground block">{s.area || "Focus"}</span>
                          {s.reason ? (
                            <span className="text-muted-foreground mt-1 block">{s.reason}</span>
                          ) : null}
                        </li>
                      );
                    }
                    return (
                      <li
                        key={i}
                        className="rounded-xl bg-accent/10 text-accent-foreground border border-accent/25 px-3 py-2 text-xs flex items-center"
                      >
                        {String(s)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-xl bg-accent/10 border border-accent/20 px-4 py-4 text-xs text-muted-foreground leading-relaxed">
                  <p className="font-medium text-foreground mb-1">Coaching Recommendation</p>
                  To elevate your performance for the next session, focus on structure and articulating trade-offs explicitly. Practice breaking down systems and sizing their scale parameters systematically within the first 10 minutes.
                </div>
              )}
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
              <button
                type="button"
                onClick={() => !isBasicReport && setTranscriptOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-3 mb-3 rounded-xl border border-border/40 bg-card/40 px-4 py-3 hover:bg-card/60 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquareText className="w-5 h-5 text-accent shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="font-space text-lg font-semibold leading-none">Transcript</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isBasicReport ? "Full conversation history (Locked)" : transcriptOpen ? "Hide transcript" : "Show transcript"}
                    </p>
                  </div>
                </div>
                {!isBasicReport && (
                  transcriptOpen ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )
                )}
              </button>

              {(transcriptOpen || isBasicReport) ? (
                <InterviewTranscript
                  messages={transcriptMessages}
                  title="Interview transcript"
                  subtitle={
                    orchestrated
                      ? "Full conversation from this design session"
                      : "Questions and your answers as recorded"
                  }
                  autoScroll={false}
                  highlightedIndex={highlightedMsgIndex}
                  className="min-h-0 w-full max-w-4xl max-h-[min(320px,40vh)] sm:max-h-[min(380px,46vh)] md:max-h-[min(420px,50vh)]"
                />
              ) : null}
            </motion.div>
          )}

          {/* Exdraw canvas */}
          {hasCanvasScene && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 }}
              className="mb-8"
            >
              <button
                type="button"
                onClick={() => !isBasicReport && setCanvasOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-3 mb-3 rounded-xl border border-border/40 bg-card/40 px-4 py-3 hover:bg-card/60 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Target className="w-5 h-5 text-accent shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="font-space text-lg font-semibold leading-none">Exdraw canvas</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isBasicReport ? "Whiteboard sketch replay (Locked)" : canvasOpen ? "Hide canvas" : "Show canvas"}
                    </p>
                  </div>
                </div>
                {!isBasicReport && (
                  canvasOpen ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )
                )}
              </button>

              {(canvasOpen || isBasicReport) ? <ReportCanvas scene={interview.canvas_scene} /> : null}
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
              {debrief.summary ? (
                <div className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-line">
                  {debrief.summary}
                </div>
              ) : debrief.verdict_reason || debrief.verdict_summary ? (
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {debrief.verdict_reason || debrief.verdict_summary}
                </p>
              ) : null}
              {debrief.completion_note ? (
                <p className="text-xs text-muted-foreground border border-border/40 rounded-xl px-3 py-2 mb-6 bg-muted/20">
                  {debrief.completion_note}
                </p>
              ) : null}

              {sectionRows.length > 0 ? (
                <div className="space-y-3 mb-8">
                  <h3 className="font-space text-sm font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-accent" /> Section breakdown
                  </h3>
                  {sectionRows.map((row) => (
                    <SectionScoreCard key={row.id} id={row.id} label={row.label} entry={row.entry} />
                  ))}
                </div>
              ) : null}

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
          {/* Pre-orchestrator interviews render the original 5-pip / per-question shape. */}
          {!newShape && (
            <LegacyReportSections
              interview={interview}
              chartQuestions={chartQuestions}
              orchestrated={orchestrated}
              expandedQ={isBasicReport ? 0 : expandedQ}
              setExpandedQ={setExpandedQ}
            />
          )}
        </div>

        {/* Premium Floating Consolidated Upgrade Card */}
        {isBasicReport && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-start pt-12 px-4 bg-gradient-to-b from-transparent via-background/10 to-background/95">
            <motion.div
              initial={{ opacity: 0, y: 35 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-lg rounded-3xl border border-accent/25 bg-card/90 backdrop-blur-xl p-8 shadow-[0_0_55px_rgba(var(--accent),0.15)] flex flex-col items-center text-center relative overflow-hidden"
            >
              {/* Decorative premium glow spots */}
              <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/20 filter blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-accent/10 filter blur-3xl pointer-events-none" />
              
              {/* Premium sparkly lock badge */}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 border border-accent/20 px-3 py-1 text-xs font-semibold text-accent mb-6">
                <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Unlock Premium Analysis
              </div>

              <h3 className="font-space text-2xl lg:text-3xl font-extrabold text-foreground mb-3 tracking-tight">
                Unlock your competitive edge
              </h3>
              
              <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
                Upgrade to a premium plan to reveal full AI performance evidence and perfect your next system design session.
              </p>

              {/* Value-driven benefits (User requested copy) */}
              <ul className="w-full text-left space-y-3.5 mb-8">
                <li className="flex items-start gap-3">
                  <div className="rounded-full bg-accent/15 p-1 mt-0.5 shrink-0">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">Unlock signal-level evidence</p>
                    <p className="text-[11px] text-muted-foreground">Trace precise strengths & weaknesses back to specific transcript exchanges.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="rounded-full bg-accent/15 p-1 mt-0.5 shrink-0">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">Reveal your blind spots</p>
                    <p className="text-[11px] text-muted-foreground">Find out which rubric criteria are pulling down your overall rating.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="rounded-full bg-accent/15 p-1 mt-0.5 shrink-0">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">See the hiring manager's perspective</p>
                    <p className="text-[11px] text-muted-foreground">Understand the subtext behind the verdict and how high-bar interviewers grade.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="rounded-full bg-accent/15 p-1 mt-0.5 shrink-0">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">Full canvas replay & search</p>
                    <p className="text-[11px] text-muted-foreground">Get access to your entire sketch timeline and search the full conversation.</p>
                  </div>
                </li>
              </ul>

              {/* Upgrade CTA */}
              <Button
                onClick={() => navigate("/billing")}
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-semibold py-6 rounded-2xl shadow-lg transition-all duration-300 hover:scale-[1.02] flex items-center justify-center gap-2 group"
              >
                View plans & unlock <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>

              <p className="text-[10px] text-muted-foreground mt-4">
                Join 12,000+ candidates hired at Google, Meta, and OpenAI.
              </p>
            </motion.div>
          </div>
        )}
      </div>
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
