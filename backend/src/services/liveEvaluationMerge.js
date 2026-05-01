import { SYSTEM_DESIGN_RUBRICS } from '../config/systemDesignRubrics.js';

export { SYSTEM_DESIGN_RUBRICS };

/**
 * Merge one decision-step evaluation_update into orchestrator_state.live_evaluation.
 * Policy: higher score wins for same (section_id, signal_id); tie → more recent turn_index.
 * @param {object} state orchestrator_state (mutated)
 * @param {object|null|undefined} evaluationUpdate
 * @param {string} candidateMessage
 * @param {number} candidateTurnIndex 1-based index of this candidate turn
 * @param {Record<string, unknown>} [rubrics] defaults to SYSTEM_DESIGN_RUBRICS
 */
export function mergeEvaluationUpdate(
  state,
  evaluationUpdate,
  candidateMessage,
  candidateTurnIndex,
  rubrics = SYSTEM_DESIGN_RUBRICS
) {
  if (!state) return;
  if (!state.live_evaluation) state.live_evaluation = {};
  if (!evaluationUpdate || typeof evaluationUpdate !== 'object') return;

  const section_id =
    typeof evaluationUpdate.section_id === 'string' ? evaluationUpdate.section_id.trim() : '';
  const signal_id =
    typeof evaluationUpdate.signal_id === 'string' ? evaluationUpdate.signal_id.trim() : '';
  if (!section_id || !signal_id) return;

  let score = evaluationUpdate.score;
  if (score === null || score === undefined || score === 'null') return;
  const n = Math.round(Number(score));
  if (!Number.isFinite(n) || n < 1 || n > 4) return;
  score = n;

  const rubric = rubrics[section_id];
  if (!rubric || !Array.isArray(rubric.signals)) return;
  const sigDef = rubric.signals.find((s) => s.id === signal_id);
  if (!sigDef) return;

  const evidence = typeof evaluationUpdate.evidence === 'string' ? evaluationUpdate.evidence.trim() : '';
  if (!evidence) return;
  const cand = String(candidateMessage || '');
  if (!cand.includes(evidence)) return;

  const entry = { score, evidence, turn_index: candidateTurnIndex };
  const prev = state.live_evaluation[section_id]?.[signal_id];

  if (!state.live_evaluation[section_id]) state.live_evaluation[section_id] = {};

  if (!prev || prev.score == null) {
    state.live_evaluation[section_id][signal_id] = entry;
    return;
  }
  if (score > prev.score) {
    state.live_evaluation[section_id][signal_id] = entry;
    return;
  }
  if (score === prev.score && candidateTurnIndex >= (prev.turn_index ?? 0)) {
    state.live_evaluation[section_id][signal_id] = entry;
  }
}

/**
 * Deterministic aggregation for debrief prompt (matches spec getReportPrompt math).
 * @param {Record<string, Record<string, { score?: number|null, evidence?: string }>>} live_evaluation
 * @param {Record<string, unknown>} rubrics
 */
export function aggregateLiveEvaluationForReport(live_evaluation, rubrics = SYSTEM_DESIGN_RUBRICS) {
  const live = live_evaluation && typeof live_evaluation === 'object' ? live_evaluation : {};
  let totalWeightedScore = 0;
  let totalWeight = 0;

  const sectionSummaries = Object.entries(live).map(([sectionId, signals]) => {
    const rubric = rubrics[sectionId];
    if (!rubric) return null;

    const signalSummaries = Object.entries(signals || {}).map(([signalId, eval_]) => {
      const signalDef = rubric.signals.find((s) => s.id === signalId);
      const sc = eval_.score;
      const scoreDescription =
        sc != null && signalDef?.scores?.[sc]
          ? signalDef.scores[sc]
          : 'Not observed';
      return {
        signal: signalDef?.label || signalId,
        score: sc,
        evidence: eval_.evidence || '',
        score_description: scoreDescription,
      };
    });

    const scoreVals = signalSummaries
      .map((s) => s.score)
      .filter((x) => x != null && Number.isFinite(Number(x)));
    const sectionAvg = scoreVals.length
      ? scoreVals.reduce((a, b) => a + Number(b), 0) / scoreVals.length
      : null;

    if (sectionAvg !== null) {
      totalWeightedScore += sectionAvg * rubric.weight;
      totalWeight += rubric.weight;
    }

    return { sectionId, sectionAvg, signals: signalSummaries };
  }).filter(Boolean);

  const overallScore = totalWeight > 0 ? (totalWeightedScore / totalWeight).toFixed(2) : null;

  return { sectionSummaries, overallScore };
}
