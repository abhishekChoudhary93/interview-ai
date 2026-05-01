import { formatNumberedCandidateBlock, getRecentCandidateContents } from './conversationPromptHelpers.js';
import { invokeLLM } from './llmInvoke.js';
import { ACTIONS } from './orchestratorRuntime.js';
import { deriveCandidateLevel, isStaffOrAboveLevel } from './interviewLevel.js';

function faangBarForTrack(plan, roleTrack) {
  const pq = plan?.primary_question;
  if (!pq || typeof pq !== 'object' || !pq.faang_bar) return '';
  const fb = pq.faang_bar;
  const track = String(roleTrack || 'ic').toLowerCase();
  if (track === 'sdm' && typeof fb.sdm === 'string') return fb.sdm;
  return typeof fb.ic === 'string' ? fb.ic : '';
}

/**
 * @param {{ action: string, hint_level?: number, probe_to_fire?: string, cross_question_seed?: string, redirect_target?: string }} decision
 * @param {boolean} isStaffOrAbove
 */
export function getActionInstructions(decision, isStaffOrAbove) {
  const a = decision?.action;
  switch (a) {
    case ACTIONS.LET_CANDIDATE_LEAD:
      return `INSTRUCTIONS:
- Candidate is actively explaining. Stay out of their way.
- 1 sentence max: "Okay." / "Got it." / "Right." / "Go ahead."
- Do NOT ask anything (zero "?" in your reply). Do NOT suggest what to cover.
- Do NOT add information.
${isStaffOrAbove ? '- Only if they asked you to solve design or do computations for them (not factual scope/scale): deflect in one sentence — they should state assumptions and proceed ("Make your assumptions and walk me through it.")' : ''}`;

    case ACTIONS.ANSWER_AND_CONTINUE:
      return `INSTRUCTIONS:
You are answering the candidate's clarifying question(s) in the requirements phase — only when they asked for factual constraints.

ANSWER THESE — these are facts the interviewer holds:
- Scale numbers (users, upload volume, request rates)
- Feature scope (what's in/out — feeds, comments, live streaming etc)
- Geographic scope
- SLA expectations if asked

DO NOT ANSWER THESE — candidate must figure out themselves:
- Any calculation or computation ("how much storage is that?")
- Any design question ("how would you handle that?")  
- Any tradeoff question ("which database would you use?")
- Anything that requires reasoning, not just fact recall

If they listed numbered questions: answer each factual item briefly in order (can use a tight comma-separated or short clauses; stay minimal).

If they asked a mix: answer only the factual parts. Do NOT end with "what else do you need from me?" unless they still have open factual clarifications pending.

If they are summarizing assumptions and moving into design (not asking for more facts): do not use that phrase — either one calibration question on an estimate they stated or "Go ahead."

If they still need facts: after factual answers you may say "what else?" — short only.

Format: short, direct answers only. No elaboration. No examples.`;

    case ACTIONS.REDIRECT: {
      const raw =
        decision.redirect_target && String(decision.redirect_target).trim()
          ? String(decision.redirect_target).trim()
          : 'the most important gap you have not walked through yet';
      const esc = raw.replace(/"/g, '\\"');
      return `INSTRUCTIONS:
- Candidate has stopped and needs direction.
- Aim ONE concrete probe at this uncovered area: "${esc}"
- Ask one specific question (walk-through, failure mode, or trade-off). At most one "?".
- Do not repeat information already given. Do not re-state the problem or re-read scale numbers from earlier.
- Example shapes: "Walk me through [specific thing]." / "How would you handle [specific gap]?" / "You mentioned X — go deeper on that."
- 1-2 sentences maximum.`;
    }

    case ACTIONS.GO_DEEPER:
      return `INSTRUCTIONS:
- Ask ONE follow-up question that pushes deeper on what they just said.
- Reference something specific from their last response.
- Do not introduce a new topic — go deeper on the current one.`;

    case ACTIONS.GIVE_HINT:
      return `INSTRUCTIONS:
- Hint level: ${decision.hint_level}
${decision.hint_level === 1 ? '- Nudge toward the concept area only. No specifics.' : ''}
${decision.hint_level === 2 ? '- Name the concept area without giving the answer.' : ''}
${decision.hint_level === 3 ? '- Near-answer. Give enough that a knowledgeable candidate can complete the thought.' : ''}
- Do NOT give the answer outright even at level 3.`;

    case ACTIONS.PIVOT_CROSS: {
      const q =
        (decision.probe_to_fire && String(decision.probe_to_fire).trim()) ||
        (decision.cross_question_seed && String(decision.cross_question_seed).trim()) ||
        '';
      return `INSTRUCTIONS:
- Ask this probe or cross-question naturally: "${q.replace(/"/g, '\\"')}"
- Frame it naturally, do not make it feel like a quiz.
- After asking, wait — do not add extra context or hints.`;
    }

    case ACTIONS.WRAP_TOPIC:
      return `INSTRUCTIONS:
- In 1-2 sentences, briefly acknowledge what was covered (no praise, just factual).
- Bridge naturally to next section. ("Let's move to the high level design — go ahead.")
- Keep it under 3 sentences total.`;

    case ACTIONS.NEXT_TOPIC:
      return `INSTRUCTIONS:
- Transition cleanly. ("Okay, let's shift to the next part — whenever you're ready.")
- 1 sentence only. Do not summarize what came before.`;

    case ACTIONS.CLOSE_INTERVIEW:
      return `INSTRUCTIONS:
- Close the interview naturally. ("That's all the time we have. Thanks for walking me through this.")
- 2 sentences max. Do not evaluate them out loud.`;

    default:
      return `INSTRUCTIONS: Acknowledge briefly and wait. 1 sentence max.`;
  }
}

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

  const company = interview.company || 'the company';
  const mode = interview.interview_mode || 'chat';
  const focus = String(interview.interview_type || 'mixed').toLowerCase();
  const sessionFocus =
    focus === 'system_design'
      ? 'Session focus: system design — scalability, interfaces, storage, consistency, failures, trade-offs.'
      : focus === 'behavioral'
        ? 'Session focus: behavioral — STAR follow-ups on scope, influence, conflict, delivery.'
        : 'Session focus: mixed — system design and behavioral balance.';

  const level = deriveCandidateLevel(interview);
  const isStaffOrAbove = isStaffOrAboveLevel(level);
  const actionInstructions = getActionInstructions(decision, isStaffOrAbove);

  const pq = plan?.primary_question;
  const section = plan?.sections?.[state.current_section_index ?? 0];
  const ctxText =
    pq && typeof pq === 'object' && typeof pq.context === 'string' ? pq.context.slice(0, 600) : '';
  const bar = faangBarForTrack(plan, interview.role_track);
  const levelLine =
    typeof plan?.planning_meta?.level_expectations === 'string' && plan.planning_meta.level_expectations.trim()
      ? plan.planning_meta.level_expectations.trim()
      : '';

  const probeFromDecision =
    decision?.probe_to_fire && String(decision.probe_to_fire).trim()
      ? `PROBE: ${decision.probe_to_fire.trim()}`
      : '';
  const crossFromDecision =
    decision?.cross_question_seed && String(decision.cross_question_seed).trim()
      ? `CROSS_SEED: ${decision.cross_question_seed.trim()}`
      : '';

  const lastThreeCandidate = getRecentCandidateContents(interview?.conversation_turns || [], 3);
  const lastThreeBlock = formatNumberedCandidateBlock(
    'LAST_3_CANDIDATE_MESSAGES (oldest listed first; use for REDUNDANCY CHECK):',
    lastThreeCandidate
  );

  const prompt = `You are Alex, a Staff Engineer doing a FAANG system design interview.
Style: rigorous, Socratic, minimal words. Never say "great answer" or "excellent."

BASE_RULES (always apply on top of ACTION):
- NO_META_EVAL: Never use rubric-like or grading phrases out loud (e.g. "scope explicitly bounded", "objectives met", "requirements satisfied", "moving to design"). Speak like a human interviewer, not an evaluator reading checklist labels.
- REDUNDANCY CHECK: Before asking anything — scan the last 3 candidate messages (see block below). If they already addressed this topic, do not ask about it. Acknowledge what they said and move forward.
- MID-EXPLANATION RULE: If the candidate is listing components, walking through a flow, or clearly building toward something — stay silent. One acknowledgment max. Do not probe until they say they are done or go silent.
- COMPOUND QUESTION BAN: At most one question mark (?) in your entire reply. Hard rule. If you have two questions, pick the more important one and drop the other.
- LET_CANDIDATE_LEAD: If ACTION is LET_CANDIDATE_LEAD, your reply must contain zero "?".
- CONFUSION RECOVERY: If the candidate says they do not understand or are not sure what you mean — rephrase in ONE simpler sentence. Do not add more context. Less is more.

${lastThreeBlock}

LEVEL: ${level}
COMPANY: ${company} | MODE: ${mode}
${sessionFocus}

QUESTION: ${pq && typeof pq === 'object' ? pq.title || '' : ''}
CONTEXT (trim): ${ctxText}
SECTION: ${section?.name || ''}
BAR (${String(interview.role_track || 'ic').toUpperCase()}): ${bar || 'standard senior system design bar'}
${levelLine ? `PLANNING_BAR_NOTE: ${levelLine}\n` : ''}

CANDIDATE_SIGNALS:
strong: ${(state.candidate_knowledge_map?.strong || []).join(', ') || 'tbd'}
weak: ${(state.candidate_knowledge_map?.weak || []).join(', ') || 'tbd'}
notable: ${(state.notable_statements || []).slice(-3).join(' | ') || 'none'}

ACTION: ${decision.action}
${actionInstructions}

${probe_injection ? `KEYWORD_PROBE: ${probe_injection}\n` : ''}
${probeFromDecision}
${crossFromDecision}

CONVERSATION (last turns):
${conversation_tail || '(start)'}

Alex (follow ACTION instructions exactly, be concise):`;

  const text = await invokeLLM({ prompt });
  return typeof text === 'string' ? text.trim() : String(text);
}
