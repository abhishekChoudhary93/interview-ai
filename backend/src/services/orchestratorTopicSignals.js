import { ACTIONS } from './orchestratorRuntime.js';

/**
 * Deterministic signals for interview orchestrator: explicit topic exit,
 * uncertainty / stuck detection, and thread anchors (persisted on orchestrator_state).
 */

/** @param {string} text */
export function normalizeForPhraseMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .trim();
}

/** Phrases that mean the candidate wants to leave this line of questioning. */
const EXPLICIT_EXIT_SUBSTRINGS = [
  'can we move on',
  'can we move forward',
  "let's move on",
  'lets move on',
  'let us move on',
  'should we continue',
  'i think i covered this',
  'is this enough',
  'can we go to the next',
  'can we go to the next part',
  'move on to the next',
  'skip this',
  'skip to',
  'next question',
  'next part',
  'next section',
];

/**
 * @param {string} candidateMessage
 * @returns {boolean}
 */
export function detectExplicitTopicExit(candidateMessage) {
  const n = normalizeForPhraseMatch(candidateMessage);
  if (!n) return false;
  return EXPLICIT_EXIT_SUBSTRINGS.some((p) => n.includes(p));
}

/** Candidate asks the interviewer where to go next or signals being lost. */
const SEEKING_DIRECTION_SUBSTRINGS = [
  'anything else you need',
  'anything else i should',
  'anything else you want',
  'what should i focus',
  'what should i cover',
  'what do you want me to cover',
  'what would you like me to cover',
  'where should i go next',
  'where should i focus',
  'what else should i cover',
  'what else do you need',
  'need me to focus',
  'should i focus on',
  'anything you want me to',
];

/**
 * @param {string} candidateMessage
 * @returns {boolean}
 */
export function detectCandidateSeekingDirection(candidateMessage) {
  const n = normalizeForPhraseMatch(candidateMessage);
  if (!n) return false;
  return SEEKING_DIRECTION_SUBSTRINGS.some((p) => n.includes(p));
}

/** Substrings suggesting the candidate is asking the interviewer for requirement facts (not presenting a design). */
const REQUIREMENTS_FACTUAL_CUES = [
  'how many',
  'what about',
  'what should',
  "what's",
  'what is',
  'follow up question',
  'follow-up question',
  'in scope',
  'features',
  'subscribers',
  'channels',
  'likes',
  'dislikes',
  'comments',
  'scale',
  'users',
  'videos',
  'upload',
  'uploaded',
  'geographic',
  'sla',
  'region',
  'availability',
  'latency',
  'consistency',
  'anything else',
  'clarifying question',
];

/**
 * True when the message is primarily soliciting interviewer-held facts (scale, scope, NFRs), including numbered clarifying questions.
 * @param {string} candidateMessage
 * @returns {boolean}
 */
export function detectRequirementsFactualClarification(candidateMessage) {
  const raw = String(candidateMessage || '').trim();
  if (!raw) return false;
  const n = normalizeForPhraseMatch(raw);
  const qCount = (raw.match(/\?/g) || []).length;
  const followUpQuestion = /follow[\s-]?up[\s-]?question/.test(n);
  const hasNumberedQuestions = /^\s*\d+\./m.test(raw) && qCount >= 1;
  const factualCue = followUpQuestion || REQUIREMENTS_FACTUAL_CUES.some((p) => n.includes(p));
  if (hasNumberedQuestions) return true;
  if (!factualCue) return false;
  if (qCount >= 1 && factualCue) return true;
  return qCount >= 2;
}

const UNCERTAIN_SUBSTRINGS = [
  'not sure',
  "don't know",
  'dont know',
  'no idea',
  'random guess',
  'just guessed',
  'just assuming',
  'just assumed',
  'pure guess',
  'wild guess',
  "i'm guessing",
  'im guessing',
  'making it up',
  'no clue',
];

/**
 * @param {string} candidateMessage
 * @returns {boolean}
 */
export function detectUncertaintyPhrase(candidateMessage) {
  const n = normalizeForPhraseMatch(candidateMessage);
  if (!n) return false;
  return UNCERTAIN_SUBSTRINGS.some((p) => n.includes(p));
}

/**
 * Short anchor for the current micro-thread (deterministic, no extra LLM).
 * @param {string} sectionId
 * @param {string} lastInterviewerSnippet
 */
export function makeThreadTopicSlug(sectionId, lastInterviewerSnippet) {
  const sid = String(sectionId || 'section').slice(0, 40);
  const snip = String(lastInterviewerSnippet || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return snip ? `${sid}:${snip}` : sid;
}

/**
 * improving | stuck | gave_up — uses consecutive_same_topic_turns as currently on state
 * (caller uses pre-increment for decision prompt, post-increment after updateProbeCountersAfterDecision).
 * @param {object} state orchestrator_state
 * @param {string} candidateMessage
 */
export function computeCandidateProgress(state, candidateMessage) {
  if (detectExplicitTopicExit(candidateMessage)) return 'gave_up';
  const streak = state.uncertain_response_streak ?? 0;
  const turns = state.consecutive_same_topic_turns ?? 0;
  if (streak >= 3 || turns >= 3) return 'gave_up';
  if (streak >= 2) return 'stuck';
  if (streak >= 1 && turns >= 2) return 'stuck';
  return 'improving';
}

/**
 * @param {string} candidateMessage
 * @param {object} state orchestrator_state (mutated)
 */
export function applyUncertaintyStreakFromCandidateMessage(candidateMessage, state) {
  if (detectUncertaintyPhrase(candidateMessage)) {
    state.uncertain_response_streak = (state.uncertain_response_streak || 0) + 1;
  } else {
    const t = String(candidateMessage || '').trim();
    const looksSubstantive = t.length > 80 || /\d/.test(t);
    if (looksSubstantive) state.uncertain_response_streak = 0;
  }
}

/**
 * After final decision for the turn: probe depth counters and thread metadata.
 * @param {object} state orchestrator_state (mutated)
 * @param {string} finalAction ACTIONS.*
 * @param {string} sectionId
 * @param {string} pendingQuestionText question the candidate just answered
 * @param {string} candidateMessage
 * @param {string} [redirectTarget] anchor when action is REDIRECT
 */
export function updateProbeCountersAfterDecision(
  state,
  finalAction,
  sectionId,
  pendingQuestionText,
  candidateMessage,
  redirectTarget = ''
) {
  if (finalAction === ACTIONS.WRAP_TOPIC || finalAction === ACTIONS.NEXT_TOPIC || finalAction === ACTIONS.CLOSE_INTERVIEW) {
    state.consecutive_same_topic_turns = 0;
    state.last_probe_topic = null;
    state.uncertain_response_streak = 0;
    state.last_decision_action = finalAction;
    state.current_thread = {
      topic: '',
      turns_on_thread: 0,
      candidate_progress: 'improving',
    };
    return;
  }

  if (finalAction === ACTIONS.LET_CANDIDATE_LEAD || finalAction === ACTIONS.ANSWER_AND_CONTINUE) {
    state.consecutive_same_topic_turns = 0;
    state.last_probe_topic = null;
  } else if (finalAction === ACTIONS.REDIRECT) {
    state.consecutive_same_topic_turns = 0;
    const rt = String(redirectTarget || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    state.last_probe_topic = rt || null;
  } else if (finalAction === ACTIONS.GO_DEEPER || finalAction === ACTIONS.GIVE_HINT) {
    state.consecutive_same_topic_turns = (state.consecutive_same_topic_turns || 0) + 1;
    state.last_probe_topic = String(pendingQuestionText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  state.last_decision_action = finalAction;

  const anchor = state.last_probe_topic || pendingQuestionText || '';
  state.current_thread = {
    topic: makeThreadTopicSlug(sectionId, anchor),
    turns_on_thread: state.consecutive_same_topic_turns ?? 0,
    candidate_progress: computeCandidateProgress(state, candidateMessage),
  };
}
