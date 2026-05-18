/**
 * Unwrap problem / config from interview_config snapshot (v3 nested shape).
 * @param {object | null | undefined} config
 */
export function getProblemFromConfig(config) {
  if (!config) return null;
  const root = config.interview_config || config;
  return root?.problem || config.problem || config.primary_question || null;
}

/**
 * @param {object | null | undefined} config
 */
export function getProblemTitle(config) {
  const problem = getProblemFromConfig(config);
  if (!problem) return null;
  if (typeof problem === 'string') return problem.trim() || null;
  return String(problem.title || '').trim() || null;
}
