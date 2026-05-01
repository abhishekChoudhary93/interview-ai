import { invokeLLM } from './llmInvoke.js';
import { deriveCandidateLevel } from './interviewLevel.js';

const PLAN_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    time_adjustments: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
    priority_probes: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    opening_framing: { type: 'string' },
    level_expectations: { type: 'string' },
  },
  required: ['time_adjustments', 'priority_probes', 'opening_framing', 'level_expectations'],
};

function templateOutline(template) {
  const pq = template.primary_question;
  const pqBrief =
    pq && typeof pq === 'object'
      ? {
          title: pq.title,
          context: typeof pq.context === 'string' ? pq.context.slice(0, 400) : '',
        }
      : null;
  const sections = (template.sections || []).map((s) => ({
    id: s.id,
    name: s.name,
    time_budget_minutes: s.time_budget_minutes,
    objectives: Array.isArray(s.objectives) ? s.objectives.slice(0, 6) : [],
  }));
  return JSON.stringify({ template_id: template.template_id, primary_question: pqBrief, sections }, null, 0);
}

/**
 * @param {object} opts
 * @param {object} opts.template RoleTemplate JSON
 * @param {object[]} opts.historySnapshots InterviewSignalSnapshot plain objects or []
 * @param {object} opts.interview { role_title, role_track, company, experience_level, years_experience_band, interview_type, interview_mode, industry }
 */
export async function runInterviewAdaptation({ template, historySnapshots = [], interview = {} }) {
  const level = deriveCandidateLevel(interview);
  const prompt = `You are a FAANG interviewer preparing a system design interview.
Level: ${level}
Task: Given the question and section template below, return a JSON execution plan.

TEMPLATE OUTLINE:
${templateOutline(template)}

CANDIDATE HISTORY (past interviews — may be empty):
${JSON.stringify(historySnapshots, null, 0)}

INTERVIEW META:
${JSON.stringify(interview, null, 0)}

Return ONLY this JSON shape, no preamble:
{
  "time_adjustments": { "section_id": number_minutes_delta },
  "priority_probes": { "section_id": ["probe1", "probe2"] },
  "opening_framing": "Natural FAANG-style opening for this candidate level",
  "level_expectations": "One sentence on what bar looks like for ${level}"
}

Rules:
- SDM: weight tradeoffs + org sections more in your probes and time deltas; reduce deep-dive time vs template where sensible.
- IC_STAFF: expect them to drive requirements; add depth to deep-dive section via time_adjustments and priority_probes.
- IC_MID: standard weights; interviewer-side clarifying answers are appropriate in requirements phase (reflect in opening_framing tone).
- time_adjustments: small integers (e.g. -3 to +5 per section); must keep interview feasible — do not zero out required sections.
- priority_probes: concrete follow-up strings tied to section ids from the outline.
- opening_framing: 2-5 sentences, natural FAANG voice, present primary_question without rubric jargon; invite them into the first section.`;

  return invokeLLM({
    prompt,
    response_json_schema: PLAN_GENERATION_SCHEMA,
    modelTier: 'adaptation',
  });
}
