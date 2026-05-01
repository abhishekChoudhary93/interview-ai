import { loadRoleTemplate, templateExists } from './templateLoader.js';

export const KNOWN_TEMPLATE_IDS = [
  'backend_engineer_senior',
  'frontend_engineer_mid',
  'product_manager_growth',
];

/**
 * Resolve Layer 1 template. Product is tech-only (IC / SDM); PM template is legacy fallback only.
 * @param {object} opts
 * @param {string} [opts.role_title]
 * @param {string} [opts.role_track] ic | sdm
 * @param {string} [opts.experience_level]
 * @param {string} [opts.interview_type] system_design | behavioral | mixed
 * @param {string} [opts.industry]
 * @param {string} [opts.template_id] explicit override
 * @returns {{ template_id: string, template_version: string }}
 */
export function resolveTemplateId(opts = {}) {
  const explicit = opts.template_id && String(opts.template_id).trim();
  if (explicit && templateExists(explicit)) {
    const t = loadRoleTemplate(explicit);
    return { template_id: t.template_id, template_version: t.version };
  }

  const role = String(opts.role_title || '').toLowerCase();
  const level = String(opts.experience_level || '').toLowerCase();
  const track = String(opts.role_track || '').toLowerCase();
  const interviewType = String(opts.interview_type || '').toLowerCase();

  const isSdmTrack =
    track === 'sdm' ||
    /\b(engineering manager|software development manager|\bsdm\b|director of engineering|vp of engineering|head of engineering|tech lead manager)\b/i.test(
      role
    );

  /** SDM / leadership: system-design-heavy template */
  if (isSdmTrack) {
    const t = loadRoleTemplate('backend_engineer_senior');
    return { template_id: t.template_id, template_version: t.version };
  }

  const isFrontend =
    role.includes('frontend') ||
    role.includes('front-end') ||
    role.includes('react') ||
    role.includes('ui engineer') ||
    (role.includes('web') && role.includes('developer')) ||
    /\b(full[\s-]?stack|fullstack)\b/.test(role);

  const isBackend =
    role.includes('backend') ||
    role.includes('back-end') ||
    role.includes('server') ||
    role.includes('infra') ||
    role.includes('sre') ||
    role.includes('platform engineer') ||
    /\bapi\b/.test(role);

  /** System design sessions bias toward backend-style rubric */
  if (interviewType === 'system_design') {
    const t = loadRoleTemplate('backend_engineer_senior');
    return { template_id: t.template_id, template_version: t.version };
  }

  if (isFrontend && !isBackend) {
    const t = loadRoleTemplate('frontend_engineer_mid');
    return { template_id: t.template_id, template_version: t.version };
  }

  if (isBackend || level === 'senior' || level === 'lead') {
    const t = loadRoleTemplate('backend_engineer_senior');
    return { template_id: t.template_id, template_version: t.version };
  }

  if (level === 'entry' || level === 'mid') {
    const t = loadRoleTemplate('frontend_engineer_mid');
    return { template_id: t.template_id, template_version: t.version };
  }

  const t = loadRoleTemplate('backend_engineer_senior');
  return { template_id: t.template_id, template_version: t.version };
}
