import { InterviewSignalSnapshot } from '../models/InterviewSignalSnapshot.js';
import { invokeLLM } from './llmInvoke.js';
import { mergeTemplateAndAdaptation } from './executionPlanMerge.js';
import { runInterviewAdaptation } from './interviewAdaptation.js';
import { loadRoleTemplate } from './templateLoader.js';
import { runInterviewDecision } from './interviewDecision.js';
import { runInterviewerTurn } from './interviewInterviewer.js';
import {
  ACTIONS,
  advanceClock,
  applyHardTimeGates,
  createInitialOrchestratorState,
} from './orchestratorRuntime.js';
import { getProbesForCurrentSection, matchPreloadedProbes } from './probeMatching.js';

const MAX_TURNS = 35;

function scoringSchema(isVideo) {
  return {
    type: 'object',
    properties: {
      answer_quality: { type: 'number' },
      english_clarity: { type: 'number' },
      communication: { type: 'number' },
      ...(isVideo ? { eye_contact: { type: 'number' }, body_language: { type: 'number' } } : {}),
      feedback: { type: 'string' },
    },
  };
}

async function scoreCandidateAnswer(interview, questionText, answerText) {
  const isVideo = interview.interview_mode === 'video';
  const prompt = `You are an expert interview evaluator. Score this interview answer.
Question: "${questionText}"
Answer: "${answerText}"
Role: ${interview.role_title} at ${interview.company}
Experience Level: ${interview.experience_level}
Interview Mode: ${interview.interview_mode}

Score on these dimensions (0-100 each):
1. answer_quality: Relevance, depth, examples, STAR method
2. english_clarity: Grammar, vocabulary, fluency
3. communication: Confidence, conciseness, professional tone
${isVideo ? "4. eye_contact: Estimated engagement (score generously from text cues)\n5. body_language: Posture/presence cues inferred from text" : ''}

Provide brief, actionable feedback (2-3 sentences).`;

  return invokeLLM({
    prompt,
    response_json_schema: scoringSchema(isVideo),
  });
}

function conversationTailFromInterview(interview, limit = 12) {
  const turns = interview.conversation_turns || [];
  const slice = turns.slice(-limit);
  return slice.map((t) => `${t.role}: ${t.content}`).join('\n');
}

function foldSignalsIntoState(state, feedbackText) {
  if (!state.candidate_knowledge_map) {
    state.candidate_knowledge_map = { strong: [], weak: [] };
  }
  const lower = (feedbackText || '').toLowerCase();
  if (lower.includes('strong') || lower.includes('clear')) {
    state.candidate_knowledge_map.strong.push('communication clarity');
  }
  if (lower.includes('weak') || lower.includes('lack')) {
    state.candidate_knowledge_map.weak.push('depth');
  }
}

function applyStructuralDecision(state, executionPlan, decision) {
  if (decision.action === ACTIONS.CLOSE_INTERVIEW) {
    state.interview_done = true;
    return;
  }

  const sections = executionPlan.sections || [];
  const lastIdx = Math.max(0, sections.length - 1);

  if (decision.action === ACTIONS.WRAP_TOPIC || decision.action === ACTIONS.NEXT_TOPIC) {
    state.hints_given_this_question = 0;
    state.depth_level = 1;
    if (state.current_section_index < lastIdx) {
      state.current_section_index += 1;
      state.current_section_minutes_spent = 0;
      state.current_topic_minutes_spent = 0;
    } else {
      state.interview_done = true;
    }
  }

  if (decision.action === ACTIONS.EXHAUSTED_HINTS) {
    state.hints_given_this_question = 0;
  }

  if (decision.action === ACTIONS.GIVE_HINT) {
    state.hints_given_this_question = (state.hints_given_this_question || 0) + 1;
  }
}

/**
 * @param {import('../models/Interview.js').Interview} interview mongoose doc
 */
export async function startInterviewSession(interview) {
  const now = Date.now();
  if (interview.execution_plan && interview.orchestrator_state?.pending_question_text && interview.session_started_at) {
    return {
      interviewer_message: interview.orchestrator_state.pending_question_text,
      orchestrator_state: interview.orchestrator_state,
      execution_plan: interview.execution_plan,
      reused: true,
    };
  }

  const templateId = interview.template_id;
  if (!templateId) throw new Error('Interview missing template_id');
  const template = loadRoleTemplate(templateId);

  const history = await InterviewSignalSnapshot.find({ userId: interview.userId })
    .sort({ completedAt: -1 })
    .limit(8)
    .lean();

  const adaptation = await runInterviewAdaptation({
    template,
    historySnapshots: history,
    interview: {
      role_title: interview.role_title,
      role_track: interview.role_track,
      company: interview.company,
      experience_level: interview.experience_level,
      interview_type: interview.interview_type,
      interview_mode: interview.interview_mode,
      industry: interview.industry,
    },
  });

  const execution_plan = mergeTemplateAndAdaptation(template, adaptation, {
    experience_level: interview.experience_level,
    role_title: interview.role_title,
  });

  const opening =
    typeof execution_plan.opening_question?.chosen === 'string'
      ? execution_plan.opening_question.chosen
      : `Let's begin with ${execution_plan.sections[0]?.name || 'the interview'}.`;

  const orchestrator_state = createInitialOrchestratorState(opening, now);

  interview.execution_plan = execution_plan;
  interview.adaptation_raw = adaptation;
  interview.orchestrator_state = orchestrator_state;
  interview.target_duration_minutes = execution_plan.total_minutes;
  interview.session_started_at = new Date(now);
  interview.template_version = execution_plan.template_version;
  interview.orch_schema_version = 1;
  await interview.save();

  return {
    interviewer_message: opening,
    orchestrator_state,
    execution_plan,
    reused: false,
  };
}

/**
 * @param {import('../models/Interview.js').Interview} interview
 * @param {string} candidateMessage
 */
export async function processInterviewTurn(interview, candidateMessage) {
  const plan = interview.execution_plan;
  const state = interview.orchestrator_state;
  if (!plan || !state) throw new Error('Session not started');
  if (state.interview_done) {
    return { done: true, interviewer_message: '', orchestrator_state: state };
  }

  const now = Date.now();
  advanceClock(state, now);

  const pendingQ = state.pending_question_text || '';
  const scores = await scoreCandidateAnswer(interview, pendingQ, candidateMessage);

  const isVideo = interview.interview_mode === 'video';
  const row = {
    question: pendingQ,
    answer: candidateMessage,
    score_answer_quality: scores.answer_quality,
    score_english_clarity: scores.english_clarity,
    score_communication: scores.communication,
    ...(isVideo ? { score_eye_contact: scores.eye_contact, score_body_language: scores.body_language } : {}),
    feedback: scores.feedback,
  };
  interview.questions.push(row);
  interview.conversation_turns.push({ role: 'candidate', content: candidateMessage, kind: 'answer' });
  foldSignalsIntoState(state, scores.feedback);
  if (candidateMessage.length > 40) {
    state.notable_statements = (state.notable_statements || []).slice(-19);
    state.notable_statements.push(candidateMessage.slice(0, 280));
  }

  const secIdx = state.current_section_index || 0;
  const probes = getProbesForCurrentSection(plan, secIdx);
  const sec = plan.sections?.[secIdx];
  const { probe, probeId } = matchPreloadedProbes(candidateMessage, probes, state, sec?.id || '');

  let probeInjection = '';
  if (probe && probeId) {
    probeInjection = probe.probe || '';
    state.fired_probe_ids = [...(state.fired_probe_ids || []), probeId];
  }

  let decision = await runInterviewDecision({
    orchestrator_state: state,
    execution_plan: plan,
    candidate_message: candidateMessage,
    last_interviewer_message: pendingQ,
    probe_injection: probeInjection,
  });

  decision = applyHardTimeGates(state, plan, decision);

  if ((state.turn_count || 0) >= MAX_TURNS) {
    decision = { action: ACTIONS.CLOSE_INTERVIEW, reason: 'Max turns', hint_level: 0, forced: true };
  }

  applyStructuralDecision(state, plan, decision);

  if (state.interview_done || decision.action === ACTIONS.CLOSE_INTERVIEW) {
    state.interview_done = true;
    const closing =
      'Thank you — that completes our scheduled time for today. We appreciate your thoughtful answers.';
    interview.conversation_turns.push({ role: 'interviewer', content: closing });
    state.pending_question_text = '';
    state.turn_count = (state.turn_count || 0) + 1;
    await interview.save();
    return {
      done: true,
      interviewer_message: closing,
      orchestrator_state: state,
      scores,
    };
  }

  const tail = conversationTailFromInterview(interview);
  const interviewer_message = await runInterviewerTurn({
    interview,
    execution_plan: plan,
    orchestrator_state: state,
    decision,
    conversation_tail: tail,
    probe_injection: probeInjection,
  });

  state.pending_question_text = interviewer_message;
  state.turn_count = (state.turn_count || 0) + 1;
  interview.conversation_turns.push({
    role: 'interviewer',
    content: interviewer_message,
    kind: decision.action,
  });

  await interview.save();

  return {
    done: !!state.interview_done,
    interviewer_message,
    orchestrator_state: state,
    decision,
    scores,
  };
}
