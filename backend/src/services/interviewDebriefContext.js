/**
 * Section coverage for debrief (same rule as debrief LLM prompt: index vs current_section_index).
 * @param {object} state orchestrator_state
 * @param {object} plan execution_plan
 */
export function buildSectionCoverageForDebrief(state, plan) {
  const sections = plan?.sections || [];
  if (!sections.length) return [];
  const curIdx = state.current_section_index ?? 0;
  return sections.map((s, i) => ({
    id: s.id,
    name: s.name,
    status: i < curIdx ? 'completed' : i === curIdx ? 'partial' : 'not_reached',
  }));
}

/**
 * Persist end-of-session facts for debrief (call before finalize or when session closes).
 * @param {import('mongoose').Document} interview
 * @param {{ candidateTriggeredEnd?: boolean, source?: string }} options
 */
export function recordSessionEndMetadata(interview, options = {}) {
  const state = interview.orchestrator_state;
  const plan = interview.execution_plan;
  if (!state || !plan) return;

  const nowMs = Date.now();
  if (!state.session_ended_at_ms) {
    state.session_ended_at_ms = nowMs;
  }

  const wallStart =
    state.session_wall_start_ms ??
    (interview.session_started_at ? new Date(interview.session_started_at).getTime() : nowMs);

  const elapsedMin = Math.max(0, (state.session_ended_at_ms - wallStart) / 60000);
  state.debrief_elapsed_minutes = Number(elapsedMin.toFixed(2));

  const plannedMin = plan.total_minutes ?? 60;
  state.debrief_planned_minutes = plannedMin;
  state.debrief_time_completion_pct = Math.min(200, Math.round((elapsedMin / Math.max(1, plannedMin)) * 100));

  const secs = plan.sections || [];
  const n = secs.length;
  const curIdx = state.current_section_index ?? 0;
  state.debrief_sections_attempted = Math.min(n, curIdx + 1);
  state.debrief_sections_total = n;
  state.debrief_section_progress_pct = n ? Math.round(((curIdx + 1) / n) * 100) : 0;

  state.debrief_section_coverage_map = buildSectionCoverageForDebrief(state, plan);

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
}
