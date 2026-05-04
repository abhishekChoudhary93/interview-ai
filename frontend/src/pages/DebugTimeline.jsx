import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { getInterviewDebugTrace } from "@/api/interviews";

/**
 * Local-only per-turn timeline of the Planner / Executor split.
 *
 * Visible only when `import.meta.env.VITE_DEBUG_TRACE === '1'` (Vite envvar
 * set in `.env.local`). The backend has its own gate: GET /debug-trace
 * returns 404 unless `INTERVIEW_DEBUG_TRACE=1` is set on the server.
 *
 * Each turn renders in two tiers:
 *
 *   Tier 1 (always visible — the glanceable summary):
 *     - Header (turn index · timestamp · section_progress chip)
 *     - Candidate text (truncated)
 *     - Decision chips (signal / move / probe / perf / coverage / tripwires)
 *     - Focus + reply (truncated)
 *
 *   Tier 2 (collapsed by default — the heavy stuff):
 *     - Executor system prompt
 *     - Executor history
 *     - Planner input prompt
 *     - Planner output JSON
 *     - Applied directive
 *
 * Each turn has a "Copy as markdown" button that emits a pasteable summary,
 * and the page header has a "Copy timeline" button that emits the whole
 * thing. eval_history (joined by turn_index) is the source of truth for
 * tripwires + sanitized signal + derived/planner move split.
 */

const DEBUG_FLAG_ON = import.meta.env.VITE_DEBUG_TRACE === "1";

const TRUNCATE_CANDIDATE = 200;
const TRUNCATE_REPLY = 300;
const TRUNCATE_FOCUS = 140;

function truncate(str, n) {
  const s = String(str || "");
  if (s.length <= n) return s;
  return `${s.slice(0, n).trimEnd()}…`;
}

function Pre({ children, className = "" }) {
  return (
    <pre
      className={`bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-words font-mono leading-snug ${className}`}
    >
      {children}
    </pre>
  );
}

function Section({ title, children, defaultOpen = false, accent = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-lg border ${accent ? "border-accent/40 bg-accent/5" : "border-border bg-card/50"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-muted/40 rounded-lg"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>{title}</span>
      </button>
      {open ? <div className="px-3 pb-3 pt-1">{children}</div> : null}
    </div>
  );
}

function Chip({ label, value, tone = "neutral", title, mono = false }) {
  const toneClass = {
    neutral: "bg-muted/40 border-border text-foreground",
    info: "bg-sky-500/10 border-sky-500/40 text-sky-700 dark:text-sky-300",
    good: "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300",
    bad: "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300",
  }[tone];
  return (
    <span
      title={title || `${label}: ${value}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] leading-none ${toneClass}`}
    >
      <span className="uppercase tracking-wide opacity-70">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </span>
  );
}

const PROBE_TONE = { target: "neutral", one_up: "good", one_down: "warn" };
const PERF_TONE = {
  above_target: "good",
  at_target: "neutral",
  at_one_down: "warn",
  below_one_down: "bad",
  unclear: "neutral",
};
const SIGNAL_TONE = {
  driving: "info",
  block_complete: "good",
  asked_question: "info",
  stuck: "warn",
  off_track: "bad",
};
const PROGRESS_TONE = {
  next: "good",
  close: "good",
  wrap: "warn",
  stay: "neutral",
};

function DirectiveCard({ directive }) {
  if (!directive) return <div className="text-xs text-muted-foreground italic">(no directive)</div>;
  const probeColor = {
    target: "text-foreground",
    one_up: "text-emerald-600",
    one_down: "text-amber-600",
  }[directive.recommended_probe_level || "target"];
  const perfColor = {
    above_target: "text-emerald-600",
    at_target: "text-foreground",
    at_one_down: "text-amber-600",
    below_one_down: "text-red-600",
    unclear: "text-muted-foreground",
  }[directive.performance_assessment || "unclear"];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-y-1 gap-x-3 text-xs">
      <div className="text-muted-foreground">Performance</div>
      <div className={`font-mono ${perfColor}`}>{directive.performance_assessment || "—"}</div>
      <div className="text-muted-foreground">Evidence</div>
      <div className="font-mono">{directive.evidence_summary || "—"}</div>
      <div className="text-muted-foreground">Move</div>
      <div className="font-mono font-semibold">{directive.recommended_move || "—"}</div>
      <div className="text-muted-foreground">Focus</div>
      <div className="font-mono italic">"{directive.recommended_focus || "—"}"</div>
      <div className="text-muted-foreground">Probe level</div>
      <div className={`font-mono font-semibold ${probeColor}`}>
        {directive.recommended_probe_level || "—"}
      </div>
      {Array.isArray(directive.hand_off_targets) && directive.hand_off_targets.length > 0 ? (
        <>
          <div className="text-muted-foreground">Hand-off targets</div>
          <div className="font-mono">
            {directive.hand_off_targets.map((t, i) => (
              <div key={i}>· {t}</div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TripwireChips({ evalRow }) {
  if (!evalRow) return null;
  const flags = [
    ["leak_guard_triggered", "leak"],
    ["reply_leak_triggered", "reply-leak"],
    ["calibrated_advance_triggered", "calibrated-advance"],
    ["stuck_loop_advance_triggered", "stuck-loop-advance"],
    ["handoff_reconciliation_triggered", "handoff-reconcile"],
  ];
  return (
    <>
      {flags.map(([key, label]) =>
        evalRow[key] ? (
          <Chip
            key={key}
            label="!"
            value={label}
            tone={
              key === "calibrated_advance_triggered" ||
              key === "handoff_reconciliation_triggered"
                ? "info"
                : key === "stuck_loop_advance_triggered"
                ? "warn"
                : "bad"
            }
            title={key}
          />
        ) : null
      )}
    </>
  );
}

function DecisionRow({ entry, evalRow }) {
  const planner = entry.planner;
  const directive = planner?.applied_directive;
  const json = planner?.output_json || {};

  const signal = evalRow?.candidate_signal || json.candidate_signal || "—";
  const derivedMove = evalRow?.derived_move || directive?.recommended_move || "—";
  const plannerMove = evalRow?.planner_recommended_move || json.recommended_move || derivedMove;
  const moveDiffers = derivedMove !== plannerMove && plannerMove && plannerMove !== "—";
  const probe = evalRow?.derived_probe || directive?.recommended_probe_level || "—";
  const perf = evalRow?.performance_assessment || directive?.performance_assessment || "unclear";
  const coverageOk = evalRow?.coverage_ok === true;
  const progress = evalRow?.section_progress || planner?.section_progress_decision || "—";
  const elapsed = evalRow?.elapsed_fraction;
  const sectionPressure = evalRow?.section_pressure;
  const nudges = evalRow?.section_nudge_count;
  const cbc = evalRow?.consecutive_block_complete;
  const noProgress = evalRow?.consecutive_no_progress;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Chip label="signal" value={signal} tone={SIGNAL_TONE[signal] || "neutral"} mono />
      <Chip
        label="move"
        value={moveDiffers ? `${plannerMove} → ${derivedMove}` : derivedMove}
        tone={moveDiffers ? "warn" : "neutral"}
        title={moveDiffers ? "Planner pick was overridden by JS" : "Planner pick honored"}
        mono
      />
      <Chip label="probe" value={probe} tone={PROBE_TONE[probe] || "neutral"} mono />
      <Chip label="perf" value={perf} tone={PERF_TONE[perf] || "neutral"} mono />
      <Chip
        label="cov"
        value={coverageOk ? "ok" : "miss"}
        tone={coverageOk ? "good" : "warn"}
        mono
      />
      <Chip label="prog" value={progress} tone={PROGRESS_TONE[progress] || "neutral"} mono />
      {typeof elapsed === "number" ? (
        <Chip label="elapsed" value={`${Math.round(elapsed * 100)}%`} tone="neutral" mono title="section budget elapsed" />
      ) : null}
      {typeof sectionPressure === "number" && sectionPressure > 0.05 ? (
        <Chip
          label="pressure"
          value={sectionPressure.toFixed(2)}
          tone={sectionPressure >= 0.2 ? "warn" : "neutral"}
          mono
          title="interview-wide pressure (sectionsExpected − sectionsDone)"
        />
      ) : null}
      {typeof nudges === "number" && nudges > 0 ? (
        <Chip label="nudges" value={String(nudges)} tone={nudges >= 2 ? "warn" : "neutral"} mono />
      ) : null}
      {typeof cbc === "number" && cbc > 0 ? (
        <Chip label="block_done×" value={String(cbc)} tone={cbc >= 2 ? "warn" : "neutral"} mono />
      ) : null}
      {typeof noProgress === "number" && noProgress > 0 ? (
        <Chip
          label="no_prog×"
          value={String(noProgress)}
          tone={noProgress >= 4 ? "warn" : "neutral"}
          mono
          title="consecutive driving turns with no coverage / no rubric updates — stuck-loop detector"
        />
      ) : null}
      <TripwireChips evalRow={evalRow} />
    </div>
  );
}

function turnAsMarkdown(entry, evalRow, index) {
  const planner = entry.planner;
  const directive = planner?.applied_directive;
  const json = planner?.output_json || {};
  const turnIdx = entry.turn_index ?? index + 1;
  const ts = entry.ts ? new Date(entry.ts).toISOString() : "";

  const signal = evalRow?.candidate_signal || json.candidate_signal || "—";
  const derivedMove = evalRow?.derived_move || directive?.recommended_move || "—";
  const plannerMove = evalRow?.planner_recommended_move || json.recommended_move || derivedMove;
  const probe = evalRow?.derived_probe || directive?.recommended_probe_level || "—";
  const perf = evalRow?.performance_assessment || directive?.performance_assessment || "unclear";
  const progress = evalRow?.section_progress || planner?.section_progress_decision || "—";
  const coverageOk = evalRow?.coverage_ok === true;
  const elapsed = evalRow?.elapsed_fraction;

  const flags = [];
  if (evalRow?.leak_guard_triggered) flags.push("leak");
  if (evalRow?.reply_leak_triggered) flags.push("reply-leak");
  if (evalRow?.calibrated_advance_triggered) flags.push("calibrated-advance");
  if (evalRow?.stuck_loop_advance_triggered) flags.push("stuck-loop-advance");
  if (evalRow?.handoff_reconciliation_triggered) flags.push("handoff-reconcile");

  const moveStr = plannerMove !== derivedMove ? `${plannerMove}→${derivedMove}` : derivedMove;
  const elapsedStr = typeof elapsed === "number" ? ` ${Math.round(elapsed * 100)}%` : "";
  const cov = coverageOk ? "cov✓" : "cov✗";
  const flagsStr = flags.length > 0 ? `\n    flags:     ${flags.join(", ")}` : "";

  const candidate = truncate(entry.candidate_message || "", TRUNCATE_REPLY);
  const reply = truncate(entry.executor?.reply || "", TRUNCATE_REPLY);
  const focus = directive?.recommended_focus
    ? truncate(directive.recommended_focus, TRUNCATE_FOCUS)
    : "";
  const focusStr = focus ? `\n    focus:     "${focus}"` : "";

  return [
    `T${turnIdx}${ts ? ` (${ts})` : ""}  ${signal} → ${moveStr}/${probe} ${cov}${elapsedStr}  perf=${perf}  prog=${progress}`,
    `    candidate: "${candidate}"`,
    reply ? `    reply:     "${reply}"` : null,
    focusStr || null,
    flagsStr || null,
  ]
    .filter(Boolean)
    .join("\n");
}

function copyToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

function CopyButton({ getText, label = "Copy as markdown" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        copyToClipboard(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted/40"
    >
      <Copy className="w-3 h-3" />
      {copied ? "Copied" : label}
    </button>
  );
}

function TurnCard({ entry, evalRow, index }) {
  const planner = entry.planner;
  const executor = entry.executor;
  const directive = planner?.applied_directive;
  const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "";
  const turnIdx = entry.turn_index ?? index + 1;

  const focus = directive?.recommended_focus
    ? truncate(directive.recommended_focus, TRUNCATE_FOCUS)
    : "";
  const reply = executor?.reply ? truncate(executor.reply, TRUNCATE_REPLY) : "";
  const candidate = truncate(entry.candidate_message || "(no message)", TRUNCATE_CANDIDATE);

  return (
    <div className="relative pl-10 pb-6">
      <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-accent ring-4 ring-accent/20" />
      <div className="absolute left-4 top-3 bottom-0 w-px bg-border" />

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        {/* Header */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-sm tabular-nums">
            T{turnIdx}
            {ts ? <span className="ml-2 text-xs text-muted-foreground font-normal">{ts}</span> : null}
            {executor?.duration_ms != null ? (
              <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                exec {executor.duration_ms}ms
              </span>
            ) : null}
            {planner?.duration_ms != null ? (
              <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                · plan {planner.duration_ms}ms
              </span>
            ) : null}
          </h3>
          <CopyButton getText={() => turnAsMarkdown(entry, evalRow, index)} label="copy" />
        </div>

        {/* Decision chips */}
        <DecisionRow entry={entry} evalRow={evalRow} />

        {/* Tier 1: candidate / focus / reply */}
        <div className="text-xs leading-relaxed space-y-1.5">
          <div>
            <span className="text-muted-foreground">candidate:</span>{" "}
            <span className="font-mono">{candidate}</span>
          </div>
          {focus ? (
            <div>
              <span className="text-muted-foreground">focus:</span>{" "}
              <span className="font-mono italic">"{focus}"</span>
            </div>
          ) : null}
          {reply ? (
            <div>
              <span className="text-muted-foreground">reply:</span>{" "}
              <span className="font-mono">{reply}</span>
            </div>
          ) : null}
        </div>

        {/* Tier 2: collapsed details */}
        <div className="space-y-2">
          {executor ? (
            <>
              <Section title={`Executor system prompt (${executor.model || "?"})`}>
                <Pre>{executor.system_prompt || "(empty)"}</Pre>
              </Section>
              {Array.isArray(executor.history_messages) && executor.history_messages.length > 0 ? (
                <Section
                  title={`Executor history (${executor.history_messages.length} messages)`}
                >
                  <Pre>{JSON.stringify(executor.history_messages, null, 2)}</Pre>
                </Section>
              ) : null}
              {executor.reply && executor.reply.length > TRUNCATE_REPLY ? (
                <Section title="Executor reply (full)">
                  <Pre>{executor.reply}</Pre>
                </Section>
              ) : null}
            </>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No executor capture (turn pre-dated debug flag).
            </p>
          )}

          {planner ? (
            <>
              <Section title={`Planner input (${planner.model || "?"})`}>
                <Pre>{planner.input_prompt || "(empty)"}</Pre>
              </Section>
              <Section title="Planner output JSON">
                <Pre>{JSON.stringify(planner.output_json, null, 2)}</Pre>
              </Section>
              <Section title="Applied directive (input to NEXT executor turn)" accent>
                <DirectiveCard directive={directive} />
              </Section>
              {evalRow ? (
                <Section title="Eval history row (audit trail)">
                  <Pre>{JSON.stringify(evalRow, null, 2)}</Pre>
                </Section>
              ) : null}
              {planner.error ? (
                <Pre className="text-red-600">Planner error: {planner.error}</Pre>
              ) : null}
            </>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No planner capture (turn pre-dated debug flag).
            </p>
          )}

          {entry.candidate_message && entry.candidate_message.length > TRUNCATE_CANDIDATE ? (
            <Section title="Candidate message (full)">
              <Pre>{entry.candidate_message}</Pre>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function DebugTimeline() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!DEBUG_FLAG_ON) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await getInterviewDebugTrace(id);
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Index eval_history by turn_index so each TurnCard can pull its row
  // without an O(n²) lookup.
  const evalByTurn = useMemo(() => {
    const map = new Map();
    const rows = Array.isArray(data?.eval_history) ? data.eval_history : [];
    for (const row of rows) {
      if (typeof row?.turn_index === "number") {
        map.set(row.turn_index, row);
      }
    }
    return map;
  }, [data]);

  const trace = Array.isArray(data?.trace) ? data.trace : [];

  const timelineMarkdown = useMemo(() => {
    if (trace.length === 0) return "";
    const header = `Debug timeline · interview ${id}${data?.target_level ? ` · target=${data.target_level}` : ""}${data?.interview_type ? ` · type=${data.interview_type}` : ""}`;
    const body = trace
      .map((entry, i) =>
        turnAsMarkdown(entry, evalByTurn.get(entry.turn_index ?? i + 1), i)
      )
      .join("\n\n");
    return `${header}\n\n${body}`;
  }, [trace, evalByTurn, id, data]);

  if (!DEBUG_FLAG_ON) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Debug timeline disabled</h1>
          <p className="text-sm text-muted-foreground">
            Set <code className="font-mono bg-muted px-1.5 py-0.5 rounded">VITE_DEBUG_TRACE=1</code> in
            <code className="font-mono bg-muted px-1.5 py-0.5 rounded mx-1">.env.local</code> and restart Vite to enable.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    const not404 = error?.status !== 404;
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">
            {not404 ? "Debug trace failed" : "Debug trace not enabled"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {not404
              ? error.message
              : "The backend has not enabled INTERVIEW_DEBUG_TRACE=1, or this interview ran before it was enabled."}
          </p>
          <Link
            to={`/interview?id=${encodeURIComponent(id)}`}
            className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> Back to interview
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      <div className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <Link
            to={`/interview?id=${encodeURIComponent(id)}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to interview
          </Link>
          <h1 className="text-2xl font-semibold">Debug timeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Interview <code className="font-mono">{id}</code>
            {data?.target_level ? <> · target_level: <code className="font-mono">{data.target_level}</code></> : null}
            {data?.interview_type ? <> · type: <code className="font-mono">{data.interview_type}</code></> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {trace.length > 0 ? (
            <CopyButton getText={() => timelineMarkdown} label="Copy timeline" />
          ) : null}
          <span className="text-xs px-2 py-1 rounded bg-muted/40 border border-border">
            {trace.length} turn{trace.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {trace.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-12">
          No turns captured yet. Take a turn in the interview to populate the trace.
        </div>
      ) : (
        <div className="relative">
          {trace.map((entry, i) => (
            <TurnCard
              key={i}
              entry={entry}
              evalRow={evalByTurn.get(entry.turn_index ?? i + 1)}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
