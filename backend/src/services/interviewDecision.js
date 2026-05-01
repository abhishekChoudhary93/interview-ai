import { invokeLLM } from './llmInvoke.js';

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    reason: { type: 'string' },
    hint_level: { type: 'number' },
  },
};

/**
 * @param {object} ctx
 */
export async function runInterviewDecision(ctx) {
  const {
    orchestrator_state: state,
    execution_plan: plan,
    candidate_message: candidateMessage,
    last_interviewer_message: lastIv,
    probe_injection,
  } = ctx;

  const prompt = `Given the candidate's last answer and interview state, choose the next action.

Actions (exact string):
GO_DEEPER | GIVE_HINT | EXHAUSTED_HINTS | PIVOT_CROSS | WRAP_TOPIC | NEXT_TOPIC | CLOSE_INTERVIEW

Current state summary:
- Elapsed minutes: ${state.elapsed_minutes ?? 0}
- Section index: ${state.current_section_index ?? 0}
- Depth level: ${state.depth_level ?? 1}
- Hints given this question: ${state.hints_given_this_question ?? 0}
- Topics completed: ${JSON.stringify(state.topics_completed || [])}

Execution plan (abbreviated sections): ${JSON.stringify(
    (plan?.sections || []).map((s) => ({ id: s.id, name: s.name, budget: s.time_budget_minutes })),
    null,
    0
  )}

Last interviewer line: ${lastIv || '(opening)'}

Candidate answer:
${candidateMessage}

${probe_injection ? `Important: A pre-loaded probe matched — prefer GO_DEEPER with focus:\n${probe_injection}\n` : ''}

Return JSON: { "action": "...", "reason": "short", "hint_level": 1 } (hint_level 1-3 only if GIVE_HINT)`;

  const result = await invokeLLM({
    prompt,
    response_json_schema: DECISION_SCHEMA,
    modelTier: 'decision',
  });

  const action = String(result.action || 'GO_DEEPER').toUpperCase().replace(/\s+/g, '_');
  const normalized = action.replace(/-/g, '_');
  return {
    action: normalized,
    reason: result.reason || '',
    hint_level: Number(result.hint_level) || 1,
  };
}
