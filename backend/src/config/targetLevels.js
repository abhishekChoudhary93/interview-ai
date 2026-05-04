/**
 * Six-level interviewing taxonomy used by the Planner / Executor split.
 *
 * The new flow collects a single `target_level` from the candidate at setup
 * time. Legacy interviews (rows created before the field existed) fall back
 * to a derivation from the older `experience_level` + `years_experience_band`
 * pair via `resolveTargetLevel`.
 *
 *   INTERN            Internship interview.
 *   SDE_1             Entry-level / new grad. (~L3)
 *   SDE_2             Mid-level. (~L4)
 *   SR_SDE            Senior. (~L5)
 *   PRINCIPAL_STAFF   Principal / Staff IC. (~L6)
 *   SR_PRINCIPAL      Senior Principal. (~L7+)
 *
 * `oneLevelUp` and `oneLevelDown` walk this ladder, clamped at the ends.
 * Existing tier-based callers (HAND_HOLDING_BY_TIER, SCAFFOLDING_POLICY_BY_TIER)
 * continue to read the older 4-tier shape via `targetLevelToTier`.
 */

export const TARGET_LEVELS = {
  INTERN: { label: 'Intern', short: 'Intern', ord: 1, descriptor: 'Internship interview' },
  SDE_1: { label: 'Entry Level SDE (L3)', short: 'SDE-1', ord: 2, descriptor: 'New grad / 0–2 yrs' },
  SDE_2: { label: 'SDE-2 / Mid (L4)', short: 'SDE-2', ord: 3, descriptor: '2–5 yrs, building depth' },
  SR_SDE: { label: 'Senior SDE (L5)', short: 'Sr. SDE', ord: 4, descriptor: '5–8 yrs, strong ownership' },
  PRINCIPAL_STAFF: {
    label: 'Principal / Staff (L6)',
    short: 'Principal/Staff',
    ord: 5,
    descriptor: '8–12 yrs, scope across teams',
  },
  SR_PRINCIPAL: {
    label: 'Senior Principal (L7+)',
    short: 'Sr. Principal',
    ord: 6,
    descriptor: '12+ yrs, multi-org impact',
  },
};

const ORDERED_LEVELS = ['INTERN', 'SDE_1', 'SDE_2', 'SR_SDE', 'PRINCIPAL_STAFF', 'SR_PRINCIPAL'];

export function isValidTargetLevel(level) {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(TARGET_LEVELS, level);
}

export function oneLevelUp(level) {
  const i = ORDERED_LEVELS.indexOf(level);
  if (i < 0) return level;
  return ORDERED_LEVELS[Math.min(i + 1, ORDERED_LEVELS.length - 1)];
}

export function oneLevelDown(level) {
  const i = ORDERED_LEVELS.indexOf(level);
  if (i < 0) return level;
  return ORDERED_LEVELS[Math.max(i - 1, 0)];
}

/**
 * Map a six-level target to the older 4-tier shape used by HAND_HOLDING_BY_TIER
 * and SCAFFOLDING_POLICY_BY_TIER. Lets existing tier-based code keep working
 * without rewriting its dispatch tables.
 */
export function targetLevelToTier(level) {
  switch (level) {
    case 'INTERN':
    case 'SDE_1':
      return 'JUNIOR';
    case 'SDE_2':
      return 'MID';
    case 'SR_SDE':
      return 'SENIOR';
    case 'PRINCIPAL_STAFF':
    case 'SR_PRINCIPAL':
      return 'STAFF_PLUS';
    default:
      return 'MID';
  }
}

/**
 * Resolve the candidate's target level from an Interview row. Prefers an
 * explicit `target_level` written by the new setup form; otherwise falls back
 * to deriving from the legacy `experience_level` + `years_experience_band`
 * fields so existing rows keep working.
 *
 * @param {{ target_level?: string, experience_level?: string, years_experience_band?: string }} interview
 * @returns {keyof typeof TARGET_LEVELS}
 */
export function resolveTargetLevel(interview) {
  const explicit = String(interview?.target_level || '').trim();
  if (isValidTargetLevel(explicit)) return explicit;

  const lvl = String(interview?.experience_level || '').toLowerCase().trim();
  const band = String(interview?.years_experience_band || '').toLowerCase().trim();

  if (lvl === 'principal' || band === '12_plus') return 'SR_PRINCIPAL';
  if (lvl === 'staff' || lvl === 'lead' || band === '8_12') return 'PRINCIPAL_STAFF';
  if (lvl === 'senior' || band === '5_8') return 'SR_SDE';
  if (lvl === 'mid' || band === '2_5') return 'SDE_2';
  if (lvl === 'entry' || lvl === 'junior' || band === '0_2') return 'SDE_1';
  return 'SDE_2';
}
