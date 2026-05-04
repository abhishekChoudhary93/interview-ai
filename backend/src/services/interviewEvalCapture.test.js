import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvalToSessionState,
  buildPrompt,
  focusLooksLikeRubricLeak,
  validateExecutorReply,
  deriveAnswerOnly,
  SCHEMA,
  MOVES,
  DIFFICULTIES,
  MOMENTUMS,
  BAR_TRAJECTORIES,
  TIME_STATUSES,
} from './interviewEvalCapture.js';
import { loadInterviewConfig } from './interviewConfig.js';

/* --------------------------- Test helpers ----------------------------- */

function makeInterview() {
  return {
    interview_type: 'system_design',
    role_track: 'ic',
    target_level: 'SR_SDE',
    session_state: {},
    conversation_turns: [],
    session_started_at: new Date(),
  };
}

function baseCaptured(overrides = {}) {
  return {
    move: 'LET_LEAD',
    difficulty: 'L2',
    recommended_section_focus_id: '',
    recommended_focus: '',
    consumed_probe_id: '',
    probe_observations: [],
    flags: [],
    momentum: 'warm',
    bar_trajectory: 'flat',
    performance_assessment: 'at_target',
    time_status: 'on_track',
    candidate_signal: 'driving',
    interview_done: false,
    notes: '',
    ...overrides,
  };
}

/* --------------------------- Schema shape ---------------------------- */

test('SCHEMA: v4 move catalog (LET_LEAD, ANSWER_AND_RELEASE, 6 probing, PIVOT_ANGLE, 3 down, 3 transition)', () => {
  for (const m of [
    'LET_LEAD', 'ANSWER_AND_RELEASE',
    'GO_DEEPER', 'CHALLENGE_ASSUMPTION', 'CHALLENGE_TRADEOFF', 'DRAW_NUMBERS',
    'INJECT_FAULT', 'RAISE_STAKES',
    'PIVOT_ANGLE', // v4 FIX-1
    'NARROW_SCOPE', 'PROVIDE_ANCHOR', 'SALVAGE_AND_MOVE',
    'HAND_OFF', 'WRAP_TOPIC', 'CLOSE',
  ]) {
    assert.ok(MOVES.includes(m), `expected ${m} in MOVES`);
  }
  // Old v2 moves dropped:
  for (const m of ['PUSH_BACK', 'WHAT_IF', 'CLARIFY_BACK', 'HINT', 'ACK_AND_PROBE', 'STAY']) {
    assert.ok(!MOVES.includes(m), `expected old move ${m} to be dropped`);
  }
});

test('SCHEMA: current_subtopic + consecutive_probes_on_subtopic are present (v4 FIX-1)', () => {
  assert.ok(SCHEMA.properties.current_subtopic, 'current_subtopic must exist');
  assert.equal(SCHEMA.properties.current_subtopic.type, 'string');
  assert.ok(SCHEMA.properties.consecutive_probes_on_subtopic, 'consecutive_probes_on_subtopic must exist');
  assert.equal(SCHEMA.properties.consecutive_probes_on_subtopic.type, 'integer');
});

test('config: every section has an exit_gate.require_any list (v4 FIX-2)', () => {
  const config = loadInterviewConfig();
  for (const sec of config.sections) {
    assert.ok(sec.exit_gate, `section ${sec.id} must have an exit_gate`);
    assert.ok(Array.isArray(sec.exit_gate.require_any) && sec.exit_gate.require_any.length > 0,
      `section ${sec.id}.exit_gate.require_any must be a non-empty array`);
    // Each gate signal id must exist in the section's signals[] list.
    const sectionSignalIds = new Set((sec.signals || []).map((s) => s.id));
    for (const sigId of sec.exit_gate.require_any) {
      assert.ok(sectionSignalIds.has(sigId),
        `exit_gate.require_any[${sigId}] in section ${sec.id} must match a signal id in signals[]`);
    }
  }
});

test('SCHEMA: difficulty / momentum / bar_trajectory / time_status enums', () => {
  assert.deepEqual(DIFFICULTIES, ['L1', 'L2', 'L3']);
  assert.deepEqual(MOMENTUMS, ['hot', 'warm', 'cold']);
  assert.deepEqual(BAR_TRAJECTORIES, ['rising', 'flat', 'falling']);
  assert.deepEqual(TIME_STATUSES, ['on_track', 'behind', 'critical']);
});

test('SCHEMA: required fields include v3 adaptive fields', () => {
  const required = SCHEMA.required;
  for (const f of [
    'move',
    'difficulty',
    'recommended_section_focus_id',
    'recommended_focus',
    'momentum',
    'bar_trajectory',
    'performance_assessment',
    'time_status',
    'candidate_signal',
    'interview_done',
  ]) {
    assert.ok(required.includes(f), `expected ${f} required`);
  }
});

test('SCHEMA: flags is a flat array (no green/red split)', () => {
  assert.equal(SCHEMA.properties.flags.type, 'array');
  assert.deepEqual(SCHEMA.properties.flags.items.required, ['type', 'section_id', 'signal_id', 'note']);
});

test('SCHEMA: probe_observations carry probe + difficulty', () => {
  assert.deepEqual(SCHEMA.properties.probe_observations.items.required, [
    'observation',
    'probe',
    'section_id',
    'difficulty',
  ]);
});

/* --------------------------- deriveAnswerOnly ------------------------ */

test('deriveAnswerOnly: ANSWER_AND_RELEASE → true', () => {
  assert.equal(deriveAnswerOnly(baseCaptured({ move: 'ANSWER_AND_RELEASE' })), true);
});

test('deriveAnswerOnly: any other move → false', () => {
  for (const m of ['LET_LEAD', 'GO_DEEPER', 'HAND_OFF', 'CLOSE']) {
    assert.equal(deriveAnswerOnly(baseCaptured({ move: m })), false);
  }
});

/* --------------------------- Interview completion -------------------- */

/**
 * Seed every section with a green flag so the FIX-4 CLOSE gate sees
 * untouched.length === 0 and allows CLOSE to fire.
 */
function makeFullyCoveredInterview(config) {
  const interview = makeInterview();
  interview.session_state = {
    flags_by_section: Object.fromEntries(
      config.sections.map((s) => [
        s.id,
        [{ type: 'green', signal_id: s.signals?.[0]?.id || 'placeholder', note: 'covered', at_turn: 1 }],
      ])
    ),
  };
  return interview;
}

test('applyEvalToSessionState honors captured.interview_done=true (all sections touched)', () => {
  const config = loadInterviewConfig();
  const interview = makeFullyCoveredInterview(config);

  const r = applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'CLOSE',
      candidate_signal: 'block_complete',
      interview_done: true,
    }),
    { config, candidateMessage: "I think we're done.", candidateTurnIndex: 1 }
  );

  assert.equal(r.interviewDone, true);
  assert.equal(interview.session_state.interview_done, true);
});

test('applyEvalToSessionState honors move=CLOSE as completion (all sections touched)', () => {
  const config = loadInterviewConfig();
  const interview = makeFullyCoveredInterview(config);

  const r = applyEvalToSessionState(
    interview,
    baseCaptured({ move: 'CLOSE', candidate_signal: 'block_complete' }),
    { config, candidateMessage: 'wrap', candidateTurnIndex: 1 }
  );

  assert.equal(r.interviewDone, true);
});

/* --------------------------- FIX-4 CLOSE gate ------------------------ */

test('FIX-4: CLOSE blocked when sections are untouched and time > 3m → downgraded to HAND_OFF', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview(); // all sections untouched, 50m remaining

  const r = applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'CLOSE',
      candidate_signal: 'block_complete',
      interview_done: true,
    }),
    { config, candidateMessage: 'I think we are done.', candidateTurnIndex: 1 }
  );

  assert.equal(r.interviewDone, false, 'CLOSE must be blocked');
  assert.equal(interview.session_state.interview_done, undefined);
  const d = interview.session_state.next_directive;
  assert.equal(d.move, 'HAND_OFF', 'CLOSE must be rewritten to HAND_OFF');
  // Priority order: deep_dive > operations > tradeoffs > high_level_design > requirements.
  // First untouched in priority order should be deep_dive.
  assert.equal(d.recommended_section_focus_id, 'deep_dive');
  const last = interview.session_state.eval_history.slice(-1)[0];
  assert.equal(last.close_blocked_reason, 'untouched_sections_with_time');
});

test('FIX-4: CLOSE allowed when all sections touched even if time remains', () => {
  const config = loadInterviewConfig();
  const interview = makeFullyCoveredInterview(config);

  const r = applyEvalToSessionState(
    interview,
    baseCaptured({ move: 'CLOSE', candidate_signal: 'block_complete', interview_done: true }),
    { config, candidateMessage: 'we are done', candidateTurnIndex: 1 }
  );

  assert.equal(r.interviewDone, true);
  const last = interview.session_state.eval_history.slice(-1)[0];
  assert.equal(last.close_blocked_reason, null);
});

test('FIX-4: CLOSE allowed when wall clock has < 3 minutes left even if some untouched', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  // Backdate session start so only ~2 minutes remain in a 50-minute interview.
  interview.session_started_at = new Date(Date.now() - (config.total_minutes - 2) * 60_000);

  const r = applyEvalToSessionState(
    interview,
    baseCaptured({ move: 'CLOSE', candidate_signal: 'block_complete', interview_done: true }),
    { config, candidateMessage: 'time up', candidateTurnIndex: 1 }
  );

  assert.equal(r.interviewDone, true);
});

/* --------------------------- Section_id routing ---------------------- */

test('green flag with section_id routes to flags_by_section[that_id]', () => {
  const config = loadInterviewConfig();
  const targetSectionId = config.sections[2].id;

  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      recommended_section_focus_id: config.sections[0].id,
      flags: [
        {
          type: 'green',
          section_id: targetSectionId,
          signal_id: 'id_strategy',
          note: 'unprompted: snowflake-style allocator with rationale',
        },
      ],
    }),
    { config, candidateMessage: 'lots of stuff', candidateTurnIndex: 1 }
  );

  const flags = interview.session_state.flags_by_section?.[targetSectionId];
  assert.ok(flags && flags.length === 1, 'flag should land in tagged section');
  assert.equal(flags[0].type, 'green');
  assert.equal(flags[0].signal_id, 'id_strategy');
});

test('flag without section_id falls back to recommended_section_focus_id', () => {
  const config = loadInterviewConfig();
  const focusId = config.sections[1].id;

  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      recommended_section_focus_id: focusId,
      flags: [
        { type: 'green', section_id: '', signal_id: 'storage_justification', note: 'fallback' },
      ],
    }),
    { config, candidateMessage: 'driving', candidateTurnIndex: 1 }
  );

  const flags = interview.session_state.flags_by_section?.[focusId];
  assert.ok(flags && flags.length === 1, 'flag should fall back to recommended_section_focus_id');
  assert.equal(flags[0].signal_id, 'storage_justification');
});

test('probe_observation with section_id routes to probe_queue[that_id]', () => {
  const config = loadInterviewConfig();
  const targetSectionId = config.sections[2].id;

  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      recommended_section_focus_id: config.sections[0].id,
      probe_observations: [
        {
          observation: 'first-write-wins for slug collision',
          probe: 'How does first-write-wins behave under concurrent custom slug requests?',
          section_id: targetSectionId,
          difficulty: 'L2',
        },
      ],
    }),
    { config, candidateMessage: 'I will use first-write-wins.', candidateTurnIndex: 3 }
  );

  const queue = interview.session_state.probe_queue?.[targetSectionId];
  assert.ok(queue && queue.length === 1);
  assert.match(queue[0].observation, /first-write-wins/);
  assert.match(queue[0].probe, /How does first-write-wins/);
  assert.equal(queue[0].difficulty, 'L2');
  assert.equal(queue[0].consumed, false);
});

/* --------------------------- Probe queue lifecycle ------------------- */

test('consuming a probe mirrors `probe` (not observation) into focus', () => {
  const config = loadInterviewConfig();
  const otherSectionId = config.sections[2].id;
  const interview = makeInterview();
  interview.session_state = {
    probe_queue: {
      [otherSectionId]: [
        {
          id: 'pq_2_0',
          observation: 'they used first-write-wins for custom slug collision',
          probe: 'What happens to second writer on collision?',
          difficulty: 'L2',
          added_at_turn: 2,
          consumed: false,
          consumed_at_turn: null,
        },
      ],
    },
    last_turn_ts: Date.now(),
  };

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'HAND_OFF',
      recommended_focus: '',
      recommended_section_focus_id: otherSectionId,
      candidate_signal: 'block_complete',
      consumed_probe_id: 'pq_2_0',
    }),
    { config, candidateMessage: "I'm good with these.", candidateTurnIndex: 3 }
  );

  const item = interview.session_state.probe_queue[otherSectionId][0];
  assert.equal(item.consumed, true);
  assert.equal(item.consumed_at_turn, 3);
  assert.match(
    interview.session_state.next_directive.recommended_focus,
    /What happens to second writer/
  );
});

test('invalid consumed_probe_id is a no-op', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'HAND_OFF',
      recommended_focus: 'a generic focus',
      recommended_section_focus_id: config.sections[0].id,
      candidate_signal: 'block_complete',
      consumed_probe_id: 'pq_999_0',
    }),
    { config, candidateMessage: 'ok', candidateTurnIndex: 3 }
  );

  assert.equal(
    interview.session_state.next_directive.recommended_focus,
    'a generic focus'
  );
});

/* --------------------------- Section time tracking ------------------- */

test('section_minutes_used accumulates against the PRIOR focus section', async () => {
  const config = loadInterviewConfig();
  const focusA = config.sections[0].id;
  const focusB = config.sections[1].id;
  const interview = makeInterview();
  // Seed with prior directive on focusA and last_turn_ts in the past.
  interview.session_state = {
    next_directive: { recommended_section_focus_id: focusA },
    last_turn_ts: Date.now() - 90_000, // 1.5 minutes ago
  };

  // This turn the Planner moves to focusB. Time delta should land on focusA.
  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'HAND_OFF',
      recommended_section_focus_id: focusB,
    }),
    { config, candidateMessage: 'transitioning', candidateTurnIndex: 1 }
  );

  const sectionMinutesUsed = interview.session_state.section_minutes_used || {};
  assert.ok(sectionMinutesUsed[focusA] >= 1.4 && sectionMinutesUsed[focusA] <= 1.6,
    `expected ~1.5m for focusA, got ${sectionMinutesUsed[focusA]}`);
  assert.equal(sectionMinutesUsed[focusB], undefined);
});

/* --------------------------- Performance routing --------------------- */

test('performance_by_section is updated for substantive turns only', () => {
  const config = loadInterviewConfig();
  const focusId = config.sections[1].id;
  const interview = makeInterview();

  applyEvalToSessionState(
    interview,
    baseCaptured({
      recommended_section_focus_id: focusId,
      performance_assessment: 'above_target',
    }),
    { config, candidateMessage: 'good content', candidateTurnIndex: 1 }
  );

  assert.equal(interview.session_state.performance_by_section[focusId], 'above_target');

  applyEvalToSessionState(
    interview,
    baseCaptured({
      recommended_section_focus_id: focusId,
      performance_assessment: 'unclear',
    }),
    { config, candidateMessage: 'ok', candidateTurnIndex: 2 }
  );

  // Unclear should NOT overwrite the above_target signal.
  assert.equal(interview.session_state.performance_by_section[focusId], 'above_target');
});

/* --------------------------- next_directive persistence -------------- */

test('next_directive carries v3 fields including momentum / difficulty / time_status', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const focusId = config.sections[0].id;

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'GO_DEEPER',
      difficulty: 'L3',
      recommended_focus: 'walk me through the slug collision math',
      recommended_section_focus_id: focusId,
      momentum: 'hot',
      bar_trajectory: 'rising',
      time_status: 'on_track',
      candidate_signal: 'driving',
    }),
    { config, candidateMessage: 'lots of design content', candidateTurnIndex: 1 }
  );

  const d = interview.session_state.next_directive;
  assert.ok(d);
  assert.equal(d.move, 'GO_DEEPER');
  assert.equal(d.difficulty, 'L3');
  assert.equal(d.momentum, 'hot');
  assert.equal(d.bar_trajectory, 'rising');
  assert.equal(d.time_status, 'on_track');
  assert.equal(d.recommended_section_focus_id, focusId);
  assert.equal(d.answer_only, false);
});

test('next_directive persists current_subtopic + consecutive_probes_on_subtopic (FIX-1)', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'GO_DEEPER',
      recommended_section_focus_id: config.sections[2].id,
      current_subtopic: 'shard key selection',
      consecutive_probes_on_subtopic: 2,
    }),
    { config, candidateMessage: 'I would shard by hash', candidateTurnIndex: 1 }
  );

  const d = interview.session_state.next_directive;
  assert.equal(d.current_subtopic, 'shard key selection');
  assert.equal(d.consecutive_probes_on_subtopic, 2);

  const last = interview.session_state.eval_history.slice(-1)[0];
  assert.equal(last.current_subtopic, 'shard key selection');
  assert.equal(last.consecutive_probes_on_subtopic, 2);
});

test('answer_only is true when move=ANSWER_AND_RELEASE', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'ANSWER_AND_RELEASE',
      recommended_section_focus_id: config.sections[0].id,
      candidate_signal: 'asked_question',
    }),
    { config, candidateMessage: 'are detailed click analytics in scope?', candidateTurnIndex: 1 }
  );

  assert.equal(interview.session_state.next_directive.answer_only, true);
});

/* --------------------------- Leak guard ------------------------------ */

test('focusLooksLikeRubricLeak flags focus that paraphrases a section good_signal', () => {
  const rubric = ['Identifies p99 redirect latency as the dominant SLO unprompted'];
  const focus = 'establishes p99 redirect latency as the dominant SLO target';
  const m = focusLooksLikeRubricLeak(focus, rubric);
  assert.ok(m, 'leaky focus should be flagged');
});

test('focusLooksLikeRubricLeak does NOT flag candidate-anchored focuses', () => {
  const rubric = ['Identifies p99 redirect latency as the dominant SLO unprompted'];
  const focus = 'they sketched an API gateway with no arrows';
  assert.equal(focusLooksLikeRubricLeak(focus, rubric), null);
});

test('applyEvalToSessionState BLANKS the focus when leak guard fires (move untouched)', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  // Pull the actual rubric string from the config for a real test.
  const goodSignal = config.sections[0].good_signals[1]; // p99 redirect SLO

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'HAND_OFF',
      recommended_focus: goodSignal,
      recommended_section_focus_id: config.sections[0].id,
    }),
    { config, candidateMessage: 'lots of stuff', candidateTurnIndex: 1 }
  );

  assert.equal(interview.session_state.next_directive.move, 'HAND_OFF');
  assert.equal(interview.session_state.next_directive.recommended_focus, '');
});

test('applyEvalToSessionState leaves a candidate-anchored focus untouched', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'HAND_OFF',
      recommended_focus: 'they sketched an API gateway with no arrows',
      recommended_section_focus_id: config.sections[0].id,
    }),
    { config, candidateMessage: 'lots of stuff', candidateTurnIndex: 1 }
  );

  assert.equal(
    interview.session_state.next_directive.recommended_focus,
    'they sketched an API gateway with no arrows'
  );
});

/* --------------------------- Validator ------------------------------- */

test('validateExecutorReply: clean LET_LEAD reply produces no flags', () => {
  const r = validateExecutorReply({
    reply: 'Mhm.',
    derivedMove: 'LET_LEAD',
    candidateMessage: 'I am working through requirements.',
  });
  assert.deepEqual(r.flags, []);
});

test('validateExecutorReply: WRAP_TOPIC reply with ? gets executor_wrap_with_probe', () => {
  const r = validateExecutorReply({
    reply: 'Let us bookmark and move on. What do you want to focus on next?',
    derivedMove: 'WRAP_TOPIC',
    candidateMessage: 'still talking',
  });
  assert.ok(r.flags.some((f) => /executor_wrap_with_probe/.test(f)));
});

test('validateExecutorReply: HAND_OFF reply with 2+ ? gets executor_handoff_multi_probe', () => {
  const r = validateExecutorReply({
    reply: 'Anything else? What about caching?',
    derivedMove: 'HAND_OFF',
    candidateMessage: "I'm good",
  });
  assert.ok(r.flags.some((f) => /executor_handoff_multi_probe/.test(f)));
});

test('validateExecutorReply: 8+ word verbatim echo is flagged', () => {
  const r = validateExecutorReply({
    reply:
      "So your service looks up the original URL in the database and responds with a 302. How do you ensure performance?",
    derivedMove: 'HAND_OFF',
    candidateMessage:
      'My service looks up the original URL in the database and responds with a 302 redirect.',
  });
  assert.ok(r.flags.some((f) => /executor_echoing/.test(f)));
});

/* --------------------------- buildPrompt structure ------------------- */

test('buildPrompt renders v3 INTERVIEW CONFIG block with problem + scope + scale_facts', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /=== INTERVIEW CONFIG ===/);
  assert.match(prompt, /URL Shortener/);
  assert.match(prompt, /scale_facts/);
  assert.match(prompt, /fault_scenarios/);
  assert.match(prompt, /raise_stakes_prompts/);
});

test('buildPrompt renders RUNTIME STATE with WALL CLOCK, SECTION BUDGETS, MOMENTUM, BAR TRAJECTORY', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /=== RUNTIME STATE ===/);
  assert.match(prompt, /WALL CLOCK/);
  assert.match(prompt, /SECTION BUDGETS:/);
  assert.match(prompt, /MOMENTUM/);
  assert.match(prompt, /BAR TRAJECTORY/);
});

test('buildPrompt SECTION BUDGETS bucketing: on_track / behind / critical', () => {
  const config = loadInterviewConfig();
  const reqId = config.sections[0].id;
  const reqBudget = config.sections[0].budget_minutes;
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {
      section_minutes_used: {
        [reqId]: reqBudget * 0.3, // on_track
        [config.sections[1].id]: config.sections[1].budget_minutes * 0.85, // behind
        [config.sections[2].id]: config.sections[2].budget_minutes * 1.2, // critical
      },
    },
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /on_track/);
  assert.match(prompt, /behind/);
  assert.match(prompt, /critical/);
});

test('buildPrompt renders 13-move catalog and difficulty levels', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /MOVE CATALOG/);
  for (const move of MOVES) {
    assert.match(prompt, new RegExp(move), `expected ${move} in MOVE CATALOG`);
  }
  assert.match(prompt, /DIFFICULTY LEVELS/);
  assert.match(prompt, /L1 — Baseline/);
  assert.match(prompt, /L3 — Staff/);
});

test('buildPrompt renders ADAPTIVE DIFFICULTY SYSTEM with momentum table', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /ADAPTIVE DIFFICULTY SYSTEM/);
  assert.match(prompt, /MOMENTUM CALCULATION/);
  assert.match(prompt, /MOMENTUM → INTERVIEW SHAPE/);
});

test('buildPrompt renders v4 RUNTIME STATE additions: CURRENT SUBTOPIC, EXIT GATES, SECTIONS UNTOUCHED', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /CURRENT SUBTOPIC:/);
  assert.match(prompt, /CONSECUTIVE PROBES ON IT:/);
  assert.match(prompt, /HARD CAP 3/);
  assert.match(prompt, /SECTION EXIT GATES/);
  assert.match(prompt, /SECTIONS UNTOUCHED/);
});

test('buildPrompt CURRENT SUBTOPIC reflects prior next_directive values (FIX-1)', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {
      next_directive: {
        recommended_section_focus_id: config.sections[2].id,
        current_subtopic: 'consistent hashing rebalancing',
        consecutive_probes_on_subtopic: 3,
      },
    },
    candidateMessage: 'still on caching',
    interviewerReply: 'okay',
  });
  assert.match(prompt, /CURRENT SUBTOPIC:\s+consistent hashing rebalancing/);
  assert.match(prompt, /CONSECUTIVE PROBES ON IT:\s+3/);
});

test('buildPrompt SECTION EXIT GATES marks passed/NOT_PASSED based on flags_by_section greens', () => {
  const config = loadInterviewConfig();
  // Drop a green for one of the requirements gate signals.
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {
      flags_by_section: {
        requirements: [
          { type: 'green', signal_id: 'estimation', note: 'quantified', at_turn: 2 },
        ],
      },
    },
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /requirements: gate=\[estimation, nfr_awareness, read_write_ratio\] — passed/);
  assert.match(prompt, /high_level_design: gate=\[read_write_separation, caching_placement\] — NOT_PASSED/);
});

test('buildPrompt SECTIONS UNTOUCHED lists sections with no flags / probes / eval_history', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {
      flags_by_section: { requirements: [{ type: 'green', signal_id: 'estimation', note: 'q', at_turn: 1 }] },
    },
    candidateMessage: 'hi',
    interviewerReply: 'opening',
  });
  // requirements is touched; everything else is untouched.
  assert.match(prompt, /SECTIONS UNTOUCHED.*\[high_level_design, deep_dive, tradeoffs, operations\]/);
});

test('buildPrompt renders the v4 policy blocks (THREAD DEPTH / EXIT GATES / SCALE-FACT / CLOSE GATE / I-DON\'T-KNOW)', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hi',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /THREAD DEPTH RULE \(FIX-1\)/);
  assert.match(prompt, /EXIT GATES \(FIX-2\)/);
  assert.match(prompt, /SCALE-FACT INJECTION CHECK \(FIX-3\)/);
  assert.match(prompt, /CLOSE GATE \(FIX-4\)/);
  assert.match(prompt, /"I DON'T KNOW" HANDLING \(FIX-5\)/);
  // Priority order for untouched-section redirect must be present.
  assert.match(prompt, /deep_dive > operations > tradeoffs > high_level_design > requirements/);
});

test('buildPrompt SIGNAL_CLASSIFICATION maps stuck → PIVOT_ANGLE / SALVAGE_AND_MOVE (v4 FIX-5)', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hi',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /stuck\s+— Repeating, circling, "I don't know"/);
  assert.match(prompt, /PIVOT_ANGLE if section has other unprobed angles, else SALVAGE_AND_MOVE/);
  assert.match(prompt, /META-QUESTIONS about the interview itself/);
});

test('buildPrompt HARD_PROHIBITIONS forbids early CLOSE, same-subtopic probe after stuck, and >3 same-subtopic probes', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hi',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /Issue CLOSE \/ interview_done=true when untouched sections remain/);
  assert.match(prompt, /Follow candidate "I don't know" \/ stuck with another probe on the SAME/);
  assert.match(prompt, /Probe the same subtopic more than 3 consecutive times/);
  assert.match(prompt, /Issue CLOSE on a meta-question/);
});

test('buildPrompt renders TIME MANAGEMENT, BAR TRAJECTORY, DECISION ALGORITHM, HARD PROHIBITIONS', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /TIME MANAGEMENT SYSTEM/);
  assert.match(prompt, /BAR TRAJECTORY SYSTEM/);
  assert.match(prompt, /DECISION ALGORITHM/);
  assert.match(prompt, /HARD PROHIBITIONS/);
});

test('buildPrompt carries the HAND_OFF GUARD subsection in DECISION ALGORITHM (extended for v4 FIX-1/FIX-2)', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /HAND_OFF GUARD/);
  assert.match(prompt, /HAND_OFF fires ONLY if EXIT GATE passes/);
  assert.match(prompt, /candidate_signal == block_complete/);
  assert.match(prompt, /section time_status == critical/);
  // FIX-1 thread depth as 4th trigger.
  assert.match(prompt, /consecutive_probes_on_subtopic >= 3/);
  // The within-section fallback is documented.
  assert.match(prompt, /within-section move only/);
});

test('buildPrompt carries the transition-phrase prohibition in HARD PROHIBITIONS', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /Contain a section-transition phrase such as "walk me through \.\.\."/);
  assert.match(prompt, /UNLESS move ∈ \{HAND_OFF, WRAP_TOPIC\}/);
});

test('buildPrompt tightens the asked_question → ANSWER_AND_RELEASE row with bundling/transition guards', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  // The row must specify exactly ONE fact, ONE dimension, and forbid transition phrases.
  assert.match(prompt, /asked_question\s+→ ANSWER_AND_RELEASE/);
  assert.match(prompt, /recommended_focus = exactly ONE fact/);
  assert.match(prompt, /Never bundle\s+multiple scope dims/);
  assert.match(prompt, /Never append a\s+transition phrase/);
});

test('buildPrompt renders FOCUS RUBRIC for the focus section only', () => {
  const config = loadInterviewConfig();
  const focusId = config.sections[1].id;
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: { next_directive: { recommended_section_focus_id: focusId } },
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, new RegExp(`FOCUS RUBRIC for "${focusId}"`));
  // Other section ids should NOT have their own FOCUS RUBRIC blocks.
  for (const sec of config.sections) {
    if (sec.id !== focusId) {
      assert.doesNotMatch(prompt, new RegExp(`FOCUS RUBRIC for "${sec.id}"`));
    }
  }
});

test('buildPrompt PROBE QUEUE renders items with section / difficulty / probe text', () => {
  const config = loadInterviewConfig();
  const sectionId = config.sections[0].id;
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {
      probe_queue: {
        [sectionId]: [
          {
            id: 'pq_2_0',
            observation: 'first-write-wins',
            probe: 'What happens on second writer for the same custom slug?',
            difficulty: 'L3',
            added_at_turn: 2,
            consumed: false,
          },
        ],
      },
    },
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /PROBE QUEUE/);
  assert.match(prompt, /pq_2_0/);
  assert.match(prompt, /difficulty=L3/);
  assert.match(prompt, /What happens on second writer/);
});

test('buildPrompt ACTIVE FLAGS renders green/red flags with signal_id and section_id', () => {
  const config = loadInterviewConfig();
  const sectionId = config.sections[1].id;
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {
      flags_by_section: {
        [sectionId]: [
          { type: 'green', signal_id: 'caching_placement', note: 'CDN edge cache unprompted', at_turn: 3 },
          { type: 'red', signal_id: 'storage_justification', note: 'no rationale', at_turn: 5 },
        ],
      },
    },
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  assert.match(prompt, /ACTIVE FLAGS/);
  assert.match(prompt, new RegExp(`GREEN \\[${sectionId}\\] caching_placement`));
  assert.match(prompt, new RegExp(`RED \\[${sectionId}\\] storage_justification`));
});

test('buildPrompt renders v3 PERSONA-FREE blocks (no rubric_updates / coverage_evidence vocabulary)', () => {
  const config = loadInterviewConfig();
  const prompt = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'hello',
    interviewerReply: 'opening',
  });
  // v2 fields should not appear in v3 prompt.
  assert.doesNotMatch(prompt, /rubric_updates/);
  assert.doesNotMatch(prompt, /coverage_evidence/);
  assert.doesNotMatch(prompt, /signals\.\{strong/);
});

/* --------------------------- Audit trail ----------------------------- */

test('eval_history captures move + difficulty + momentum + bar_trajectory + time_status', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();

  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'GO_DEEPER',
      difficulty: 'L3',
      momentum: 'hot',
      bar_trajectory: 'rising',
      time_status: 'behind',
      recommended_section_focus_id: config.sections[2].id,
      performance_assessment: 'above_target',
      candidate_signal: 'driving',
    }),
    { config, candidateMessage: 'deep dive content', candidateTurnIndex: 5 }
  );

  const last = interview.session_state.eval_history.slice(-1)[0];
  assert.equal(last.move, 'GO_DEEPER');
  assert.equal(last.difficulty, 'L3');
  assert.equal(last.momentum, 'hot');
  assert.equal(last.bar_trajectory, 'rising');
  assert.equal(last.time_status, 'behind');
  assert.equal(last.performance_assessment, 'above_target');
  assert.equal(last.recommended_section_focus_id, config.sections[2].id);
});
