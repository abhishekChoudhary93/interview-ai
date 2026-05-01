/** @typedef {'IC_MID' | 'IC_STAFF' | 'SDM'} CandidateLevel */

export const YEARS_EXPERIENCE_BANDS = ['0_2', '2_5', '5_8', '8_12', '12_plus'];

/** IC_STAFF when YOE in these bands or experience_level is lead (legacy). */
export const IC_STAFF_YOE_BANDS = new Set(['8_12', '12_plus']);

const EXPERIENCE_LEVEL_TO_YOE = {
  entry: '0_2',
  mid: '2_5',
  senior: '5_8',
  lead: '12_plus',
};

/**
 * @param {{ years_experience_band?: string, experience_level?: string }} interview
 * @returns {string} one of YEARS_EXPERIENCE_BANDS
 */
export function normalizeYearsExperienceBand(interview) {
  const raw = String(interview?.years_experience_band || '').trim();
  if (YEARS_EXPERIENCE_BANDS.includes(raw)) return raw;
  const el = String(interview?.experience_level || '').toLowerCase();
  return EXPERIENCE_LEVEL_TO_YOE[el] || '5_8';
}

/**
 * @param {{ role_track?: string, years_experience_band?: string, experience_level?: string }} interview
 * @returns {CandidateLevel}
 */
export function deriveCandidateLevel(interview) {
  const rt = String(interview?.role_track || 'ic').toLowerCase();
  if (rt === 'sdm') return 'SDM';
  const yoe = normalizeYearsExperienceBand(interview);
  const el = String(interview?.experience_level || '').toLowerCase();
  if (IC_STAFF_YOE_BANDS.has(yoe) || el === 'lead') return 'IC_STAFF';
  return 'IC_MID';
}

/**
 * @param {CandidateLevel} level
 */
export function isStaffOrAboveLevel(level) {
  return level === 'IC_STAFF' || level === 'SDM';
}
