import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvalToSessionState,
  buildPrompt,
  deriveAnswerOnly,
  listUntouchedSections,
  pickPriorityUntouchedSection,
  SCHEMA,
  MOVES,
  DIFFICULTIES,
  MOMENTUMS,
  BAR_TRAJECTORIES,
  TIME_STATUSES,
  RESPONSE_PACES,
  VERDICT_TRAJECTORIES,
  PROBE_TYPES,
  CANDIDATE_SIGNALS,
  UNTOUCHED_PRIORITY,
} from './interviewEvalCapture.js';
import { loadInterviewConfig } from './interviewConfig.js';

/* --------------------------- Test helpers ----------------------------- */

function makeInterview(overrides = {}) {
  return {
    interview_type: 'system_design',
    role_track: 'ic',
    target_level: 'SR_SDE',
    session_state: {},
    conversation_turns: [],
    session_started_at: new Date(),
    markModified: () => {},
    ...overrides,
  };
}

function baseCaptured(overrides = {}) {
  return {
    move: 'LET_LEAD',
    difficulty: 'L2',
    recommended_section_focus_id: '',
    recommended_focus: '',
    consumed_probe_id: '',
    current_subtopic: '',
    consecutive_probes_on_subtopic: 0,
    requirements_contract: null,
    breadth_coverage: { components_mentioned: [], components_missing: [] },
    response_pace: 'normal',
    pace_turns_tracked: 0,
    probe_observations: [],
    flags: [],
    momentum: 'warm',
    bar_trajectory: 'flat',
    performance_assessment: 'at_target',
    verdict_trajectory: 'insufficient_data',
    time_status: 'on_track',
    candidate_signal: 'driving',
    interview_done: false,
    notes: '',
    ...overrides,
  };
}

/* --------------------------- Schema shape ---------------------------- */

test('MOVES enum: v5 catalog (17 moves) — listening/probing/lateral/down/transition', () => {
  for (const m of [
    'LET_LEAD', 'ANSWER_AND_RELEASE',
    'GO_DEEPER', 'CHALLENGE_ASSUMPTION', 'CHALLENGE_TRADEOFF', 'DRAW_NUMBERS',
    'INJECT_FAULT', 'RAISE_STAKES', 'INJECT_VARIANT',
    'NUDGE_BREADTH', 'PIVOT_ANGLE',
    'NARROW_SCOPE', 'PROVIDE_ANCHOR', 'SALVAGE_AND_MOVE',
    'HAND_OFF', 'WRAP_TOPIC', 'CLOSE',
  ]) {
    assert.ok(MOVES.includes(m), `expected ${m} in MOVES`);
  }
  // Old v2 moves removed.
  for (const m of ['PUSH_BACK', 'WHAT_IF', 'CLARIFY_BACK', 'HINT', 'ACK_AND_PROBE', 'STAY']) {
    assert.ok(!MOVES.includes(m), `expected old move ${m} to be dropped`);
  }
});

test('SCHEMA: v5 NEW fields — requirements_contract / breadth_coverage / response_pace / verdict_trajectory', () => {
  assert.ok(SCHEMA.properties.requirements_contract, 'requirements_contract must exist');
  assert.equal(SCHEMA.properties.requirements_contract.type, 'object');
  for (const f of ['locked', 'functional', 'non_functional', 'in_scope', 'out_of_scope', 'locked_at_turn']) {
    assert.ok(
      SCHEMA.properties.requirements_contract.properties?.[f],
      `requirements_contract.${f} must exist`
    );
  }

  assert.ok(SCHEMA.properties.breadth_coverage, 'breadth_coverage must exist');
  for (const f of ['components_mentioned', 'components_missing']) {
    assert.ok(
      SCHEMA.properties.breadth_coverage.properties?.[f],
      `breadth_coverage.${f} must exist`
    );
  }

  assert.ok(SCHEMA.properties.response_pace, 'response_pace must exist');
  assert.deepEqual(SCHEMA.properties.response_pace.enum, RESPONSE_PACES);
  assert.ok(SCHEMA.properties.pace_turns_tracked, 'pace_turns_tracked must exist');
  assert.equal(SCHEMA.properties.pace_turns_tracked.type, 'integer');

  assert.ok(SCHEMA.properties.verdict_trajectory, 'verdict_trajectory must exist');
  assert.deepEqual(SCHEMA.properties.verdict_trajectory.enum, VERDICT_TRAJECTORIES);
});

test('SCHEMA: probe_observations carries id and probe_type (v5 NEW)', () => {
  const probeProps = SCHEMA.properties.probe_observations.items.properties;
  assert.ok(probeProps.id, 'probe_observations[].id must exist');
  assert.ok(probeProps.probe_type, 'probe_observations[].probe_type must exist');
  assert.deepEqual(probeProps.probe_type.enum, PROBE_TYPES);
});

test('SCHEMA: current_subtopic + consecutive_probes_on_subtopic still present', () => {
  assert.ok(SCHEMA.properties.current_subtopic, 'current_subtopic must exist');
  assert.equal(SCHEMA.properties.current_subtopic.type, 'string');
  assert.ok(SCHEMA.properties.consecutive_probes_on_subtopic, 'counter must exist');
  assert.equal(SCHEMA.properties.consecutive_probes_on_subtopic.type, 'integer');
});

test('SCHEMA: enums', () => {
  assert.deepEqual(DIFFICULTIES, ['L1', 'L2', 'L3']);
  assert.deepEqual(MOMENTUMS, ['hot', 'warm', 'cold']);
  assert.deepEqual(BAR_TRAJECTORIES, ['rising', 'flat', 'falling']);
  assert.deepEqual(TIME_STATUSES, ['on_track', 'behind', 'critical']);
  assert.deepEqual(VERDICT_TRAJECTORIES, ['strong_hire', 'hire', 'no_hire', 'strong_no_hire', 'insufficient_data']);
  assert.deepEqual(RESPONSE_PACES, ['fast', 'normal', 'slow', 'suspiciously_fast']);
  assert.deepEqual(PROBE_TYPES, ['breadth', 'depth']);
});

test('SCHEMA: candidate_signal enum includes v5 NEW values (missing_breadth, rabbit_holing)', () => {
  assert.ok(CANDIDATE_SIGNALS.includes('missing_breadth'), 'missing_breadth must exist');
  assert.ok(CANDIDATE_SIGNALS.includes('rabbit_holing'), 'rabbit_holing must exist');
});

test('SCHEMA: required fields include verdict_trajectory + candidate_signal', () => {
  const required = SCHEMA.required;
  assert.ok(required.includes('verdict_trajectory'));
  assert.ok(required.includes('candidate_signal'));
  assert.ok(required.includes('move'));
  assert.ok(required.includes('difficulty'));
  assert.ok(required.includes('momentum'));
});

/* --------------------------- Config gates ---------------------------- */

test('config: v5 shape — 4 sections, no tradeoffs', () => {
  const config = loadInterviewConfig();
  const ids = config.sections.map((s) => s.id);
  assert.deepEqual(ids, ['requirements', 'high_level_design', 'deep_dive', 'operations']);
  assert.ok(!ids.includes('tradeoffs'), 'tradeoffs section must be dropped in v5');
});

test('config: required_breadth_components is a non-empty array (v5 NEW)', () => {
  const config = loadInterviewConfig();
  assert.ok(Array.isArray(config.required_breadth_components));
  assert.ok(config.required_breadth_components.length > 0);
});

test('config: variant_scenarios is a non-empty array (v5 NEW)', () => {
  const config = loadInterviewConfig();
  assert.ok(Array.isArray(config.variant_scenarios));
  assert.ok(config.variant_scenarios.length > 0);
});

test('config: deep_dive section carries deep_dive_topics (v5 NEW)', () => {
  const config = loadInterviewConfig();
  const dd = config.sections.find((s) => s.id === 'deep_dive');
  assert.ok(dd, 'deep_dive section must exist');
  assert.ok(Array.isArray(dd.deep_dive_topics));
  assert.ok(dd.deep_dive_topics.length > 0);
  for (const t of dd.deep_dive_topics) {
    assert.ok(t.id && t.label && t.description && t.what_good_looks_like, `deep_dive_topic ${t.id || '?'} missing fields`);
  }
});

test('config: every section has an exit_gate.require_any list with valid signal ids', () => {
  const config = loadInterviewConfig();
  for (const sec of config.sections) {
    assert.ok(sec.exit_gate, `section ${sec.id} must have an exit_gate`);
    assert.ok(Array.isArray(sec.exit_gate.require_any) && sec.exit_gate.require_any.length > 0);
    const sectionSignalIds = new Set((sec.signals || []).map((s) => s.id));
    for (const sigId of sec.exit_gate.require_any) {
      assert.ok(sectionSignalIds.has(sigId),
        `exit_gate.require_any[${sigId}] in section ${sec.id} must match a signal id in signals[]`);
    }
  }
});

/* --------------------------- buildPrompt smoke tests ---------------- */

test('buildPrompt renders v5 hard-rules / phases / pace / breadth / 45-min sections', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: 'How many users?',
    interviewerReply: '',
  });

  // Phases.
  assert.match(prompt, /Phase 0 — Introduction/);
  assert.match(prompt, /Phase 1 — Requirements/);
  assert.match(prompt, /Phase 2 — High Level Design/);
  assert.match(prompt, /Phase 3 — Deep Dive/);
  assert.match(prompt, /Phase 4 — Wrap/);

  // 45-min rule.
  assert.match(prompt, /Never wrap before 45 minutes/);
  assert.match(prompt, /CLOSE is ONLY valid when wall clock >= 45 minutes/);
  assert.match(prompt, /45-MIN GATE:\s*open/);

  // Requirements Contract.
  assert.match(prompt, /Requirements Contract/);
  assert.match(prompt, /immutable for the session/);

  // Breadth.
  assert.match(prompt, /BREADTH COVERAGE:/);
  assert.match(prompt, /breadth_coverage/);
  assert.match(prompt, /Breadth vs\. Depth Discipline/);

  // Pace.
  assert.match(prompt, /Response Pace Calibration/);
  assert.match(prompt, /response_pace/);

  // Verdict framework.
  assert.match(prompt, /Verdict Framework/);
  assert.match(prompt, /VERDICT TRAJECTORY:/);

  // Move catalog with v5 new moves.
  assert.match(prompt, /NUDGE_BREADTH/);
  assert.match(prompt, /INJECT_VARIANT/);
});

test('buildPrompt INTERVIEW CONFIG block includes required_breadth_components and variant_scenarios', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  assert.match(prompt, /required_breadth_components/);
  assert.match(prompt, /variant_scenarios/);
});

/* --------------------------- v5.1 hardened Planner rules ------------ */

test('buildPrompt: STEP 6 — EARN BEFORE NAME (config-vocabulary) replaces SCALE FACT INJECTION CHECK', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  // Renamed header.
  assert.match(prompt, /STEP 6 — EARN BEFORE NAME/);
  // Old narrow heading must be gone.
  assert.doesNotMatch(prompt, /STEP 6 — CHECK SCALE FACT INJECTION/);
  // Engage-freely framing — proves the rule is positively framed.
  assert.match(prompt, /Once a topic is earned, push hard|the whole point of the interview/);
});

test('buildPrompt: STEP 6 covers all config categories with non-scale BAD examples', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  // Backwards-compat: scale BAD still present.
  assert.match(prompt, /How do you handle 500k redirects\/sec\?/);
  // Non-scale BAD examples — proves the generalization landed.
  assert.match(prompt, /How does your caching layer handle TTL\?/);
  assert.match(prompt, /Walk me through your read_write_separation/);
  assert.match(prompt, /Let's talk about your consistent hashing approach/);
  assert.match(prompt, /How do first-write-wins collisions work/);
});

test('buildPrompt: STEP 6 includes once-earned GOOD examples (engage-freely half)', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  // Once-earned: candidate raised something → fair-game push is shown concretely.
  assert.match(prompt, /Once-earned/);
  assert.match(prompt, /Redis cache/);
  assert.match(prompt, /partition by hash/);
});

test('buildPrompt: STEP 7 — ONE MOVE PER DIRECTIVE with bundled-focus BAD examples', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  assert.match(prompt, /STEP 7 — ONE MOVE PER DIRECTIVE/);
  // Bundled-focus BAD example — `and` joining two verbs.
  assert.match(prompt, /Confirm scope and ask about read load/);
  // Smell-test enumeration.
  assert.match(prompt, /Smells of bundling in recommended_focus/);
  // Escape hatch — queue the other move in `notes`.
  assert.match(prompt, /queue the other in `notes` for a future turn/);
});

test('buildPrompt: HARD_RULES_SUMMARY carries Earn-before-name + One move per turn + candidate-facing sub-blocks', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  // New sub-block headings.
  assert.match(prompt, /Earn-before-name \(config vocabulary\):/);
  assert.match(prompt, /One move per turn:/);
  assert.match(prompt, /recommended_focus is candidate-facing:/);
  // Engage-freely framing in the summary too.
  assert.match(prompt, /push HARD on it — that's the interview/);
  // The old narrow heading is gone.
  assert.doesNotMatch(prompt, /^Scale facts:$/m);
  // `notes` is Planner-only field reminder.
  assert.match(prompt, /`notes` is NEVER shown to the candidate/);
});

test('buildPrompt: subsequent STEP numbers shifted to make room for new STEP 7', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  // STEP 8 is now COMPUTE MOMENTUM (was STEP 7), STEP 9 SELECT MOVE, etc.
  assert.match(prompt, /STEP 8 — COMPUTE MOMENTUM/);
  assert.match(prompt, /STEP 9 — SELECT MOVE/);
  assert.match(prompt, /STEP 10 — CLOSE GATE/);
  assert.match(prompt, /STEP 11 — WRITE recommended_focus/);
  assert.match(prompt, /STEP 12 — UPDATE VERDICT/);
  // STEP 11 cross-references the new STEP 6 + STEP 7 rules.
  assert.match(prompt, /Apply STEP 6 \(earn-before-name\) and STEP 7 \(one-move-per-directive\)/);
});

test('buildPrompt requirements contract block reflects substrate state', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const sessionState = {
    requirements_contract: {
      locked: true,
      functional: ['shorten URLs', 'redirect on hit'],
      non_functional: ['p99 < 50ms redirect'],
      in_scope: ['custom slugs'],
      out_of_scope: ['user accounts'],
      locked_at_turn: 5,
    },
  };
  const prompt = buildPrompt({
    config,
    interview,
    sessionState,
    candidateMessage: '',
    interviewerReply: '',
  });
  assert.match(prompt, /Locked: true \(at turn 5\) — IMMUTABLE for the rest of the session/);
  assert.match(prompt, /Functional:\s+shorten URLs; redirect on hit/);
  assert.match(prompt, /Non-functional:\s+p99 < 50ms redirect/);
});

test('buildPrompt 45-MIN GATE flips to PASSED after 45 minutes', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview({
    session_started_at: new Date(Date.now() - 46 * 60_000),
  });
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  assert.match(prompt, /45-MIN GATE:\s*PASSED/);
});

test('buildPrompt FOCUS RUBRIC for deep_dive renders deep_dive_topics', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPrompt({
    config,
    interview,
    sessionState: {
      next_directive: { recommended_section_focus_id: 'deep_dive' },
    },
    candidateMessage: '',
    interviewerReply: '',
  });
  assert.match(prompt, /Deep-dive topics/);
  assert.match(prompt, /id_generation/);
  assert.match(prompt, /redirect_critical_path/);
});

/* --------------------------- deriveAnswerOnly ----------------------- */

test('deriveAnswerOnly true only for ANSWER_AND_RELEASE', () => {
  assert.equal(deriveAnswerOnly(baseCaptured({ move: 'ANSWER_AND_RELEASE' })), true);
  assert.equal(deriveAnswerOnly(baseCaptured({ move: 'GO_DEEPER' })), false);
  assert.equal(deriveAnswerOnly(baseCaptured({ move: 'LET_LEAD' })), false);
});

/* --------------------------- applyEvalToSessionState: contract ------ */

test('applyEvalToSessionState: stores contract on first lock; locked_at_turn defaults to candidateTurnIndex', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      move: 'HAND_OFF',
      requirements_contract: {
        locked: true,
        functional: ['shorten URLs'],
        non_functional: ['p99 redirect'],
        in_scope: ['custom slugs'],
        out_of_scope: ['user auth'],
        locked_at_turn: null,
      },
      recommended_section_focus_id: 'requirements',
    }),
    { config, candidateTurnIndex: 4 }
  );
  const c = interview.session_state.requirements_contract;
  assert.equal(c.locked, true);
  assert.deepEqual(c.functional, ['shorten URLs']);
  assert.equal(c.locked_at_turn, 4, 'locked_at_turn defaults to candidateTurnIndex when null');
});

test('applyEvalToSessionState: contract is immutable once locked — second lock is refused', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      requirements_contract: {
        locked: true,
        functional: ['original functional'],
        non_functional: [],
        in_scope: [],
        out_of_scope: [],
        locked_at_turn: 4,
      },
      recommended_section_focus_id: 'requirements',
    }),
    { config, candidateTurnIndex: 4 }
  );

  applyEvalToSessionState(
    interview,
    baseCaptured({
      requirements_contract: {
        locked: true,
        functional: ['REWRITTEN'],
        non_functional: [],
        in_scope: [],
        out_of_scope: [],
        locked_at_turn: 9,
      },
      recommended_section_focus_id: 'high_level_design',
    }),
    { config, candidateTurnIndex: 9 }
  );

  assert.deepEqual(interview.session_state.requirements_contract.functional, ['original functional']);
  assert.equal(interview.session_state.requirements_contract.locked_at_turn, 4);
});

test('applyEvalToSessionState: stores proposed (unlocked) contract snapshot for visibility', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      requirements_contract: {
        locked: false,
        functional: ['shorten URLs (proposed)'],
        non_functional: [],
        in_scope: [],
        out_of_scope: [],
        locked_at_turn: null,
      },
      recommended_section_focus_id: 'requirements',
    }),
    { config, candidateTurnIndex: 2 }
  );
  const c = interview.session_state.requirements_contract;
  assert.equal(c.locked, false);
  assert.deepEqual(c.functional, ['shorten URLs (proposed)']);
});

/* --------------------------- breadth_coverage / pace / verdict ---- */

test('applyEvalToSessionState: persists breadth_coverage / response_pace / verdict_trajectory', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      breadth_coverage: {
        components_mentioned: ['write_api', 'redirect_service'],
        components_missing: ['caching_layer', 'id_generation'],
      },
      response_pace: 'suspiciously_fast',
      pace_turns_tracked: 2,
      verdict_trajectory: 'hire',
      recommended_section_focus_id: 'high_level_design',
    }),
    { config, candidateTurnIndex: 6 }
  );
  assert.deepEqual(interview.session_state.breadth_coverage.components_mentioned, ['write_api', 'redirect_service']);
  assert.deepEqual(interview.session_state.breadth_coverage.components_missing, ['caching_layer', 'id_generation']);
  assert.equal(interview.session_state.response_pace, 'suspiciously_fast');
  assert.equal(interview.session_state.pace_turns_tracked, 2);
  assert.equal(interview.session_state.verdict_trajectory, 'hire');
});

/* --------------------------- 45-min CLOSE floor backstop ------------ */

test('applyEvalToSessionState: CLOSE before 45 min downgrades to HAND_OFF (priority untouched section)', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview({
    session_started_at: new Date(Date.now() - 20 * 60_000),
    session_state: {
      flags_by_section: {
        requirements: [{ type: 'green', signal_id: 'nfr_awareness', note: 'ok', at_turn: 3 }],
        high_level_design: [{ type: 'green', signal_id: 'caching_placement', note: 'ok', at_turn: 8 }],
      },
    },
  });
  const captured = baseCaptured({
    move: 'CLOSE',
    interview_done: true,
    recommended_section_focus_id: 'high_level_design',
  });
  const { interviewDone } = applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 12,
  });

  assert.equal(captured.move, 'HAND_OFF', 'CLOSE before 45m must downgrade to HAND_OFF');
  assert.equal(captured.interview_done, false);
  assert.equal(interviewDone, false);

  // deep_dive is the highest-priority untouched section.
  assert.equal(captured.recommended_section_focus_id, 'deep_dive');

  const lastEval = interview.session_state.eval_history[interview.session_state.eval_history.length - 1];
  assert.equal(lastEval.close_blocked_reason, 'wall_clock_below_45m');
});

test('applyEvalToSessionState: CLOSE after 45m + all sections touched is allowed', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview({
    session_started_at: new Date(Date.now() - 47 * 60_000),
    session_state: {
      flags_by_section: {
        requirements: [{ type: 'green', signal_id: 'nfr_awareness', note: 'ok', at_turn: 3 }],
        high_level_design: [{ type: 'green', signal_id: 'caching_placement', note: 'ok', at_turn: 8 }],
        deep_dive: [{ type: 'green', signal_id: 'id_strategy', note: 'ok', at_turn: 14 }],
        operations: [{ type: 'green', signal_id: 'slo_defined', note: 'ok', at_turn: 22 }],
      },
    },
  });
  const captured = baseCaptured({
    move: 'CLOSE',
    interview_done: true,
    recommended_section_focus_id: 'operations',
  });
  const { interviewDone } = applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 25,
  });
  assert.equal(captured.move, 'CLOSE');
  assert.equal(interviewDone, true);
  assert.equal(interview.session_state.interview_done, true);
});

/* --------------------------- Untouched-section helpers --------------- */

test('UNTOUCHED_PRIORITY excludes tradeoffs in v5', () => {
  assert.deepEqual(UNTOUCHED_PRIORITY, ['deep_dive', 'operations', 'high_level_design', 'requirements']);
  assert.ok(!UNTOUCHED_PRIORITY.includes('tradeoffs'));
});

test('listUntouchedSections / pickPriorityUntouchedSection: picks deep_dive over operations', () => {
  const config = loadInterviewConfig();
  const sessionState = {
    flags_by_section: {
      requirements: [{ type: 'green', signal_id: 'nfr_awareness', note: 'x', at_turn: 1 }],
    },
  };
  const untouched = listUntouchedSections(config.sections, sessionState);
  const ids = untouched.map((s) => s.id);
  assert.ok(ids.includes('high_level_design'));
  assert.ok(ids.includes('deep_dive'));
  assert.ok(ids.includes('operations'));
  assert.ok(!ids.includes('requirements'));

  const priority = pickPriorityUntouchedSection(untouched);
  assert.equal(priority.id, 'deep_dive');
});

/* --------------------------- Probe queue v5 (probe_type) ------------ */

test('applyEvalToSessionState: probe_observations carry probe_type into the queue', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      probe_observations: [
        {
          observation: 'mentioned cache TTL',
          probe: 'how does the TTL behave under expiry?',
          section_id: 'high_level_design',
          difficulty: 'L2',
          probe_type: 'depth',
        },
        {
          observation: 'has not raised analytics',
          probe: 'what else does this system need before we go deeper?',
          section_id: 'high_level_design',
          difficulty: 'L1',
          probe_type: 'breadth',
        },
      ],
      recommended_section_focus_id: 'high_level_design',
    }),
    { config, candidateTurnIndex: 5 }
  );
  const queue = interview.session_state.probe_queue.high_level_design;
  assert.equal(queue.length, 2);
  assert.equal(queue[0].probe_type, 'depth');
  assert.equal(queue[1].probe_type, 'breadth');
});

/* --------------------------- eval_history audit row ----------------- */

test('applyEvalToSessionState: eval_history captures v5 fields', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    baseCaptured({
      verdict_trajectory: 'no_hire',
      response_pace: 'slow',
      pace_turns_tracked: 3,
      breadth_coverage: {
        components_mentioned: ['write_api'],
        components_missing: ['caching_layer'],
      },
      requirements_contract: {
        locked: true,
        functional: ['x'],
        non_functional: ['y'],
        in_scope: [],
        out_of_scope: [],
        locked_at_turn: 4,
      },
      recommended_section_focus_id: 'high_level_design',
    }),
    { config, candidateTurnIndex: 4 }
  );
  const last = interview.session_state.eval_history[0];
  assert.equal(last.verdict_trajectory, 'no_hire');
  assert.equal(last.response_pace, 'slow');
  assert.equal(last.pace_turns_tracked, 3);
  assert.equal(last.requirements_contract_locked_at_turn, 4);
  assert.equal(last.contract_locked_this_turn, true);
  assert.equal(last.breadth_components_missing_count, 1);
});
