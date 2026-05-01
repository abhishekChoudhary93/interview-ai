import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = join(__dirname, '../interview-templates');

/** @typedef {{ template_id: string, version: string, total_minutes: number, sections: object[] }} RoleTemplate */

/**
 * @param {object} raw
 * @returns {asserts raw is RoleTemplate}
 */
export function validateTemplateShape(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Template: invalid root');
  if (!raw.template_id || typeof raw.template_id !== 'string') throw new Error('Template: missing template_id');
  if (!raw.version || typeof raw.version !== 'string') throw new Error('Template: missing version');
  if (typeof raw.total_minutes !== 'number') throw new Error('Template: missing total_minutes');
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw new Error('Template: sections required');
  }
  for (const s of raw.sections) {
    if (!s.id || !s.name || typeof s.time_budget_minutes !== 'number') {
      throw new Error(`Template: invalid section ${s?.id}`);
    }
  }
}

/**
 * @param {string} templateId e.g. backend_engineer_senior
 * @returns {object} RoleTemplate
 */
export function loadRoleTemplate(templateId) {
  const fp = join(TEMPLATES_DIR, `${templateId}.json`);
  if (!existsSync(fp)) {
    throw new Error(`Template file not found for id: ${templateId}`);
  }
  const raw = JSON.parse(readFileSync(fp, 'utf8'));
  validateTemplateShape(raw);
  return raw;
}

export function templateExists(templateId) {
  return existsSync(join(TEMPLATES_DIR, `${templateId}.json`));
}
