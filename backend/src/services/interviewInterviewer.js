import { invokeLLM } from './llmInvoke.js';

/**
 * @param {object} ctx
 */
export async function runInterviewerTurn(ctx) {
  const {
    interview,
    execution_plan: plan,
    orchestrator_state: state,
    decision,
    conversation_tail,
    probe_injection,
  } = ctx;

  const role = interview.role_title || 'candidate';
  const company = interview.company || 'the company';
  const mode = interview.interview_mode || 'chat';
  const focus = String(interview.interview_type || 'mixed').toLowerCase();
  const sessionFocus =
    focus === 'system_design'
      ? 'Session focus: system design — emphasize scalability, interfaces, storage, consistency models, failure handling, and trade-offs.'
      : focus === 'behavioral'
        ? 'Session focus: behavioral — use STAR-style follow-ups on scope, influence, conflict, delivery, and team impact.'
        : 'Session focus: mixed — balance deep system-design probes with behavioral competency questions.';

  const hintGuide =
    decision.hint_level === 1
      ? 'Conceptual nudge only.'
      : decision.hint_level === 2
        ? 'Point to the domain without naming the answer.'
        : decision.hint_level === 3
          ? 'Near-answer hint (still do not fully solve).'
          : '';

  const prompt = `You are Maya, a senior engineering interviewer for ${company}.
Interview mode: ${mode}. Candidate role: ${role}.
${sessionFocus}

--- EXECUTION PLAN (follow coverage; one question at a time) ---
${JSON.stringify(plan?.sections?.slice(state.current_section_index, state.current_section_index + 2) || [], null, 2)}

--- CURRENT STATE ---
Elapsed minutes: ${state.elapsed_minutes ?? 0}
Current section index: ${state.current_section_index ?? 0}
Depth: ${state.depth_level ?? 1}

--- NEXT ACTION ---
Action: ${decision.action}
${decision.action === 'GIVE_HINT' ? `Hint level ${decision.hint_level}: ${hintGuide}` : ''}

${probe_injection ? `--- PROBE ---\n${probe_injection}\n` : ''}

--- CANDIDATE SIGNALS ---
Strong: ${(state.candidate_knowledge_map?.strong || []).join(', ') || 'n/a'}
Weak: ${(state.candidate_knowledge_map?.weak || []).join(', ') || 'n/a'}
Notable: ${(state.notable_statements || []).slice(-4).join(' | ') || 'n/a'}

--- RECENT CONVERSATION ---
${conversation_tail || '(start)'}

Speak one concise interviewer utterance (warm, rigorous, Socratic). Do not ask multiple unrelated questions. Do not reveal you are following a script.`;

  const text = await invokeLLM({ prompt });
  return typeof text === 'string' ? text.trim() : String(text);
}
