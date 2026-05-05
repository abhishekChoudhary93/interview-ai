import { loadInterviewConfig, INTERVIEW_CONFIG_ID } from './interviewConfig.js';
import { streamInterviewerReply, generateOpeningLine } from './interviewConverse.js';
import {
  captureTurnEval,
  applyEvalToSessionState,
} from './interviewEvalCapture.js';

/**
 * Years-of-experience bands recognized by the create-interview API. Lives here
 * because it's still used by the route for input validation.
 */
export const YEARS_EXPERIENCE_BANDS = ['0_2', '2_5', '5_8', '8_12', '12_plus'];

/**
 * Hard turn cap. Beyond this we force a wrap regardless of bar judgment —
 * this is a safety net only. The Planner is responsible for getting the
 * interview to a clean close before this (via `interview_done=true` after
 * the 45-minute floor).
 */
const HARD_TURN_CAP = 60;

/**
 * v5 Initial session_state shape. Section progression is not tracked here —
 * the Planner directs all transitions. We seed `opening_phase='awaiting_ack'`
 * so the deterministic conversational opening line goes out before any LLM
 * call.
 *
 * Persisted fields:
 *   opening_phase             — 'awaiting_ack' | 'in_progress'
 *   turn_count                — interviewer turn counter (HARD_TURN_CAP safety)
 *   session_wall_start_ms     — ms timestamp; basis for total elapsed
 *   last_turn_ts              — ms timestamp of previous turn (per-section delta)
 *   eval_history[]            — every Planner emission (capped 80)
 *   probe_queue               — { [sectionId]: [{id, observation, probe, probe_type, difficulty, added_at_turn, consumed, consumed_at_turn}] }
 *   flags_by_section          — { [sectionId]: [{type:'green'|'red', signal_id, note, at_turn}] }
 *   section_minutes_used      — { [sectionId]: minutes spent (advisory) }
 *   performance_by_section    — { [sectionId]: 'above_target'|'at_target'|'below_target' }
 *
 *   v5 NEW substrate fields:
 *   requirements_contract     — null until Planner emits locked=true; immutable thereafter
 *   breadth_coverage          — { components_mentioned[], components_missing[] } (snapshot)
 *   response_pace             — 'fast'|'normal'|'slow'|'suspiciously_fast' (latest)
 *   pace_turns_tracked        — integer; how many consecutive turns at this pace
 *   verdict_trajectory        — 'strong_hire'|'hire'|'no_hire'|'strong_no_hire'|'insufficient_data'
 *
 *   next_directive            — last-applied Planner directive; the Executor reads this
 *   interview_done            — terminal flag
 */
function buildInitialSessionState(now) {
  return {
    opening_phase: 'awaiting_ack',
    turn_count: 0,
    session_wall_start_ms: now,
    last_turn_ts: now,
    eval_history: [],
    probe_queue: {},
    flags_by_section: {},
    section_minutes_used: {},
    performance_by_section: {},

    requirements_contract: null,
    breadth_coverage: { components_mentioned: [], components_missing: [] },
    response_pace: null,
    pace_turns_tracked: 0,
    verdict_trajectory: 'insufficient_data',

    next_directive: null,
    interview_done: false,
  };
}

/**
 * Idempotent session start. If the interview already has an opening turn,
 * return that without re-priming. Otherwise: load the v5 config, snapshot it
 * onto `interview_config`, generate one opening line (deterministic intro —
 * no LLM call), and write it as the first `interviewer` turn.
 *
 * @param {import('../models/Interview.js').Interview} interview mongoose doc
 */
export async function startInterviewSession(interview) {
  const config = loadInterviewConfig();

  const alreadyStarted =
    Array.isArray(interview.conversation_turns) &&
    interview.conversation_turns.some((t) => t.role === 'interviewer');

  if (alreadyStarted && interview.interview_config) {
    return {
      interviewer_message: interview.conversation_turns[0]?.content || '',
      session_state: interview.session_state || {},
      interview_config: interview.interview_config,
      reused: true,
    };
  }

  const now = Date.now();
  interview.interview_config = config;
  interview.template_id = INTERVIEW_CONFIG_ID;
  interview.template_version = 'v5';
  interview.selected_template_id = INTERVIEW_CONFIG_ID;
  interview.session_state = buildInitialSessionState(now);
  interview.target_duration_minutes =
    typeof config.total_minutes === 'number'
      ? config.total_minutes
      : (config.sections || []).reduce((acc, s) => acc + (s.budget_minutes || 0), 0);
  interview.session_started_at = new Date(now);
  if (!Array.isArray(interview.conversation_turns)) interview.conversation_turns = [];

  const openingText = await generateOpeningLine({ interview, config });

  interview.conversation_turns.push({ role: 'interviewer', content: openingText, kind: 'opening' });
  interview.markModified('conversation_turns');
  interview.markModified('session_state');
  interview.markModified('interview_config');
  await interview.save();

  return {
    interviewer_message: openingText,
    session_state: interview.session_state,
    interview_config: interview.interview_config,
    reused: false,
  };
}

/**
 * Append a candidate turn. Returns the new candidate-turn index (1-based).
 */
export function appendCandidateTurn(interview, candidateMessage) {
  if (!Array.isArray(interview.conversation_turns)) interview.conversation_turns = [];
  interview.conversation_turns.push({
    role: 'candidate',
    content: candidateMessage,
    kind: 'answer',
  });
  interview.markModified('conversation_turns');
  return interview.conversation_turns.filter((t) => t.role === 'candidate').length;
}

/**
 * Append a (final) interviewer turn. The streaming layer accumulates tokens
 * and calls this once when the stream completes.
 */
export function appendInterviewerTurn(interview, content, kind = 'reply') {
  if (!Array.isArray(interview.conversation_turns)) interview.conversation_turns = [];
  interview.conversation_turns.push({ role: 'interviewer', content, kind });
  if (!interview.session_state) interview.session_state = {};
  interview.session_state.turn_count = (interview.session_state.turn_count || 0) + 1;

  // Opening protocol phase transition: any reply emitted while phase is
  // `awaiting_ack` advances to `in_progress`. The Executor LLM handles the
  // opening turn uniformly via the OPENING PROTOCOL block in its system
  // prompt — there is no `kind` discrimination here.
  if (interview.session_state.opening_phase === 'awaiting_ack') {
    interview.session_state.opening_phase = 'in_progress';
  }

  interview.markModified('conversation_turns');
  interview.markModified('session_state');
}

/**
 * Run the Planner LLM and apply its directive to the in-memory session_state.
 *
 * Shared by both turn flows:
 *   - T1 (post-stream, fire-and-forget background): wrapped by
 *     `runBackgroundEvalCapture` which adds save + debug-trace assembly.
 *   - T2+ (foreground, Planner-first): called by the route as
 *     `runForegroundEvalCapture`. The route streams the Executor right after
 *     this returns — the Executor reads the freshly-mutated `next_directive`
 *     in-memory, so no save is needed between Planner and Executor.
 *
 * Does NOT save the doc and does NOT assemble debug trace — caller owns
 * those (so T2+ can stitch a single debug entry combining Planner +
 * Executor after both have run). The Planner's __trace is left attached
 * to the returned `captured` for the caller to consume.
 */
async function runPlannerInline(
  interview,
  { config, candidateMessage, interviewerReply, candidateTurnIndex }
) {
  const captured = await captureTurnEval({
    config,
    interview,
    sessionState: interview.session_state,
    candidateMessage,
    interviewerReply,
  });

  const { interviewDone } = applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex,
  });

  const turns = interview.session_state?.turn_count || 0;
  let forcedDone = interviewDone;
  if (turns >= HARD_TURN_CAP) {
    interview.session_state.interview_done = true;
    forcedDone = true;
  }

  return { captured, interviewDone: forcedDone };
}

/**
 * Assemble a combined Executor + Planner debug-trace entry on
 * `session_state.debug_trace[]` (capped at 60). Gated by
 * INTERVIEW_DEBUG_TRACE=1; no-op otherwise. Mutates `captured.__trace` (deletes
 * it) so the caller doesn't accidentally persist the raw Planner trace twice.
 */
export function recordDebugTraceEntry(
  interview,
  { candidateTurnIndex, candidateMessage, captured, executorTrace }
) {
  if (process.env.INTERVIEW_DEBUG_TRACE !== '1') return;
  const ss = interview.session_state;
  if (!Array.isArray(ss.debug_trace)) ss.debug_trace = [];
  const plannerTrace = captured?.__trace || null;
  ss.debug_trace.push({
    turn_index: candidateTurnIndex,
    ts: new Date().toISOString(),
    candidate_message: candidateMessage,
    executor: executorTrace || null,
    planner: plannerTrace
      ? {
          model: plannerTrace.model,
          input_prompt: plannerTrace.input_prompt,
          input_messages: plannerTrace.input_messages || null,
          output_json: plannerTrace.output_json,
          duration_ms: plannerTrace.duration_ms,
          usage: plannerTrace.usage || null,
          error: plannerTrace.error || null,
          applied_directive: ss.next_directive || null,
          recommended_section_focus_id: captured?.recommended_section_focus_id || '',
        }
      : null,
  });
  if (ss.debug_trace.length > 60) ss.debug_trace = ss.debug_trace.slice(-60);
  if (captured) delete captured.__trace;
}

/**
 * Foreground variant — runs the Planner inline and returns. Caller owns
 * doc.save() and debug-trace assembly. Used for T2+ (Planner-first per turn)
 * so the Executor's next stream reads the freshly-mutated `next_directive`.
 */
export async function runForegroundEvalCapture(interview, opts) {
  return runPlannerInline(interview, opts);
}

/**
 * Background-callable: run the Planner LLM and persist its output onto the
 * interview row.
 *
 * Used for T1 only in the v5 Planner-first flow — T1's Executor reply is
 * the deterministic problem-statement handoff (Opening Protocol), so
 * Planner classification of T1 is signal-only and runs after the SSE
 * stream ends to keep the user's UI snappy.
 *
 * `executorTrace` (optional) carries the Executor's per-turn capture. When
 * INTERVIEW_DEBUG_TRACE=1 is set, this function assembles the combined
 * Executor + Planner debug entry via `recordDebugTraceEntry`.
 */
export async function runBackgroundEvalCapture(
  interview,
  { config, candidateMessage, interviewerReply, candidateTurnIndex, executorTrace }
) {
  const { captured, interviewDone } = await runPlannerInline(interview, {
    config,
    candidateMessage,
    interviewerReply,
    candidateTurnIndex,
  });

  recordDebugTraceEntry(interview, {
    candidateTurnIndex,
    candidateMessage,
    captured,
    executorTrace,
  });

  interview.markModified('session_state');
  await interview.save();

  return {
    captured,
    interviewDone,
  };
}

export { streamInterviewerReply, loadInterviewConfig };
