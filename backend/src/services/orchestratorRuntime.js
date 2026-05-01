export const ACTIONS = {
  LET_CANDIDATE_LEAD: 'LET_CANDIDATE_LEAD',
  ANSWER_AND_CONTINUE: 'ANSWER_AND_CONTINUE',
  REDIRECT: 'REDIRECT',
  GO_DEEPER: 'GO_DEEPER',
  GIVE_HINT: 'GIVE_HINT',
  EXHAUSTED_HINTS: 'EXHAUSTED_HINTS',
  PIVOT_CROSS: 'PIVOT_CROSS',
  WRAP_TOPIC: 'WRAP_TOPIC',
  NEXT_TOPIC: 'NEXT_TOPIC',
  CLOSE_INTERVIEW: 'CLOSE_INTERVIEW',
};

export const TIME_OVERFLOW_FACTOR = 1.3;

/**
 * @param {object} decision { action, reason, hint_level }
 */
export function applyHardTimeGates(state, executionPlan, decision) {
  const base = { ...decision, forced: false };
  const sec = executionPlan?.sections?.[state.current_section_index];
  const budget = sec?.time_budget_minutes ?? 15;
  const spent = state.current_section_minutes_spent || 0;
  if (spent > budget * TIME_OVERFLOW_FACTOR) {
    return {
      ...base,
      action: ACTIONS.WRAP_TOPIC,
      reason: 'Hard gate: section overtime',
      hint_level: 0,
      forced: true,
    };
  }
  const totalBudget = executionPlan?.total_minutes ?? 60;
  if ((state.elapsed_minutes || 0) >= totalBudget - 0.01) {
    return {
      ...base,
      action: ACTIONS.CLOSE_INTERVIEW,
      reason: 'Hard gate: total duration',
      hint_level: 0,
      forced: true,
    };
  }
  return base;
}

export function advanceClock(state, nowMs) {
  const last = state.last_turn_at_ms ?? state.session_wall_start_ms ?? nowMs;
  const deltaMin = Math.max(0, (nowMs - last) / 60000);
  state.elapsed_minutes = (state.elapsed_minutes || 0) + deltaMin;
  state.current_section_minutes_spent = (state.current_section_minutes_spent || 0) + deltaMin;
  state.current_topic_minutes_spent = (state.current_topic_minutes_spent || 0) + deltaMin;
  state.last_turn_at_ms = nowMs;
}

export function createInitialOrchestratorState(openingText, nowMs) {
  return {
    orch_schema_version: 1,
    elapsed_minutes: 0,
    current_section_index: 0,
    current_topic_index: 0,
    current_topic_minutes_spent: 0,
    current_section_minutes_spent: 0,
    depth_level: 1,
    hints_given_this_question: 0,
    hints_given_session: 0,
    questions_asked_this_section: 0,
    candidate_knowledge_map: { strong: [], weak: [] },
    notable_statements: [],
    topics_completed: [],
    fired_probe_ids: [],
    pending_question_text: openingText,
    session_wall_start_ms: nowMs,
    last_turn_at_ms: nowMs,
    interview_done: false,
    last_action: null,
    last_decision_action: null,
    consecutive_same_topic_turns: 0,
    last_probe_topic: null,
    uncertain_response_streak: 0,
    current_thread: {
      topic: '',
      turns_on_thread: 0,
      candidate_progress: 'improving',
    },
    turn_count: 0,
    live_evaluation: {},
  };
}

/**
 * Apply structural transitions after interviewer speaks (simplified).
 */
export function applyActionToState(state, executionPlan, action) {
  state.last_action = action;
  const sections = executionPlan?.sections || [];

  if (action === ACTIONS.WRAP_TOPIC || action === ACTIONS.NEXT_TOPIC) {
    state.hints_given_this_question = 0;
    state.depth_level = 1;
    state.current_topic_minutes_spent = 0;
    state.questions_asked_this_section = (state.questions_asked_this_section || 0) + 1;

    if (action === ACTIONS.NEXT_TOPIC || state.questions_asked_this_section >= 4) {
      const sid = sections[state.current_section_index]?.id;
      if (sid) state.topics_completed.push(sid);
      state.current_section_index = Math.min(
        state.current_section_index + 1,
        Math.max(0, sections.length - 1)
      );
      state.current_section_minutes_spent = 0;
      state.questions_asked_this_section = 0;
    }
  }

  if (action === ACTIONS.EXHAUSTED_HINTS) {
    state.hints_given_this_question = 0;
    state.depth_level = 1;
  }

  if (action === ACTIONS.GIVE_HINT) {
    state.hints_given_this_question = (state.hints_given_this_question || 0) + 1;
    state.depth_level = Math.min(3, (state.depth_level || 1) + 1);
  }

  if (action === ACTIONS.GO_DEEPER || action === ACTIONS.PIVOT_CROSS) {
    state.depth_level = Math.min(4, (state.depth_level || 1) + 1);
  }

  if (state.current_section_index >= sections.length - 1 && action === ACTIONS.WRAP_TOPIC) {
    state.interview_done = true;
  }
}

export function shouldCloseInterview(state, executionPlan) {
  if (state.interview_done) return true;
  const sections = executionPlan?.sections || [];
  if (!sections.length) return true;
  const lastIdx = sections.length - 1;
  if (state.current_section_index >= lastIdx && (state.topics_completed || []).includes(sections[lastIdx]?.id)) {
    return true;
  }
  return false;
}
