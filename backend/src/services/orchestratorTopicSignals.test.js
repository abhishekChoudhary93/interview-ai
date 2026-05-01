import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIONS } from './orchestratorRuntime.js';
import {
  applyUncertaintyStreakFromCandidateMessage,
  detectCandidateSeekingDirection,
  detectExplicitTopicExit,
  detectRequirementsFactualClarification,
  detectUncertaintyPhrase,
  updateProbeCountersAfterDecision,
} from './orchestratorTopicSignals.js';

test('detectExplicitTopicExit matches common phrases', () => {
  assert.equal(detectExplicitTopicExit('Can we move forward with the design?'), true);
  assert.equal(detectExplicitTopicExit("Let's move on please"), true);
  assert.equal(detectExplicitTopicExit('Is this enough detail?'), true);
  assert.equal(detectExplicitTopicExit('I will scale the service horizontally'), false);
});

test('detectUncertaintyPhrase', () => {
  assert.equal(detectUncertaintyPhrase('I am not sure about that'), true);
  assert.equal(detectUncertaintyPhrase('just assumed 1GB per hour'), true);
  assert.equal(detectUncertaintyPhrase('800 PB total storage'), false);
});

test('applyUncertaintyStreakFromCandidateMessage increments and resets', () => {
  const state = { uncertain_response_streak: 0 };
  applyUncertaintyStreakFromCandidateMessage('not sure', state);
  assert.equal(state.uncertain_response_streak, 1);
  applyUncertaintyStreakFromCandidateMessage('still not sure', state);
  assert.equal(state.uncertain_response_streak, 2);
  applyUncertaintyStreakFromCandidateMessage('here is 200TB per day with 99.9% availability', state);
  assert.equal(state.uncertain_response_streak, 0);
});

test('updateProbeCountersAfterDecision resets on WRAP_TOPIC', () => {
  const state = {
    consecutive_same_topic_turns: 2,
    uncertain_response_streak: 2,
    last_probe_topic: 'old',
  };
  updateProbeCountersAfterDecision(state, ACTIONS.WRAP_TOPIC, 'requirements', 'Q?', 'ok');
  assert.equal(state.consecutive_same_topic_turns, 0);
  assert.equal(state.uncertain_response_streak, 0);
  assert.equal(state.last_probe_topic, null);
  assert.equal(state.current_thread.turns_on_thread, 0);
  assert.equal(state.last_decision_action, ACTIONS.WRAP_TOPIC);
});

test('detectRequirementsFactualClarification', () => {
  const numbered = `I am thinking of the following requirements - follow up question -
1. How many users ?
2. How many videos ?
3. What about features ?`;
  assert.equal(detectRequirementsFactualClarification(numbered), true);
  assert.equal(detectRequirementsFactualClarification('How many daily active users should we plan for?'), true);
  assert.equal(
    detectRequirementsFactualClarification(
      'First I would add an API gateway. Then a transcoding service. Then object storage.'
    ),
    false
  );
});

test('detectCandidateSeekingDirection', () => {
  assert.equal(detectCandidateSeekingDirection('Anything else you need me to focus on?'), true);
  assert.equal(detectCandidateSeekingDirection('What should I cover next?'), true);
  assert.equal(detectCandidateSeekingDirection('I would use a CDN for edge caching'), false);
});

test('updateProbeCountersAfterDecision resets thread on REDIRECT with redirect target', () => {
  const state = { consecutive_same_topic_turns: 3, uncertain_response_streak: 1, last_probe_topic: 'prev' };
  updateProbeCountersAfterDecision(
    state,
    ACTIONS.REDIRECT,
    'high_level_design',
    'Previous interviewer question?',
    'candidate asks for direction',
    'end-to-end upload flow'
  );
  assert.equal(state.consecutive_same_topic_turns, 0);
  assert.equal(state.last_probe_topic, 'end-to-end upload flow');
  assert.equal(state.last_decision_action, ACTIONS.REDIRECT);
});

test('updateProbeCountersAfterDecision increments on GO_DEEPER', () => {
  const state = { consecutive_same_topic_turns: 1, uncertain_response_streak: 0 };
  updateProbeCountersAfterDecision(state, ACTIONS.GO_DEEPER, 'requirements', 'Why 1GB?', 'because');
  assert.equal(state.consecutive_same_topic_turns, 2);
  assert.equal(state.last_decision_action, ACTIONS.GO_DEEPER);
  assert.ok(state.current_thread.topic.includes('requirements'));
});
