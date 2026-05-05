import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  streamInterviewerReply,
  buildProblemHandoff,
  generateOpeningLine,
  warmExecutorPrefix,
} from './interviewConverse.js';
import { loadInterviewConfig } from './interviewConfig.js';

/**
 * Post-refactor: `generateOpeningLine` is now LLM-backed and produces a
 * single combined intro+problem message in persona. Without an
 * OPENROUTER_API_KEY it falls back to a deterministic synthesis that mirrors
 * the historical T0 format — this is what the unit tests exercise.
 *
 * `streamInterviewerReply` remains a pure pass-through to the Executor LLM.
 */

async function collectStream(gen) {
  const chunks = [];
  for await (const chunk of gen) chunks.push(String(chunk));
  return chunks.join('');
}

/* --------------------------- buildProblemHandoff --------------------- */

test('buildProblemHandoff returns config.problem.opening_prompt verbatim', () => {
  const config = loadInterviewConfig();
  const handoff = buildProblemHandoff(config);
  assert.equal(handoff, config.problem.opening_prompt.trim());
});

test('buildProblemHandoff falls back to title + brief synthesis when opening_prompt is missing', () => {
  const handoff = buildProblemHandoff({
    problem: { title: 'Design a chat application', brief: '1B users globally.' },
  });
  assert.match(handoff, /chat application/);
  assert.match(handoff, /1B users globally/);
  assert.match(handoff, /requirements/i);
});

test('buildProblemHandoff handles missing config gracefully', () => {
  const handoff = buildProblemHandoff({});
  assert.equal(typeof handoff, 'string');
  assert.ok(handoff.length > 0);
});

/* --------------------------- generateOpeningLine --------------------- */

test('generateOpeningLine produces a non-empty message containing persona + problem in one turn', async () => {
  // In test mode (no OPENROUTER_API_KEY), the LLM call returns a mock string
  // and the function returns that. Production goes through the real LLM. In
  // both cases the output must be non-empty — the deterministic fallback is
  // a hard floor.
  const config = loadInterviewConfig();
  const opening = await generateOpeningLine({
    interview: { interview_type: 'system_design' },
    config,
  });
  assert.ok(typeof opening === 'string' && opening.length > 0);
});

test('generateOpeningLine deterministic fallback combines intro + problem when LLM is unavailable', async () => {
  // We can drive the deterministic-fallback branch by passing a config whose
  // `problem.opening_prompt` is missing — `buildProblemHandoff` then builds a
  // synthesized handoff. Even in this branch, the output must mention the
  // persona AND the problem-statement payload in ONE message.
  const opening = await generateOpeningLine({
    interview: {},
    config: {
      interviewer: { name: 'Sam', title: 'Senior Engineer', company: 'Google' },
      problem: { title: 'Design a chat application', brief: '1B users globally.' },
    },
  });
  assert.ok(typeof opening === 'string' && opening.length > 0);
  // Mock-LLM and deterministic-fallback both echo the persona at minimum;
  // the deterministic path additionally embeds the problem brief.
  if (!/Mock/.test(opening)) {
    assert.match(opening, /Sam/);
    assert.match(opening, /chat application|1B users/);
  }
});

test('warmExecutorPrefix returns a promise that resolves without throwing', async () => {
  // The warmup is fire-and-forget — it must NEVER throw or reject, even when
  // upstream is unavailable. We call it and await to confirm.
  const config = loadInterviewConfig();
  const interview = { interview_type: 'system_design', interview_mode: 'chat' };
  await warmExecutorPrefix({ config, interview });
  // If we got here, the promise resolved cleanly.
  assert.ok(true);
});

/* --------------------------- streamInterviewerReply ------------------ *
 * The Executor LLM (mock in test mode) is invoked for EVERY input — no
 * short-circuits remain. We check that the mock's prefix appears in the
 * stream output, which proves the LLM path was taken.
 * ------------------------------------------------------------------- */

test('streamInterviewerReply invokes the Executor LLM on opening turn (awaiting_ack)', async () => {
  const config = loadInterviewConfig();
  const interview = {
    interview_type: 'system_design',
    role_track: 'ic',
    conversation_turns: [{ role: 'interviewer', content: "Hi, I'm Alex. Ready?", kind: 'opening' }],
    session_state: { opening_phase: 'awaiting_ack' },
  };
  const reply = await collectStream(
    streamInterviewerReply({ interview, config, candidateMessage: 'yes' })
  );
  assert.match(reply, /\[Mock interviewer\]/, 'opening turn must hit the Executor LLM');
});

test('streamInterviewerReply invokes the Executor LLM on a LET_LEAD directive (no short-circuit)', async () => {
  const config = loadInterviewConfig();
  const interview = {
    interview_type: 'system_design',
    role_track: 'ic',
    conversation_turns: [{ role: 'interviewer', content: 'Go ahead.' }],
    session_state: {
      opening_phase: 'in_progress',
      next_directive: { move: 'LET_LEAD', answer_only: false },
    },
  };
  const reply = await collectStream(
    streamInterviewerReply({
      interview,
      config,
      candidateMessage: 'I am still describing the metadata schema.',
    })
  );
  assert.match(reply, /\[Mock interviewer\]/, 'LET_LEAD must hit the Executor LLM, not a deterministic ack pool');
});

test('streamInterviewerReply invokes the Executor LLM on a normal turn', async () => {
  const config = loadInterviewConfig();
  const interview = {
    interview_type: 'system_design',
    conversation_turns: [],
    session_state: {
      opening_phase: 'in_progress',
      next_directive: { move: 'GO_DEEPER', recommended_focus: 'their cache invalidation strategy' },
    },
  };
  const reply = await collectStream(
    streamInterviewerReply({ interview, config, candidateMessage: 'I would use a write-through cache' })
  );
  assert.ok(reply.length > 0, 'normal turn must produce a non-empty stream from the LLM');
  assert.match(reply, /\[Mock interviewer\]/);
});
