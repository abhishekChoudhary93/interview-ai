import { SYSTEM_DESIGN_RUBRICS } from '../config/systemDesignRubrics.js';
import { formatNumberedCandidateBlock, getRecentCandidateContents } from './conversationPromptHelpers.js';
import { invokeLLM } from './llmInvoke.js';
import { ACTIONS, TIME_OVERFLOW_FACTOR } from './orchestratorRuntime.js';
import { deriveCandidateLevel, isStaffOrAboveLevel } from './interviewLevel.js';
import {
  computeCandidateProgress,
  detectCandidateSeekingDirection,
  detectRequirementsFactualClarification,
} from './orchestratorTopicSignals.js';

const EVALUATION_UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    section_id: { type: 'string' },
    signal_id: { type: 'string' },
    score: { type: 'number' },
    evidence: { type: 'string' },
  },
};

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    reason: { type: 'string' },
    hint_level: { type: 'number' },
    probe_to_fire: { type: 'string' },
    cross_question_seed: { type: 'string' },
    notable_statement: { type: 'string' },
    update_signals: {
      type: 'object',
      properties: {
        strong: { type: 'array', items: { type: 'string' } },
        weak: { type: 'array', items: { type: 'string' } },
      },
    },
    evaluation_update: EVALUATION_UPDATE_SCHEMA,
    redirect_target: { type: 'string' },
  },
};

const VALID_ACTIONS = new Set(Object.values(ACTIONS));

/**
 * Rubric signals for the current section only (system design).
 * @param {string} sectionId
 */
function formatRubricSliceForPrompt(sectionId) {
  const r = SYSTEM_DESIGN_RUBRICS[sectionId];
  if (!r || !Array.isArray(r.signals)) return '';
  const parts = [];
  for (const sig of r.signals) {
    parts.push(
      `signal_id="${sig.id}" label="${sig.label}"\n  description: ${sig.description}\n  scores:\n    1: ${sig.scores[1]}\n    2: ${sig.scores[2]}\n    3: ${sig.scores[3]}\n    4: ${sig.scores[4]}`
    );
  }
  return parts.join('\n\n');
}

function normalizeEvaluationUpdate(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  if (Object.keys(raw).length === 0) return null;
  const section_id = typeof raw.section_id === 'string' ? raw.section_id.trim() : '';
  const signal_id = typeof raw.signal_id === 'string' ? raw.signal_id.trim() : '';
  if (!section_id || !signal_id) return null;
  let score = raw.score;
  if (score === null || score === undefined) return null;
  const n = Math.round(Number(score));
  if (!Number.isFinite(n) || n < 1 || n > 4) return null;
  const evidence = typeof raw.evidence === 'string' ? raw.evidence.trim() : '';
  if (!evidence) return null;
  return { section_id, signal_id, score: n, evidence };
}

function normalizeRedirectTarget(raw, action, fallbackObjectives) {
  if (action !== ACTIONS.REDIRECT) return '';
  let t = typeof raw === 'string' ? raw.trim() : '';
  if (!t && Array.isArray(fallbackObjectives) && fallbackObjectives.length > 0) {
    t = String(fallbackObjectives[0]).trim();
  }
  return t;
}

function normalizeAction(raw) {
  let a = String(raw || 'GO_DEEPER')
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  if (a === 'PIVOT_PROBE') a = ACTIONS.PIVOT_CROSS;
  if (a === 'WRAP_SECTION') a = ACTIONS.WRAP_TOPIC;
  if (a === 'NEXT_SECTION') a = ACTIONS.NEXT_TOPIC;
  if (a === 'CROSS_QUESTION') a = ACTIONS.PIVOT_CROSS;
  if (a === 'EXHAUSTED_HINTS') a = ACTIONS.WRAP_TOPIC;
  if (!VALID_ACTIONS.has(a)) a = ACTIONS.GO_DEEPER;
  return a;
}

/**
 * @param {object} ctx
 * @param {object} ctx.orchestrator_state
 * @param {object} ctx.execution_plan
 * @param {string} ctx.candidate_message
 * @param {string} [ctx.last_interviewer_message]
 * @param {string} [ctx.probe_injection]
 * @param {object} [ctx.interview]
 */
export async function runInterviewDecision(ctx) {
  const {
    orchestrator_state: state,
    execution_plan: plan,
    candidate_message: candidateMessage,
    last_interviewer_message: lastIv,
    probe_injection,
    interview,
  } = ctx;

  const secIdx = state.current_section_index ?? 0;
  const sec = plan?.sections?.[secIdx];
  const budget = sec?.time_budget_minutes ?? 15;
  const sectionSpent = state.current_section_minutes_spent ?? 0;
  const hintsSession = state.hints_given_session ?? 0;
  const elapsedTotal = state.elapsed_minutes ?? 0;
  const totalBudget = plan?.total_minutes ?? 60;
  const remainingMin = Math.max(0, totalBudget - elapsedTotal);
  const budgetExceeded = sectionSpent > budget * TIME_OVERFLOW_FACTOR;

  const objectives = Array.isArray(sec?.objectives) ? sec.objectives : [];
  const probes = Array.isArray(sec?.probe_questions) ? sec.probe_questions : [];
  const candidateLevel = deriveCandidateLevel(interview || {});
  const isStaffOrAbove = isStaffOrAboveLevel(candidateLevel);
  const isRequirementsSection = sec?.id === 'requirements';

  const levelExpectations =
    typeof plan?.planning_meta?.level_expectations === 'string'
      ? plan.planning_meta.level_expectations.trim()
      : '';

  const isSystemDesign = String(interview?.interview_type || '').toLowerCase() === 'system_design';
  const rubricSectionId = sec?.id || '';
  const candidateProgress = computeCandidateProgress(state, candidateMessage);
  const seekingDirection = detectCandidateSeekingDirection(candidateMessage);
  const requirementsFactualClarification =
    isRequirementsSection && detectRequirementsFactualClarification(candidateMessage);
  const consecutiveTopic = state.consecutive_same_topic_turns ?? 0;
  const uncertainStreak = state.uncertain_response_streak ?? 0;
  const lastThreadTopic = String(state.current_thread?.topic || '').slice(0, 200);
  const rubricBlock =
    isSystemDesign && SYSTEM_DESIGN_RUBRICS[rubricSectionId]
      ? `
RUBRIC (current section only). After choosing action, also record whether the candidate's LAST message demonstrated one rubric signal.

evaluation_update shape — use null for this turn if nothing was clearly demonstrated:
{
  "section_id": "${rubricSectionId}",
  "signal_id": "...",
  "score": 1-4 or null,
  "evidence": "exact quote from candidate's last message"
} | null

Signals for section_id="${rubricSectionId}":
${formatRubricSliceForPrompt(rubricSectionId)}
`
      : '';

  const pqTitle =
    plan?.primary_question && typeof plan.primary_question === 'object'
      ? String(plan.primary_question.title || '').trim().slice(0, 400)
      : '';
  const recentTwo = getRecentCandidateContents(interview?.conversation_turns || [], 2, 2000);
  const recentCandidateBlock = formatNumberedCandidateBlock(
    'RECENT_CANDIDATE_MESSAGES (oldest first, latest last; use for steps 0b–0c):',
    recentTwo
  );

  const prompt = `Interview orchestrator. Decide next action. Return JSON only.

STATE:
PRIMARY_QUESTION: "${pqTitle.replace(/"/g, '\\"')}"
section="${sec?.name || 'unknown'}" section_id="${sec?.id || ''}" elapsed_section=${sectionSpent.toFixed(1)}m budget=${budget}m elapsed_total=${elapsedTotal.toFixed(1)}m total_budget=${totalBudget}m remaining=${remainingMin.toFixed(1)}m
depth=${state.depth_level ?? 1}/${sec?.depth_levels ?? 3} hints_session=${hintsSession} budget_exceeded=${budgetExceeded}
last_decision_action="${state.last_decision_action ?? 'null'}" consecutive_same_topic_turns=${consecutiveTopic} uncertain_response_streak=${uncertainStreak}
CANDIDATE_SEEKING_DIRECTION=${seekingDirection}
REQUIREMENTS_FACTUAL_CLARIFICATION=${requirementsFactualClarification}
CURRENT_THREAD (from prior turn; use with candidate's latest message): last_topic_snippet="${lastThreadTopic.replace(/"/g, '\\"')}" candidate_progress="${candidateProgress}"

OBJECTIVES REMAINING: ${objectives.join(' | ') || 'none'}
WEAK SIGNALS: ${(state.candidate_knowledge_map?.weak || []).join(', ') || 'none'}
NOTABLE: ${(state.notable_statements || []).slice(-3).join(' | ') || 'none'}

LAST INTERVIEWER: ${(lastIv || '(opening)').slice(0, 400)}
LAST CANDIDATE: "${candidateMessage.replace(/"/g, '\\"').slice(0, 2000)}"
${recentCandidateBlock}

${probe_injection ? `PROBE_HINT: ${probe_injection}\n` : ''}
candidate_level="${candidateLevel}" is_staff_or_above=${isStaffOrAbove} section_is_requirements=${isRequirementsSection}
${levelExpectations ? `LEVEL_EXPECTATIONS: ${levelExpectations}\n` : ''}

ACTIONS (exact string):
LET_CANDIDATE_LEAD | ANSWER_AND_CONTINUE | REDIRECT | GO_DEEPER | GIVE_HINT | PIVOT_CROSS | WRAP_TOPIC | NEXT_TOPIC | CLOSE_INTERVIEW

REDIRECT — Candidate stopped, asks you for direction, one-liner stall when substance was expected, or finished a large outline and needs the next probe. Pick the weakest uncovered gap from OBJECTIVES REMAINING / section goals vs conversation. Never repeat PRIMARY_QUESTION scale numbers or restate the prompt verbatim. Set redirect_target to that gap (short phrase). Ask one concrete angle via the interviewer pass.

HARD RULES:
- If total elapsed < 15 minutes AND action=CLOSE_INTERVIEW →
  override to WRAP_TOPIC instead. Never close early.
- If candidate ends the conversation themselves before sections complete →
  action=CLOSE_INTERVIEW is allowed but flag it in reason as "candidate_terminated_early"
- If candidate_progress="gave_up" OR LAST CANDIDATE asks to move on / end this line of questioning (e.g. "can we move on", "let's move forward", "is this enough") → WRAP_TOPIC or NEXT_TOPIC immediately. Never GO_DEEPER again in that case. Overrides depth targets.
- If consecutive_same_topic_turns>=2 AND candidate showed no new substance on this micro-topic → WRAP_TOPIC (do not ask a third variation of the same question).
- If uncertain_response_streak>=2 on this section/topic → treat as hints exhausted for this thread: WRAP_TOPIC and add a short weak signal in update_signals.weak (e.g. could not derive this thread from first principles).
- If consecutive_same_topic_turns>=3 OR candidate_progress="gave_up" → WRAP_TOPIC or NEXT_TOPIC (must change micro-topic; do not GO_DEEPER).
- LET_CANDIDATE_LEAD vs REDIRECT: Mid-explanation / clear forward momentum on the same thought → LET_CANDIDATE_LEAD. Self-contained multi-service + flow outline with no explicit direction question → REDIRECT or GO_DEEPER on weakest uncovered area (not passive acknowledgment only). One-liner agreement or NFR echo with no new design content (e.g. "yes, highly available and low latency") → REDIRECT, not LET_CANDIDATE_LEAD.
- REQUIREMENTS phase: Numbered lists of questions to you, or REQUIREMENTS_FACTUAL_CLARIFICATION=true, are NOT design walkthroughs — use ANSWER_AND_CONTINUE (step 0e). Never LET_CANDIDATE_LEAD staff deflection for those.

DECISION LOGIC (follow in order, stop at first match):
0. Early dispositions (sub-steps 0a → 0d → 0e → 0b → 0c in order; first matching sub-step ends step 0; if none match, continue to step 1):
   0a. EXPLICIT EXIT / MOVE ON — candidate's LAST CANDIDATE message asks to leave this topic (see HARD RULES) OR candidate_progress=gave_up → WRAP_TOPIC or NEXT_TOPIC immediately.
   0d. CANDIDATE SEEKING DIRECTION — CANDIDATE_SEEKING_DIRECTION=true OR LAST CANDIDATE asks the interviewer what to do next (e.g. "anything else you need", "what should I focus on", "what do you want me to cover", "where should I go next") → REDIRECT. Set redirect_target to ONE concrete uncovered objective or gap (from OBJECTIVES REMAINING vs conversation). Do not restate problem statement or re-read scale from earlier turns.
   0e. REQUIREMENTS FACTUAL CLARIFICATION — section_is_requirements=true AND REQUIREMENTS_FACTUAL_CLARIFICATION=true → ANSWER_AND_CONTINUE (all candidate_level including IC_STAFF). They are asking for interviewer-held facts (scale, feature boundaries, geography, SLA). Do not choose LET_CANDIDATE_LEAD to deflect. Do not pivot to design probes until factual asks are answered briefly or they move on.
   0b. PRE-DECISION CHECK — Before selecting any action that would re-ask or drill the same thread: answer "Did the candidate already address this topic in their last 2 candidate messages?" (use RECENT_CANDIDATE_MESSAGES vs LAST INTERVIEWER / last_topic_snippet / objectives). If yes → LET_CANDIDATE_LEAD; do not re-ask.
   0c. DESIGN WALKTHROUGH DETECTION — Skip entirely if REQUIREMENTS_FACTUAL_CLARIFICATION=true. If the candidate is actively describing THEIR design (components, APIs, data paths, "first I would… then…") mid-flow without a complete picture yet → LET_CANDIDATE_LEAD; wait until they finish. Numbered lists of clarifying questions with "?" are NOT this case. If the message is already a complete multi-component outline and not asking for direction, do not use LET_CANDIDATE_LEAD here — fall through (REDIRECT/GO_DEEPER later).
1. budget_exceeded=true → WRAP_TOPIC or NEXT_TOPIC
2. consecutive_same_topic_turns>=3 OR uncertain_response_streak>=3 → WRAP_TOPIC
3. hints_session>=3 and candidate still stuck on same micro-topic → WRAP_TOPIC
4. DIMINISHING RETURNS (before choosing GO_DEEPER): if candidate said "not sure", "just assumed", "random guess", or equivalent for this thread — first time → GIVE_HINT hint_level=1 (only if hints_session<3); second time → GIVE_HINT hint_level=3 if hints_session<3 else WRAP_TOPIC with weak signal; third time → WRAP_TOPIC. If candidate asked to move on, WRAP_TOPIC (step 0a).
5. Candidate asks for factual requirements only (scale, scope, SLA, geography, what's in/out) AND section_is_requirements AND they are not summarizing assumptions and moving into design without an unanswered factual ask → ANSWER_AND_CONTINUE (any candidate_level; overlaps 0e when REQUIREMENTS_FACTUAL_CLARIFICATION=true)
6. Candidate asked clarifying question AND section_is_requirements AND is_staff_or_above AND REQUIREMENTS_FACTUAL_CLARIFICATION=false AND they are asking you to design or compute for them (not factual scope/scale) → LET_CANDIDATE_LEAD
7. Candidate asked clarifying question AND NOT section_is_requirements → LET_CANDIDATE_LEAD
8. Candidate actively explaining with forward momentum on the same thought → LET_CANDIDATE_LEAD
9. Candidate response very short / shallow for this section → GO_DEEPER or GIVE_HINT (GIVE_HINT only if hints_session<3)
10. Section objectives largely met → WRAP_TOPIC
11. Critical gap AND time running low → PIVOT_CROSS with probe_to_fire from: ${probes.join(' | ') || 'n/a'}
12. Default → LET_CANDIDATE_LEAD

CLOSE_INTERVIEW only if elapsed_total >= 15 and (all sections done or remaining<3min).
${rubricBlock}
Return JSON:
{"action":"...","reason":"...","hint_level":0,"probe_to_fire":"","cross_question_seed":"","notable_statement":"","redirect_target":null or "short uncovered objective phrase"${isSystemDesign && SYSTEM_DESIGN_RUBRICS[rubricSectionId] ? ',"evaluation_update":null or {"section_id":"...","signal_id":"...","score":1-4 or null,"evidence":"exact quote from candidate\'s last message"}' : ''},"update_signals":{"strong":[],"weak":[]}}
When action=REDIRECT: redirect_target must be non-null string (uncovered objective/gap). Otherwise redirect_target=null or "".
hint_level 1-3 only when action=GIVE_HINT else 0.`;

  const result = await invokeLLM({
    prompt,
    response_json_schema: DECISION_SCHEMA,
    modelTier: 'decision',
  });

  const action = normalizeAction(result.action);
  const hint_level = Number(result.hint_level);
  const hl = Number.isFinite(hint_level) && hint_level >= 1 && hint_level <= 3 ? Math.floor(hint_level) : 1;

  const evaluation_update =
    isSystemDesign && SYSTEM_DESIGN_RUBRICS[rubricSectionId]
      ? normalizeEvaluationUpdate(result.evaluation_update)
      : null;

  const redirect_target = normalizeRedirectTarget(result.redirect_target, action, objectives);

  return {
    action,
    reason: typeof result.reason === 'string' ? result.reason : '',
    hint_level: action === ACTIONS.GIVE_HINT ? hl : 0,
    probe_to_fire: typeof result.probe_to_fire === 'string' ? result.probe_to_fire.trim() : '',
    cross_question_seed: typeof result.cross_question_seed === 'string' ? result.cross_question_seed.trim() : '',
    notable_statement: typeof result.notable_statement === 'string' ? result.notable_statement.trim() : '',
    redirect_target,
    update_signals: {
      strong: Array.isArray(result.update_signals?.strong)
        ? result.update_signals.strong.filter((x) => typeof x === 'string' && x.trim())
        : [],
      weak: Array.isArray(result.update_signals?.weak)
        ? result.update_signals.weak.filter((x) => typeof x === 'string' && x.trim())
        : [],
    },
    evaluation_update,
  };
}
