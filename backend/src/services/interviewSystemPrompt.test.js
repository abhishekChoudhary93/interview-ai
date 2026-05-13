import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, MOVE_GUIDANCE } from './interviewSystemPrompt.js';
import { loadInterviewConfig } from './interviewConfig.js';

test('system prompt includes base executor instructions', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /translate the Planner's Directive/i);
  assert.match(prompt, /# Directive/);
});

test('LISTEN move is canonicalized to LET_LEAD in directive rendering', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'LISTEN',
        focus: '',
      },
    },
  });
  assert.match(prompt, /Move:\s+LET_LEAD/);
});

test('directive renders focus from new focus field when present', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'GUIDE',
        focus: 'Before architecture, what are your requirements and NFRs?',
        recommended_focus: 'fallback text',
      },
    },
  });
  assert.match(prompt, /Move:\s+GUIDE/);
  assert.match(prompt, /Before architecture, what are your requirements and NFRs\?/);
});

test('MOVE_GUIDANCE includes v5 NEW moves NUDGE_BREADTH and INJECT_VARIANT', () => {
  assert.ok(MOVE_GUIDANCE.NUDGE_BREADTH, 'NUDGE_BREADTH guidance must exist');
  assert.match(MOVE_GUIDANCE.NUDGE_BREADTH, /Never name the missing component/);

  assert.ok(MOVE_GUIDANCE.INJECT_VARIANT, 'INJECT_VARIANT guidance must exist');
  assert.match(MOVE_GUIDANCE.INJECT_VARIANT, /variant/i);
});

test('MOVE_GUIDANCE.ANSWER_AND_RELEASE carries the bundled answer+question BAD example (v5.1)', () => {
  assert.ok(MOVE_GUIDANCE.ANSWER_AND_RELEASE);
  // Worked BAD pattern matching the transcript: answer followed by new question.
  assert.match(MOVE_GUIDANCE.ANSWER_AND_RELEASE, /Now walk me through your high-level architecture/);
  // The next-question-comes-NEXT-turn reminder.
  assert.match(MOVE_GUIDANCE.ANSWER_AND_RELEASE, /Planner on the NEXT turn/);
});
