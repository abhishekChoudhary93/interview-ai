/**
 * @param {import('./templateLoader.js').RoleTemplate} template
 * @param {Record<string, unknown>} adaptation plan-generation JSON from LLM
 * @param {{ experience_level?: string, role_title?: string }} meta
 */
export function mergeTemplateAndAdaptation(template, adaptation, meta = {}) {
  const experience_level = meta.experience_level || '';
  const planning = adaptation && typeof adaptation === 'object' ? adaptation : {};

  let sections = (template.sections || [])
    .filter((s) => !shouldSkipSection(s, experience_level))
    .map((s, idx) => ({
      ...s,
      _order: idx,
      time_budget_minutes: s.time_budget_minutes ?? 10,
    }));

  const ta =
    planning.time_adjustments && typeof planning.time_adjustments === 'object'
      ? planning.time_adjustments
      : {};
  const MIN_SECTION = 2;
  sections = sections.map((s) => {
    const delta = Number(ta[s.id]);
    const base = s.time_budget_minutes;
    const adj = Number.isFinite(delta) ? base + delta : base;
    return { ...s, time_budget_minutes: Math.max(MIN_SECTION, adj) };
  });

  // After per-section deltas, rescale so section budgets sum to template.total_minutes (session target).
  const targetTotal = template.total_minutes || 60;
  let sum = sections.reduce((a, s) => a + (s.time_budget_minutes || 0), 0);
  if (sum > 0 && Math.abs(sum - targetTotal) > 0.001) {
    const scale = targetTotal / sum;
    sections = sections.map((s) => ({
      ...s,
      time_budget_minutes: Math.max(MIN_SECTION, Math.round((s.time_budget_minutes || 0) * scale)),
    }));
    sum = sections.reduce((a, s) => a + s.time_budget_minutes, 0);
    let drift = targetTotal - sum;
    let guard = 0;
    while (drift !== 0 && sections.length && guard < 5000) {
      const idx = guard % sections.length;
      const step = drift > 0 ? 1 : -1;
      const next = sections[idx].time_budget_minutes + step;
      if (next >= MIN_SECTION) {
        sections[idx] = { ...sections[idx], time_budget_minutes: next };
        drift -= step;
      }
      guard += 1;
    }
  }

  const priority =
    planning.priority_probes && typeof planning.priority_probes === 'object'
      ? planning.priority_probes
      : {};
  sections = sections.map((s) => {
    const extra = Array.isArray(priority[s.id]) ? priority[s.id] : [];
    const fromPriority = extra.map((probe, i) => ({
      trigger: probeTriggerFromQuestion(probe, i),
      probe: String(probe),
      section_id: s.id,
    }));
    const fromTemplate = probesFromSectionTemplate(s);
    return {
      ...s,
      pre_loaded_probes: [...fromPriority, ...fromTemplate],
    };
  });

  const framing = typeof planning.opening_framing === 'string' ? planning.opening_framing.trim() : '';
  const opening =
    framing.length > 0
      ? { chosen: framing, reason: 'Plan generation' }
      : {
          chosen: buildDefaultOpening(template, sections),
          reason: 'Template default opening',
        };

  const level_expectations =
    typeof planning.level_expectations === 'string' ? planning.level_expectations.trim() : '';

  const primary_question = template.primary_question || null;

  return {
    template_id: template.template_id,
    template_version: template.version,
    total_minutes: targetTotal,
    primary_question,
    sections,
    opening_question: opening,
    planning_meta: {
      level_expectations,
      plan_generation_version: 1,
    },
    topic_priority_adjustments: {},
    depth_allocation: {},
    cross_question_seeds: [],
    skip_list: [],
    adaptation_meta: {
      pre_loaded_probes_raw: [],
    },
  };
}

function shouldSkipSection(section, experience_level) {
  const conds = section.skip_conditions || [];
  for (const c of conds) {
    if (typeof c !== 'string') continue;
    if (c.includes('experience_level == lead') && experience_level === 'lead') return true;
    if (c.includes('candidate_level == staff') && experience_level === 'lead') return true;
  }
  return false;
}

/** Derive keyword triggers from template probe_questions for optional probe matching. */
function probesFromSectionTemplate(section) {
  const qs = section.probe_questions;
  if (!Array.isArray(qs)) return [];
  return qs.map((probe, i) => ({
    trigger: probeTriggerFromQuestion(probe, i),
    probe,
    section_id: section.id,
  }));
}

const STOPWORDS = new Set([
  'what',
  'when',
  'where',
  'which',
  'your',
  'the',
  'with',
  'this',
  'that',
  'from',
  'have',
  'does',
  'walk',
  'through',
  'would',
  'could',
  'about',
  'here',
  'there',
  'how',
  'are',
  'you',
  'for',
]);

function probeTriggerFromQuestion(probe, i) {
  const words = String(probe || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  return words[0] || `probe${i}`;
}

function buildDefaultOpening(template, sections) {
  const first = sections[0];
  const pq = template.primary_question;
  if (pq && typeof pq === 'object' && pq.title && first) {
    const ctx = typeof pq.context === 'string' ? pq.context.trim() : '';
    const lead = ctx.length > 220 ? `${ctx.slice(0, 220)}…` : ctx;
    return `Thanks for joining. One system design exercise today: "${pq.title}". ${lead ? `${lead} ` : ''}We'll start in ${first.name} — before you sketch components, what do you need to clarify about scope, users, and scale?`;
  }
  if (!first) return `Welcome — let's begin your ${template.template_id.replace(/_/g, ' ')} interview.`;
  return `Thanks for joining. We'll start with ${first.name}. Tell me about your recent experience that's most relevant to this area.`;
}
