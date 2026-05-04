import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '../interview-config/url_shortener.json');

let cache = null;

/**
 * Single source of truth for the interview problem. v3 architecture: one
 * problem per engine; everything problem-specific (sections, signals,
 * leveling, scope, scale_facts, fault_scenarios, raise_stakes_prompts,
 * persona) lives in this JSON. The Planner and Executor prompts contain
 * zero problem-specific content.
 *
 * @returns {object}
 */
export function loadInterviewConfig() {
  if (!cache) {
    cache = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  return cache;
}

/** Force reload — used by tests. */
export function reloadInterviewConfig() {
  cache = null;
  return loadInterviewConfig();
}

/** Stable identifier for the (single) problem; mirrors the file basename. */
export const INTERVIEW_CONFIG_ID = 'url_shortener';

/**
 * Resolve the curated problem-statement string for the system prompt to
 * embed as DATA inside the OPENING PROTOCOL block. The Executor LLM reads
 * it and decides whether to render it verbatim or engage with the
 * candidate's substance instead — that decision lives in the LLM, not here.
 */
export function buildProblemHandoff(config) {
  const opening = String(config?.problem?.opening_prompt || '').trim();
  if (opening) return opening;
  // Fallback in case opening_prompt is missing — synthesize from title/brief.
  const title = String(config?.problem?.title || '').trim();
  const brief = String(config?.problem?.brief || '').trim();
  const intro = title ? `Here's the problem: ${title}.` : `Here's the problem.`;
  const body = brief ? ` ${brief}` : '';
  return `${intro}${body} Take it from there — let's start with how you'd frame the requirements.`.trim();
}
