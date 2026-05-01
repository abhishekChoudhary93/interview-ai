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
import { recordSessionEndMetadata } from './interviewDebriefContext.js';
import { mergeEvaluationUpdate } from './liveEvaluationMerge.js';
import {
  applyUncertaintyStreakFromCandidateMessage,
  computeCandidateProgress,
  detectExplicitTopicExit,
  updateProbeCountersAfterDecision,
} from './orchestratorTopicSignals.js';

function mergeDecisionMetadata(state, decision) {
  const u = decision?.update_signals;
  if (u && typeof u === 'object') {
    if (!state.candidate_knowledge_map) state.candidate_knowledge_map = { strong: [], weak: [] };
    for (const s of Array.isArray(u.strong) ? u.strong : []) {
      const t = String(s || '').trim();
      if (t) state.candidate_knowledge_map.strong.push(t);
    }
    for (const w of Array.isArray(u.weak) ? u.weak : []) {
      const t = String(w || '').trim();
      if (t) state.candidate_knowledge_map.weak.push(t);
    }
    state.candidate_knowledge_map.strong = state.candidate_knowledge_map.strong.slice(-25);
    state.candidate_knowledge_map.weak = state.candidate_knowledge_map.weak.slice(-25);
  }
  const ns = decision?.notable_statement;
  if (ns && typeof ns === 'string' && ns.trim().length > 10) {
    state.notable_statements = (state.notable_statements || []).slice(-19);
    state.notable_statements.push(ns.trim().slice(0, 280));
  }
}

const MAX_TURNS = 35;

function guardCloseUnderMinDuration(state, decision) {
  const totalDurationClose =
    decision.forced && String(decision.reason || '').includes('total duration');
  const maxTurnsClose = decision.forced && String(decision.reason || '').includes('Max turns');
  if (
    decision.action === ACTIONS.CLOSE_INTERVIEW &&
    (state.elapsed_minutes || 0) < 15 &&
    !totalDurationClose &&
    !maxTurnsClose
  ) {
    return {
      ...decision,
      action: ACTIONS.WRAP_TOPIC,
      reason:
        'Guard: elapsed under 15 minutes — cannot close yet; continue the session (wrap or probe instead).',
      hint_level: 0,
      forced: true,
    };
  }
  return decision;
}

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
Years experience band: ${interview.years_experience_band || '(not set)'}
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
    state.hints_given_session = (state.hints_given_session || 0) + 1;
  }

  if (
    decision.action === ACTIONS.GO_DEEPER ||
    decision.action === ACTIONS.PIVOT_CROSS ||
    decision.action === ACTIONS.REDIRECT
  ) {
    state.depth_level = Math.min(4, (state.depth_level || 1) + 1);
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
      years_experience_band: interview.years_experience_band,
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
  if (!Array.isArray(interview.conversation_turns)) interview.conversation_turns = [];
  interview.conversation_turns.push({ role: 'interviewer', content: opening, kind: 'opening' });
  interview.markModified('conversation_turns');
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

  applyUncertaintyStreakFromCandidateMessage(candidateMessage, state);

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
    interview,
  });

  const hintsSession = state.hints_given_session ?? 0;
  const isSystemDesign = String(interview.interview_type || '').toLowerCase() === 'system_design';
  if (decision.action === ACTIONS.GIVE_HINT && hintsSession >= 3) {
    const prog = computeCandidateProgress(state, candidateMessage);
    const stuckMicro =
      isSystemDesign &&
      ((state.consecutive_same_topic_turns ?? 0) >= 2 ||
        (state.uncertain_response_streak ?? 0) >= 2 ||
        prog === 'stuck' ||
        prog === 'gave_up');
    if (stuckMicro) {
      decision = {
        ...decision,
        action: ACTIONS.WRAP_TOPIC,
        reason: 'Session hint cap with stuck micro-topic — wrap instead of drilling',
        hint_level: 0,
        forced: true,
      };
    } else {
      decision = {
        ...decision,
        action: ACTIONS.GO_DEEPER,
        reason: 'Session hint cap reached — continue with a probing question instead.',
        hint_level: 0,
      };
    }
  }

  decision = applyHardTimeGates(state, plan, decision);
  decision = guardCloseUnderMinDuration(state, decision);

  if ((state.turn_count || 0) >= MAX_TURNS) {
    decision = {
      action: ACTIONS.CLOSE_INTERVIEW,
      reason: 'Max turns',
      hint_level: 0,
      forced: true,
      probe_to_fire: '',
      cross_question_seed: '',
      notable_statement: '',
      redirect_target: '',
      update_signals: { strong: [], weak: [] },
      evaluation_update: null,
    };
  }

  decision = guardCloseUnderMinDuration(state, decision);

  const skipDeterministicOverride =
    decision.forced &&
    decision.action === ACTIONS.CLOSE_INTERVIEW &&
    (String(decision.reason || '').includes('Max turns') ||
      String(decision.reason || '').includes('total duration'));

  if (!skipDeterministicOverride) {
    if (detectExplicitTopicExit(candidateMessage)) {
      decision = {
        ...decision,
        action: ACTIONS.WRAP_TOPIC,
        reason: 'explicit_candidate_exit_signal',
        hint_level: 0,
        forced: true,
        probe_to_fire: '',
        cross_question_seed: '',
        redirect_target: '',
        evaluation_update: isSystemDesign ? null : decision.evaluation_update,
      };
    } else if ((state.consecutive_same_topic_turns ?? 0) >= 3) {
      decision = {
        ...decision,
        action: ACTIONS.WRAP_TOPIC,
        reason: 'micro_topic_probe_turn_cap',
        hint_level: 0,
        forced: true,
        probe_to_fire: '',
        cross_question_seed: '',
        redirect_target: '',
        evaluation_update: isSystemDesign ? null : decision.evaluation_update,
      };
    } else if (
      isSystemDesign &&
      (state.uncertain_response_streak ?? 0) >= 2 &&
      (decision.action === ACTIONS.GO_DEEPER || decision.action === ACTIONS.GIVE_HINT)
    ) {
      const extraWeak = 'Repeated uncertainty / guess on this thread — moving on';
      decision = {
        ...decision,
        action: ACTIONS.WRAP_TOPIC,
        reason: 'repeated_uncertainty_on_thread',
        hint_level: 0,
        forced: true,
        probe_to_fire: '',
        cross_question_seed: '',
        redirect_target: '',
        evaluation_update: null,
        update_signals: {
          strong: Array.isArray(decision.update_signals?.strong) ? decision.update_signals.strong : [],
          weak: [
            ...(Array.isArray(decision.update_signals?.weak) ? decision.update_signals.weak : []),
            extraWeak,
          ],
        },
      };
    }
  }

  mergeDecisionMetadata(state, decision);

  const candidateTurnIndex = (interview.conversation_turns || []).filter((t) => t.role === 'candidate').length;
  if (String(interview.interview_type || '').toLowerCase() === 'system_design') {
    mergeEvaluationUpdate(state, decision.evaluation_update, candidateMessage, candidateTurnIndex);
  }

  if (state.interview_done || decision.action === ACTIONS.CLOSE_INTERVIEW) {
    state.interview_done = true;
    updateProbeCountersAfterDecision(
      state,
      decision.action,
      sec?.id || '',
      pendingQ,
      candidateMessage,
      decision.redirect_target
    );
    recordSessionEndMetadata(interview, {
      candidateTriggeredEnd: false,
      source:
        decision.action === ACTIONS.CLOSE_INTERVIEW && String(decision.reason || '').includes('Max turns')
          ? 'max_turns'
          : 'orchestrator_close',
    });
    const closing =
      'Thank you — that completes our scheduled time for today. We appreciate your thoughtful answers.';
    interview.conversation_turns.push({ role: 'interviewer', content: closing });
    state.pending_question_text = '';
    state.turn_count = (state.turn_count || 0) + 1;
    interview.markModified('conversation_turns');
    interview.markModified('questions');
    await interview.save();
    return {
      done: true,
      interviewer_message: closing,
      orchestrator_state: state,
      scores,
    };
  }

  const tail = conversationTailFromInterview(interview, 6);
  const interviewer_message = await runInterviewerTurn({
    interview,
    execution_plan: plan,
    orchestrator_state: state,
    decision,
    conversation_tail: tail,
    probe_injection: probeInjection,
  });

  applyStructuralDecision(state, plan, decision);
  updateProbeCountersAfterDecision(
    state,
    decision.action,
    sec?.id || '',
    pendingQ,
    candidateMessage,
    decision.redirect_target
  );

  state.pending_question_text = interviewer_message;
  state.turn_count = (state.turn_count || 0) + 1;
  interview.conversation_turns.push({
    role: 'interviewer',
    content: interviewer_message,
    kind: decision.action,
  });

  interview.markModified('conversation_turns');
  interview.markModified('questions');
  await interview.save();

  return {
    done: !!state.interview_done,
    interviewer_message,
    orchestrator_state: state,
    decision,
    scores,
  };
}
