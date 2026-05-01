import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTemplateAndAdaptation } from './executionPlanMerge.js';

const miniTemplate = {
  template_id: 'mini',
  version: '1',
  total_minutes: 20,
  sections: [
    {
      id: 'a',
      name: 'Section A',
      time_budget_minutes: 10,
      objectives: [],
      probe_questions: ['What about consistency?'],
    },
    {
      id: 'b',
      name: 'Section B',
      time_budget_minutes: 10,
      objectives: [],
      probe_questions: [],
    },
  ],
};

test('merge applies time_adjustments then rescales to total_minutes', () => {
  const adaptation = {
    time_adjustments: { a: 5 },
    priority_probes: {},
    opening_framing: '',
    level_expectations: 'Bar note',
  };
  const plan = mergeTemplateAndAdaptation(miniTemplate, adaptation, {});
  assert.equal(plan.total_minutes, 20);
  const sum = plan.sections.reduce((s, x) => s + x.time_budget_minutes, 0);
  assert.equal(sum, 20);
  assert.ok(plan.sections[0].time_budget_minutes >= 2);
  assert.ok(plan.sections[1].time_budget_minutes >= 2);
});

test('merge prepends priority_probes and sets planning_meta', () => {
  const adaptation = {
    time_adjustments: {},
    priority_probes: { a: ['Probe from plan gen'] },
    opening_framing: 'Custom opening line.',
    level_expectations: 'Expect depth on storage.',
  };
  const plan = mergeTemplateAndAdaptation(miniTemplate, adaptation, {});
  assert.equal(plan.opening_question.chosen, 'Custom opening line.');
  assert.equal(plan.planning_meta.level_expectations, 'Expect depth on storage.');
  const probes = plan.sections[0].pre_loaded_probes;
  assert.ok(probes.length >= 2);
  assert.equal(probes[0].probe, 'Probe from plan gen');
  assert.equal(probes[0].section_id, 'a');
});
