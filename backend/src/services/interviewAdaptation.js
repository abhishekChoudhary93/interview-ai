import { invokeLLM } from './llmInvoke.js';

const ADAPTATION_SCHEMA = {
  type: 'object',
  properties: {
    topic_priority_adjustments: { type: 'object' },
    depth_allocation: { type: 'object' },
    pre_loaded_probes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trigger: { type: 'string' },
          probe: { type: 'string' },
          section_id: { type: 'string' },
        },
      },
    },
    cross_question_seeds: { type: 'array', items: { type: 'string' } },
    skip_list: { type: 'array', items: { type: 'string' } },
    opening_question: {
      type: 'object',
      properties: {
        chosen: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
};

/**
 * @param {object} opts
 * @param {object} opts.template RoleTemplate JSON
 * @param {object[]} opts.historySnapshots InterviewSignalSnapshot plain objects or []
 * @param {object} opts.interview { role_title, role_track, company, experience_level, interview_type, interview_mode, industry }
 */
export async function runInterviewAdaptation({ template, historySnapshots = [], interview = {} }) {
  const prompt = `You are a senior interviewer preparing a personalized interview execution plan.

BASE TEMPLATE:
${JSON.stringify(template, null, 2)}

CANDIDATE HISTORY (past interviews — may be empty):
${JSON.stringify(historySnapshots, null, 2)}

INTERVIEW META:
${JSON.stringify(interview, null, 2)}

RULES (non-negotiable):
- Required sections in the template cannot be removed.
- Time budgets cannot be exceeded.
- Minimum question counts must remain achievable.
- You are PERSONALIZING execution, not redesigning the interview.

Return JSON only with: topic_priority_adjustments, depth_allocation, pre_loaded_probes (trigger + probe + optional section_id), cross_question_seeds, skip_list, opening_question { chosen, reason }.`;

  return invokeLLM({
    prompt,
    response_json_schema: ADAPTATION_SCHEMA,
    modelTier: 'adaptation',
  });
}
