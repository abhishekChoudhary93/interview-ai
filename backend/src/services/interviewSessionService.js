import { loadInterviewConfig, INTERVIEW_CONFIG_ID } from './interviewConfig.js';
import { streamInterviewerReply, generateOpeningLine } from './interviewConverse.js';
import {
  captureTurnEval,
  applyEvalToSessionState,
  validateExecutorReply,
} from './interviewEvalCapture.js';

/**
 * Years-of-experience bands recognized by the create-interview API. Lives here
 * because it's still used by the route for input validation.
 */
export const YEARS_EXPERIENCE_BANDS = ['0_2', '2_5', '5_8', '8_12', '12_plus'];

/**
 * Hard turn cap. Beyond this we force a wrap regardless of bar judgment —
 * this is a safety net only. The Planner is responsible for getting the
 * interview to a clean close before this (via `interview_done=true`).
 */
const HARD_TURN_CAP = 60;

/**
 * v3 Initial session_state shape. Section progression is no longer tracked —
 * the Planner directs all transitions verbally. We seed
 * `opening_phase='awaiting_ack'` to drive the conversational opening protocol
 * (intro → ack → problem handoff) deterministically before any Planner LLM call.
 *
 * Persisted fields (v3):
 *   opening_phase             — 'awaiting_ack' | 'in_progress'
 *   turn_count                — interviewer turn counter (safety cap)
 *   session_wall_start_ms     — ms timestamp; basis for total elapsed
 *   last_turn_ts              — ms timestamp of previous turn (per-section delta)
 *   eval_history[]            — every Planner emission: {turn_index, move, difficulty, momentum, bar_trajectory, time_status, recommended_section_focus_id, performance_assessment, ...}
 *   probe_queue               — { [sectionId]: [{id, observation, probe, difficulty, added_at_turn, consumed, consumed_at_turn}] }
 *   flags_by_section          — { [sectionId]: [{type:'green'|'red', signal_id, note, at_turn}] }
 *   section_minutes_used      — { [sectionId]: minutes spent (advisory) }
 *   performance_by_section    — { [sectionId]: 'above_target'|'at_target'|'below_target' }
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
    next_directive: null,
    interview_done: false,
  };
}

/**
 * Idempotent session start. If the interview already has an opening turn,
 * return that without re-priming. Otherwise: load the v3 config, snapshot it
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
  interview.template_version = 'v3';
  interview.selected_template_id = INTERVIEW_CONFIG_ID;
  interview.session_state = buildInitialSessionState(now);
  interview.target_duration_minutes =
    typeof config.total_minutes === 'number'
      ? config.total_minutes
      : (config.sections || []).reduce((acc, s) => acc + (s.budget_minutes || 0), 0);
  interview.session_started_at = new Date(now);
  if (!Array.isArray(interview.conversation_turns)) interview.conversation_turns = [];

  // Deterministic conversational intro — no problem statement yet, no LLM.
  // From T1 onward the Executor LLM handles every turn; the OPENING PROTOCOL
  // section of its system prompt carries the curated problem statement and
  // tells the LLM how to handle ack-vs-substance on the candidate's first
  // message.
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
 * Background-callable: run the Planner LLM and persist its output onto the
 * interview row.
 *
 * `executorTrace` (optional) carries the Executor's per-turn capture (system
 * prompt, history, accumulated reply, model, duration_ms). When the
 * `INTERVIEW_DEBUG_TRACE=1` env flag is set, this function assembles a
 * combined Executor + Planner debug entry and persists it onto
 * `session_state.debug_trace[]` (capped at 60 entries).
 */
export async function runBackgroundEvalCapture(
  interview,
  { config, candidateMessage, interviewerReply, candidateTurnIndex, executorTrace }
) {
  // The Planner runs on every turn including T1. For procedural acks it will
  // classify signal=procedural / performance=unclear / move=LET_LEAD; for
  // substantive first turns it classifies normally. The per-section minutes
  // accounting inside applyEvalToSessionState advances `last_turn_ts` itself.
  const captured = await captureTurnEval({
    config,
    interview,
    sessionState: interview.session_state,
    candidateMessage,
    interviewerReply,
  });

  // Post-stream observability validator. Pure observability — no state
  // self-heal; section transitions are now Planner-driven and verbal.
  const validatorResult = validateExecutorReply({
    reply: interviewerReply,
    derivedMove: captured.move,
    candidateMessage,
  });

  const { interviewDone } = applyEvalToSessionState(interview, captured, {
    config,
    candidateMessage,
    candidateTurnIndex,
    interviewerReply,
    validatorResult,
  });

  // Hard turn-cap safety net.
  const turns = interview.session_state?.turn_count || 0;
  let forcedDone = interviewDone;
  if (turns >= HARD_TURN_CAP) {
    interview.session_state.interview_done = true;
    forcedDone = true;
  }

  // Debug trace assembly — gated, no overhead when disabled.
  if (process.env.INTERVIEW_DEBUG_TRACE === '1') {
    const ss = interview.session_state;
    if (!Array.isArray(ss.debug_trace)) ss.debug_trace = [];
    const plannerTrace = captured.__trace || null;
    ss.debug_trace.push({
      turn_index: candidateTurnIndex,
      ts: new Date().toISOString(),
      candidate_message: candidateMessage,
      executor: executorTrace || null,
      planner: plannerTrace
        ? {
            model: plannerTrace.model,
            input_prompt: plannerTrace.input_prompt,
            output_json: plannerTrace.output_json,
            duration_ms: plannerTrace.duration_ms,
            error: plannerTrace.error || null,
            applied_directive: ss.next_directive || null,
            recommended_section_focus_id: captured.recommended_section_focus_id || '',
          }
        : null,
    });
    if (ss.debug_trace.length > 60) ss.debug_trace = ss.debug_trace.slice(-60);
    delete captured.__trace;
  }

  interview.markModified('session_state');
  await interview.save();

  return {
    captured,
    interviewDone: forcedDone,
  };
}

export { streamInterviewerReply, loadInterviewConfig };
