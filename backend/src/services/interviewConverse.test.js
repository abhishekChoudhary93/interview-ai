import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  streamInterviewerReply,
  buildProblemHandoff,
  generateOpeningLine,
} from './interviewConverse.js';
import { loadInterviewConfig } from './interviewConfig.js';

/**
 * v3 (post-refactor): `streamInterviewerReply` is a pure pass-through to the
 * Executor LLM — no short-circuits. The OPENING PROTOCOL section of the
 * Executor's system prompt carries the curated problem statement and tells
 * the LLM how to handle ack-vs-substance on T1.
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

test('generateOpeningLine renders a deterministic intro from config.interviewer + total_minutes', async () => {
  const config = loadInterviewConfig();
  const opening = await generateOpeningLine({
    interview: { interview_type: 'system_design' },
    config,
  });
  assert.match(opening, new RegExp(config.interviewer.name));
  assert.match(opening, new RegExp(config.interviewer.title));
  assert.match(opening, new RegExp(config.interviewer.company));
  assert.match(opening, new RegExp(`${config.total_minutes} minutes`));
  assert.match(opening, /Ready to dive in/i);
  assert.doesNotMatch(opening, /URL [Ss]hortener/);
});

test('generateOpeningLine falls back gracefully when total_minutes is missing', async () => {
  const opening = await generateOpeningLine({
    interview: {},
    config: {
      interviewer: { name: 'Sam', title: 'Senior Engineer', company: 'Google' },
    },
  });
  assert.match(opening, /Sam/);
  assert.match(opening, /Senior Engineer/);
  assert.match(opening, /Google/);
  assert.match(opening, /some time today/);
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
