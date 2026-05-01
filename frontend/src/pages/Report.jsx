import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInterview } from '@/api/interviews';
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

export default function Report() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const interviewId = urlParams.get("id");
  const [interview, setInterview] = useState(null);
  const [expandedQ, setExpandedQ] = useState(null);

  useEffect(() => {
    if (!interviewId) { navigate("/dashboard"); return; }
    getInterview(interviewId).then(setInterview);
  }, [interviewId]);

  const orchestrated = Boolean(interview && isOrchestratedSession(interview));
  const transcriptMessages = useMemo(() => {
    if (!interview) return [];
    return buildReportTranscriptMessages(interview);
  }, [interview]);
  const chartQuestions = useMemo(() => {
    if (!interview) return [];
    if (isOrchestratedSession(interview)) return aggregateOrchestratedQuestionsForCharts(interview);
    return interview.questions || [];
  }, [interview]);

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

  const sessionBreakdownRow = orchestrated ? chartQuestions[0] : null;
  const sessionAvgScore = sessionBreakdownRow
    ? Math.round(
        (sessionBreakdownRow.score_answer_quality +
          sessionBreakdownRow.score_english_clarity +
          sessionBreakdownRow.score_communication) /
          3
      )
    : 0;

  const SESSION_EXPAND_KEY = "session";

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
              <span>{reportedQuestionCountLabel(interview)}</span>
              <span>{formatInterviewType(interview.interview_type)} interview</span>
            </div>
          </div>
        </div>
      </motion.div>

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

      {/* Structured debrief (system design / primary_question templates) */}
      {interview.debrief && typeof interview.debrief === 'object' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-card rounded-3xl border border-border/50 p-8 lg:p-10 mb-8"
        >
          <h2 className="font-space text-lg font-semibold mb-2">Interview debrief</h2>
          <p className="text-xs text-muted-foreground mb-6">Structured assessment from your session transcript</p>
          <div className="flex flex-wrap items-baseline gap-3 mb-4">
            <span className="font-space text-2xl font-bold">{interview.debrief.verdict || '—'}</span>
            {interview.debrief.overall_score ? (
              <span className="text-sm text-muted-foreground font-space">
                Overall: <span className="font-semibold text-foreground">{interview.debrief.overall_score}</span>
              </span>
            ) : null}
          </div>
          {(interview.debrief.verdict_reason || interview.debrief.verdict_summary) && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              {interview.debrief.verdict_reason || interview.debrief.verdict_summary}
            </p>
          )}
          {interview.debrief.completion_note ? (
            <p className="text-xs text-muted-foreground border border-border/40 rounded-xl px-3 py-2 mb-8 bg-muted/20">
              {interview.debrief.completion_note}
            </p>
          ) : null}
          {interview.debrief.section_scores && typeof interview.debrief.section_scores === 'object' && (
            <div className="mb-8">
              <h3 className="font-space text-sm font-semibold mb-3">Section scores (1–4)</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {Object.entries(interview.debrief.section_scores).map(([id, rawEntry]) => {
                  const label = (interview.execution_plan?.sections || []).find((s) => s.id === id)?.name || id;
                  const entry =
                    rawEntry != null && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
                      ? rawEntry
                      : { score: rawEntry, comment: '', status: '' };
                  const nestedSd =
                    entry &&
                    typeof entry === 'object' &&
                    'weighted_score' in entry &&
                    Array.isArray(entry.signals);
                  if (nestedSd) {
                    const status = entry.status ? String(entry.status) : '';
                    return (
                      <div
                        key={id}
                        className="flex flex-col gap-2 rounded-xl border border-border/50 px-4 py-3 text-sm sm:col-span-2"
                      >
                        <div className="flex justify-between gap-3 items-start">
                          <span className="text-muted-foreground">{label}</span>
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <span className="font-space font-semibold">{entry.weighted_score || '—'}</span>
                            {status ? (
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {status.replace(/_/g, ' ')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <ul className="space-y-2 border-t border-border/40 pt-2 mt-1">
                          {entry.signals.map((sig, j) => (
                            <li key={j} className="text-xs text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground">{sig.signal || 'Signal'}</span>
                              {sig.score != null && sig.score !== '' ? (
                                <span className="ml-2 font-space text-foreground">{sig.score}/4</span>
                              ) : null}
                              {sig.evidence ? (
                                <p className="mt-0.5 italic">&ldquo;{sig.evidence}&rdquo;</p>
                              ) : null}
                              {sig.what_it_means ? <p className="mt-0.5">{sig.what_it_means}</p> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }
                  const comment = entry.comment;
                  const status = entry.status ? String(entry.status) : '';
                  const scoreLabel =
                    entry.score === null || entry.score === undefined || entry.score === ''
                      ? '—'
                      : String(entry.score);
                  return (
                    <div
                      key={id}
                      className="flex flex-col gap-1 rounded-xl border border-border/50 px-4 py-3 text-sm"
                    >
                      <div className="flex justify-between gap-3 items-start">
                        <span className="text-muted-foreground">{label}</span>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className="font-space font-semibold">{scoreLabel}</span>
                          {status ? (
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {status.replace(/_/g, ' ')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {comment ? (
                        <p className="text-xs text-muted-foreground leading-relaxed">{comment}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {Array.isArray(interview.debrief.top_moments) && interview.debrief.top_moments.length > 0 && (
            <div className="mb-8">
              <h3 className="font-space text-sm font-semibold mb-3">Top moments</h3>
              <ul className="space-y-3">
                {interview.debrief.top_moments.map((m, i) => (
                  <li
                    key={i}
                    className={`text-sm border-l-2 pl-3 ${
                      String(m.type).toLowerCase() === 'strength'
                        ? 'border-emerald-500/40'
                        : 'border-amber-500/40'
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.type}</span>
                    <p className="font-medium text-foreground">{m.moment}</p>
                    {m.why_it_matters ? (
                      <p className="text-xs text-muted-foreground mt-1">{m.why_it_matters}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div>
              <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" /> Strengths (with evidence)
              </h3>
              <ul className="space-y-4">
                {(interview.debrief.strengths?.length
                  ? interview.debrief.strengths
                  : (interview.debrief.strengths_evidence || []).map((x) => ({
                      point: x.title,
                      evidence: x.quote || x.detail || '',
                    }))
                ).map((item, i) => (
                  <li key={i} className="text-sm border-l-2 border-emerald-500/40 pl-3">
                    <p className="font-medium text-foreground">{item.point || item.title}</p>
                    {(item.evidence || item.quote) && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        &ldquo;{item.evidence || item.quote}&rdquo;
                      </p>
                    )}
                    {item.detail && !item.evidence && !item.quote ? (
                      <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-space text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Areas to improve
              </h3>
              <ul className="space-y-4">
                {(interview.debrief.improvements?.length
                  ? interview.debrief.improvements
                  : (interview.debrief.improvements_evidence || []).map((x) => ({
                      point: x.title,
                      evidence: x.quote || x.detail || '',
                    }))
                ).map((item, i) => (
                  <li key={i} className="text-sm border-l-2 border-amber-500/40 pl-3">
                    <p className="font-medium text-foreground">{item.point || item.title}</p>
                    {(item.evidence || item.quote) && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        &ldquo;{item.evidence || item.quote}&rdquo;
                      </p>
                    )}
                    {item.detail && !item.evidence && !item.quote ? (
                      <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {interview.debrief.faang_bar_assessment && (
            <div className="rounded-2xl bg-muted/30 border border-border/50 p-5 mb-6">
              <h3 className="font-space text-sm font-semibold mb-2">FAANG bar</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{interview.debrief.faang_bar_assessment}</p>
            </div>
          )}
          {Array.isArray(interview.debrief.next_session_focus) && interview.debrief.next_session_focus.length > 0 && (
            <div>
              <h3 className="font-space text-sm font-semibold mb-2">Next session focus</h3>
              <ul className="flex flex-col gap-2">
                {interview.debrief.next_session_focus.map((s, i) => {
                  if (s != null && typeof s === 'object' && (s.area != null || s.reason != null)) {
                    return (
                      <li
                        key={i}
                        className="rounded-xl bg-accent/10 text-accent-foreground border border-accent/20 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-foreground block">{s.area || 'Focus'}</span>
                        {s.reason ? <span className="text-muted-foreground mt-0.5 block">{s.reason}</span> : null}
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
        </motion.div>
      )}

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

      {/* Question / session breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
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
                    {(interview.questions?.length || 0) > 1 ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {(interview.questions?.length || 0)} exchanges — scored as one exercise
                      </p>
                    ) : null}
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
                    {interview.interview_mode === "video" && sessionBreakdownRow?.score_eye_contact != null ? (
                      <div className="grid grid-cols-2 gap-3">
                        <MiniScore label="Eye contact" score={sessionBreakdownRow.score_eye_contact} />
                        <MiniScore label="Body language" score={sessionBreakdownRow.score_body_language} />
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Per-exchange scores</p>
                      <div className="space-y-4">
                        {(interview.questions || []).map((q, i) => {
                          const tAvg = Math.round(
                            (q.score_answer_quality + q.score_english_clarity + q.score_communication) / 3
                          );
                          return (
                            <div key={i} className="rounded-xl border border-border/40 p-4 bg-muted/20">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-semibold text-foreground">Turn {i + 1}</span>
                                <span className="text-xs font-space text-muted-foreground">Avg {tAvg}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mb-1">Interviewer</p>
                              <p className="text-xs leading-relaxed line-clamp-4">{q.question}</p>
                              <p className="text-[11px] text-muted-foreground mt-2 mb-1">You</p>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">{q.answer}</p>
                              <div className="grid grid-cols-3 gap-2 mt-3">
                                <MiniScore label="Quality" score={q.score_answer_quality} />
                                <MiniScore label="Clarity" score={q.score_english_clarity} />
                                <MiniScore label="Comm." score={q.score_communication} />
                              </div>
                              {q.feedback ? (
                                <p className="text-xs text-muted-foreground mt-2 border-t border-border/30 pt-2">
                                  {q.feedback}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
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