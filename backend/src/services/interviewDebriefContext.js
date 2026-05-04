/**
 * Shared session-end accounting used by the debrief pipeline.
 *
 * v3 reads `interview.interview_config` for problem/section structure.
 * Legacy rows fall back to `interview.execution_plan` (the v2 snapshot
 * shape) so old debriefs keep rendering.
 *
 * The new conversational flow stores live state on `interview.session_state`;
 * legacy rows used `interview.orchestrator_state`. Read from either, write
 * to `session_state` when present and to the same field that already exists
 * on the row otherwise.
 */

function getLiveState(interview) {
  if (interview?.session_state && Object.keys(interview.session_state).length > 0) {
    return { state: interview.session_state, key: 'session_state' };
  }
  if (interview?.orchestrator_state && Object.keys(interview.orchestrator_state).length > 0) {
    return { state: interview.orchestrator_state, key: 'orchestrator_state' };
  }
  if (!interview.session_state) interview.session_state = {};
  return { state: interview.session_state, key: 'session_state' };
}

function getConfigOrPlan(interview) {
  return interview?.interview_config || interview?.execution_plan || null;
}

/**
 * Section coverage for debrief. v3 derives "completed" from the union of
 * `flags_by_section` keys and any section the Planner ever recommended in
 * `eval_history.recommended_section_focus_id`. Sections never touched are
 * `not_reached`.
 *
 * Legacy v2 rows fall through the old current_section_index path.
 */
export function buildSectionCoverageForDebrief(state, configOrPlan) {
  const sections = configOrPlan?.sections || [];
  if (!sections.length) return [];

  const isV3Shape = !!state?.flags_by_section || !!state?.section_minutes_used;

  if (isV3Shape) {
    const flagsBySection = state.flags_by_section || {};
    const performanceBySection = state.performance_by_section || {};
    const sectionMinutesUsed = state.section_minutes_used || {};
    const evalHistory = Array.isArray(state.eval_history) ? state.eval_history : [];
    const everTouched = new Set();
    for (const e of evalHistory) {
      if (e?.recommended_section_focus_id) everTouched.add(e.recommended_section_focus_id);
    }
    return sections.map((s) => {
      const id = s.id;
      const hasFlags = Array.isArray(flagsBySection[id]) && flagsBySection[id].length > 0;
      const hasPerf = !!performanceBySection[id];
      const hasTime = (sectionMinutesUsed[id] || 0) > 0.5;
      const touched = everTouched.has(id);
      let status = 'not_reached';
      if (hasFlags || hasPerf) status = 'completed';
      else if (touched || hasTime) status = 'partial';
      return { id, name: s.label || s.name || id, status };
    });
  }

  // Legacy v2 path.
  const curIdx = state?.current_section_index ?? 0;
  return sections.map((s, i) => ({
    id: s.id,
    name: s.name || s.label || s.id,
    status: i < curIdx ? 'completed' : i === curIdx ? 'partial' : 'not_reached',
  }));
}

/**
 * Persist end-of-session facts for debrief (call before finalize or when
 * session closes).
 *
 * @param {import('mongoose').Document} interview
 * @param {{ candidateTriggeredEnd?: boolean, source?: string }} options
 */
export function recordSessionEndMetadata(interview, options = {}) {
  const configOrPlan = getConfigOrPlan(interview);
  if (!configOrPlan) return;
  const { state, key } = getLiveState(interview);

  const nowMs = Date.now();
  if (!state.session_ended_at_ms) {
    state.session_ended_at_ms = nowMs;
  }

  const wallStart =
    state.session_wall_start_ms ??
    (interview.session_started_at ? new Date(interview.session_started_at).getTime() : nowMs);

  const elapsedMin = Math.max(0, (state.session_ended_at_ms - wallStart) / 60000);
  state.debrief_elapsed_minutes = Number(elapsedMin.toFixed(2));

  const plannedMin = configOrPlan.total_minutes ?? 60;
  state.debrief_planned_minutes = plannedMin;
  state.debrief_time_completion_pct = Math.min(
    200,
    Math.round((elapsedMin / Math.max(1, plannedMin)) * 100)
  );

  const coverage = buildSectionCoverageForDebrief(state, configOrPlan);
  const reachedCount = coverage.filter((c) => c.status !== 'not_reached').length;
  const totalCount = coverage.length;

  state.debrief_sections_attempted = reachedCount;
  state.debrief_sections_total = totalCount;
  state.debrief_section_progress_pct = totalCount
    ? Math.round((reachedCount / totalCount) * 100)
    : 0;
  state.debrief_section_coverage_map = coverage;

  const shortClock = elapsedMin < 15;
  const lowTimePct = state.debrief_time_completion_pct < 40;
  state.debrief_terminated_early =
    Boolean(state.debrief_terminated_early) ||
    options.candidateTriggeredEnd === true ||
    shortClock ||
    lowTimePct;

  if (!state.debrief_close_source || state.debrief_close_source === 'unknown') {
    state.debrief_close_source = options.source || 'unknown';
  }

  if (interview.markModified) {
    interview.markModified(key);
  }
}
