import assert from 'node:assert/strict';
import test from 'node:test';
import { SYSTEM_DESIGN_RUBRICS } from '../config/systemDesignRubrics.js';
import {
  aggregateLiveEvaluationForReport,
  mergeEvaluationUpdate,
} from './liveEvaluationMerge.js';

test('mergeEvaluationUpdate keeps higher score', () => {
  const state = { live_evaluation: {} };
  mergeEvaluationUpdate(
    state,
    { section_id: 'requirements', signal_id: 'scope_driven', score: 2, evidence: 'hello world' },
    'candidate said hello world today',
    1
  );
  assert.equal(state.live_evaluation.requirements.scope_driven.score, 2);
  mergeEvaluationUpdate(
    state,
    { section_id: 'requirements', signal_id: 'scope_driven', score: 4, evidence: 'hello world' },
    'candidate said hello world today',
    2
  );
  assert.equal(state.live_evaluation.requirements.scope_driven.score, 4);
  assert.equal(state.live_evaluation.requirements.scope_driven.turn_index, 2);
});

test('mergeEvaluationUpdate rejects evidence not substring of candidate message', () => {
  const state = { live_evaluation: {} };
  mergeEvaluationUpdate(
    state,
    { section_id: 'requirements', signal_id: 'scope_driven', score: 3, evidence: 'not there' },
    'hello',
    1
  );
  assert.equal(state.live_evaluation.requirements, undefined);
});

test('aggregateLiveEvaluationForReport weighted score', () => {
  const live = {
    requirements: {
      scope_driven: { score: 4, evidence: 'a', turn_index: 1 },
      nfr_awareness: { score: 4, evidence: 'b', turn_index: 1 },
      estimation: { score: 4, evidence: 'c', turn_index: 1 },
    },
  };
  const { overallScore, sectionSummaries } = aggregateLiveEvaluationForReport(live, SYSTEM_DESIGN_RUBRICS);
  assert.equal(overallScore, '4.00');
  assert.ok(sectionSummaries.some((s) => s.sectionId === 'requirements'));
});
