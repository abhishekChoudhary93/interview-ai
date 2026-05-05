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

/**
 * buildPrompt now returns { system, user } so the OpenRouter request can ship
 * the static prefix as role=system (cache-friendly). Tests that assert on
 * "the whole prompt" use this helper to flatten both blocks into one string.
 */
function buildPromptString(opts) {
  const { system, user } = buildPrompt(opts);
  return `${system}\n${user}`;
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
  const prompt = buildPromptString({
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

  // Probe discipline (v5.1: thread-depth + breadth-vs-depth merged into one block).
  assert.match(prompt, /BREADTH COVERAGE:/);
  assert.match(prompt, /breadth_coverage/);
  assert.match(prompt, /Probe Discipline/);
  assert.match(prompt, /Breadth vs\. Depth/);
  assert.match(prompt, /Thread depth/);

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
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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

test('buildPrompt: earn-before-name + one-move-per-directive + candidate-facing rules survive in DECISION_ALGORITHM (v5.1: HARD_RULES_SUMMARY consolidated away)', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPromptString({
    config,
    interview,
    sessionState: {},
    candidateMessage: '',
    interviewerReply: '',
  });
  // STEP 6 — earn-before-name still anchors the engage-freely framing.
  assert.match(prompt, /STEP 6 — EARN BEFORE NAME/);
  // STEP 7 — one move per directive still present.
  assert.match(prompt, /STEP 7 — ONE MOVE PER DIRECTIVE/);
  // STEP 11 — candidate-facing rule moved here from the dropped HARD_RULES_SUMMARY.
  assert.match(prompt, /recommended_focus IS CANDIDATE-FACING/);
  assert.match(prompt, /`notes` is NEVER shown to the candidate/);
  // Engage-freely framing.
  assert.match(prompt, /push hard|push HARD/);
});

test('buildPrompt: subsequent STEP numbers shifted to make room for new STEP 7', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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
  const prompt = buildPromptString({
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

/* --------------------------- system/user split for prompt caching --- */

test('buildPrompt: system block carries static rules + INTERVIEW CONFIG + INTERVIEW PLAN; turn-varying state stays in user', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const { system, user } = buildPrompt({
    config,
    interview,
    sessionState: {},
    candidateMessage: 'How many users?',
    interviewerReply: 'previous reply',
  });

  // System carries the restored output schema, all rule blocks, INTERVIEW
  // CONFIG, and INTERVIEW PLAN (sections roadmap is session-stable).
  assert.match(system, /# Output Schema/);
  assert.match(system, /Emit exactly this JSON and nothing else/);
  assert.match(system, /=== INTERVIEW CONFIG ===/);
  assert.match(system, /INTERVIEW PLAN — your structural roadmap/);
  assert.match(system, /STEP 9 — SELECT MOVE/);
  assert.match(system, /Move Catalog/);

  // System must NOT carry turn-varying values (would break cache prefix).
  assert.doesNotMatch(system, /=== RUNTIME STATE ===/);
  assert.doesNotMatch(system, /WALL CLOCK:/);
  assert.doesNotMatch(system, /LATEST CANDIDATE MESSAGE:/);
  assert.doesNotMatch(system, /TRANSCRIPT \(last 12 turns\):/);

  // User carries runtime state, focus rubric, transcript, candidate input.
  assert.match(user, /=== RUNTIME STATE ===/);
  assert.match(user, /WALL CLOCK:/);
  assert.match(user, /45-MIN GATE:/);
  assert.match(user, /SECTION SCOREBOARD:/);
  assert.match(user, /TRANSCRIPT \(last 12 turns\):/);
  assert.match(user, /LATEST INTERVIEWER TURN: previous reply/);
  assert.match(user, /LATEST CANDIDATE MESSAGE: How many users\?/);

  // User must NOT carry the static rules (would dilute the cache split).
  assert.doesNotMatch(user, /# Output Schema/);
  assert.doesNotMatch(user, /=== INTERVIEW CONFIG ===/);
  assert.doesNotMatch(user, /STEP 9 — SELECT MOVE/);
});

test('buildPrompt: system block is byte-identical across consecutive turns of one session — cache prefix stability', () => {
  const config = loadInterviewConfig();
  const sessionStartedAt = new Date(Date.now() - 10 * 60_000);

  // Turn N — early state, candidate just clarified scope.
  const interviewN = makeInterview({
    session_started_at: sessionStartedAt,
    conversation_turns: [
      { role: 'interviewer', content: 'go' },
      { role: 'candidate', content: 'I want to clarify scope.' },
    ],
  });
  const sessionStateN = {
    section_minutes_used: { requirements: 4 },
    next_directive: { recommended_section_focus_id: 'requirements', difficulty: 'L2' },
    response_pace: 'normal',
    pace_turns_tracked: 1,
  };

  // Turn N+1 — wall clock moved, transcript grew, candidate said something
  // new, scoreboard changed. NOTHING should leak into the system block.
  const interviewN1 = makeInterview({
    session_started_at: sessionStartedAt,
    conversation_turns: [
      { role: 'interviewer', content: 'go' },
      { role: 'candidate', content: 'I want to clarify scope.' },
      { role: 'interviewer', content: 'Sure — what is the read-to-write ratio you assume?' },
      { role: 'candidate', content: 'Roughly 100:1 reads.' },
    ],
  });
  const sessionStateN1 = {
    section_minutes_used: { requirements: 7 },
    next_directive: {
      recommended_section_focus_id: 'requirements',
      difficulty: 'L2',
      current_subtopic: 'read-write ratio',
      consecutive_probes_on_subtopic: 1,
    },
    response_pace: 'fast',
    pace_turns_tracked: 2,
  };

  const a = buildPrompt({
    config,
    interview: interviewN,
    sessionState: sessionStateN,
    candidateMessage: 'I want to clarify scope.',
    interviewerReply: 'go',
  });
  const b = buildPrompt({
    config,
    interview: interviewN1,
    sessionState: sessionStateN1,
    candidateMessage: 'Roughly 100:1 reads.',
    interviewerReply: 'Sure — what is the read-to-write ratio you assume?',
  });

  assert.equal(a.system, b.system, 'system block must be byte-identical across turns of one session');
  assert.notEqual(a.user, b.user, 'sanity: user block does change across turns');
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

/* --------------------------- Substrate guards (v5+) ----------------- */

test('quit-signal guard: explicit "let\'s end the interview" forces CLOSE + interview_done', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview({
    session_started_at: new Date(Date.now() - 50 * 60_000), // past 45m floor
    session_state: {
      flags_by_section: {
        requirements: [{ type: 'green', signal_id: 'nfr_awareness', note: 'ok', at_turn: 3 }],
        high_level_design: [{ type: 'green', signal_id: 'caching_placement', note: 'ok', at_turn: 8 }],
        deep_dive: [{ type: 'green', signal_id: 'id_strategy', note: 'ok', at_turn: 14 }],
        operations: [{ type: 'green', signal_id: 'slo_defined', note: 'ok', at_turn: 20 }],
      },
    },
  });
  const captured = baseCaptured({
    move: 'CHALLENGE_ASSUMPTION',
    recommended_focus: 'before we go, can you list the NFRs?',
    recommended_section_focus_id: 'requirements',
  });
  const { interviewDone } = applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 22,
    candidateMessage: "Let's end the interview",
  });
  assert.equal(captured.move, 'CLOSE');
  assert.equal(captured.candidate_signal, 'block_complete');
  assert.equal(captured.interview_done, true);
  assert.equal(interviewDone, true);
  assert.equal(interview.session_state.eval_history[0].quit_guard_fired, true);
});

test('quit-signal guard: leaves Planner alone if move is already CLOSE / SALVAGE_AND_MOVE / HAND_OFF / WRAP_TOPIC', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const captured = baseCaptured({
    move: 'SALVAGE_AND_MOVE',
    recommended_focus: 'one quick thing on monitoring before we move',
    recommended_section_focus_id: 'operations',
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 12,
    candidateMessage: "I'm done here",
  });
  assert.equal(captured.move, 'SALVAGE_AND_MOVE');
  assert.equal(interview.session_state.eval_history[0].quit_guard_fired, false);
});

test('quit-signal guard: does NOT trigger on benign endings ("end the request", "stop right there")', () => {
  // The regex is intentionally tight — "end the request" / "stop right there"
  // are common technical-context phrases that must NOT be misclassified.
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const captured = baseCaptured({
    move: 'GO_DEEPER',
    recommended_focus: 'how do you handle that path?',
    recommended_section_focus_id: 'high_level_design',
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 8,
    candidateMessage: "I would end the request with a 301 redirect — stop right there.",
  });
  assert.equal(captured.move, 'GO_DEEPER');
  assert.equal(interview.session_state.eval_history[0].quit_guard_fired, false);
});

test('thread-depth guard: depth>=4 forces PIVOT_ANGLE and resets the counter', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const captured = baseCaptured({
    move: 'GO_DEEPER',
    recommended_focus: 'still pushing on slug uniqueness',
    recommended_section_focus_id: 'requirements',
    consecutive_probes_on_subtopic: 4,
    current_subtopic: 'slug uniqueness',
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 6,
    candidateMessage: 'I think slugs should be 7 chars.',
  });
  assert.equal(captured.move, 'PIVOT_ANGLE');
  assert.equal(captured.consecutive_probes_on_subtopic, 0);
  assert.equal(captured.current_subtopic, '');
  assert.equal(captured.recommended_focus, '');
  assert.equal(interview.session_state.eval_history[0].thread_depth_guard_fired, true);
});

test('thread-depth guard: depth<4 leaves the Planner directive alone', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  const captured = baseCaptured({
    move: 'GO_DEEPER',
    recommended_focus: 'tell me more about TTL',
    recommended_section_focus_id: 'high_level_design',
    consecutive_probes_on_subtopic: 3, // soft cap, not the hard backstop
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 5,
    candidateMessage: 'TTL would be configurable per link.',
  });
  assert.equal(captured.move, 'GO_DEEPER');
  assert.equal(interview.session_state.eval_history[0].thread_depth_guard_fired, false);
});

test('thread-depth guard: leaves PIVOT_ANGLE / HAND_OFF / WRAP_TOPIC alone even at depth 4+', () => {
  // CLOSE is intentionally tested separately because the (independent)
  // 45-min CLOSE-floor backstop can downgrade it to HAND_OFF based on
  // wall-clock, which would cross-contaminate the assertion below.
  const config = loadInterviewConfig();
  for (const move of ['PIVOT_ANGLE', 'HAND_OFF', 'WRAP_TOPIC']) {
    const interview = makeInterview();
    const captured = baseCaptured({
      move,
      recommended_focus: 'whatever',
      recommended_section_focus_id: 'high_level_design',
      consecutive_probes_on_subtopic: 5,
    });
    applyEvalToSessionState(interview, captured, {
      config,
      candidateTurnIndex: 5,
      candidateMessage: 'sure',
    });
    assert.equal(captured.move, move, `${move} should not be overridden by thread-depth guard`);
  }
});

test('thread-depth guard: leaves CLOSE alone at depth 4+ when 45-min floor + all sections touched permit it', () => {
  // CLOSE survives only when the wall clock has cleared the 45-min floor AND
  // every section has at least one flag/probe. This isolates the thread-depth
  // guard from the (independent) CLOSE-floor backstop.
  const config = loadInterviewConfig();
  const interview = makeInterview({
    session_started_at: new Date(Date.now() - 50 * 60_000),
    session_state: {
      flags_by_section: {
        requirements: [{ type: 'green', signal_id: 'nfr_awareness', note: 'ok', at_turn: 3 }],
        high_level_design: [{ type: 'green', signal_id: 'caching_placement', note: 'ok', at_turn: 8 }],
        deep_dive: [{ type: 'green', signal_id: 'id_strategy', note: 'ok', at_turn: 14 }],
        operations: [{ type: 'green', signal_id: 'slo_defined', note: 'ok', at_turn: 20 }],
      },
    },
  });
  const captured = baseCaptured({
    move: 'CLOSE',
    recommended_focus: '',
    recommended_section_focus_id: 'operations',
    consecutive_probes_on_subtopic: 5,
    interview_done: true,
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 22,
    candidateMessage: 'sure',
  });
  assert.equal(captured.move, 'CLOSE');
});

test('seeding-leak guard: rewrites focus that names a missing breadth component the candidate has not earned', () => {
  // Reproduces the URL-shortener trace failure: Planner's focus said
  // "...especially around slug generation, caching, or expiry?" — three
  // required_breadth_components leaked, none of which the candidate had
  // raised. The guard must rewrite to NUDGE_BREADTH.
  const config = loadInterviewConfig();
  const interview = makeInterview({
    conversation_turns: [
      { role: 'candidate', content: 'we need TTLs and per-link click counts' },
    ],
    session_state: {
      breadth_coverage: {
        components_mentioned: ['ttl_expiry_handling', 'analytics_counter'],
        components_missing: ['caching_layer', 'id_generation', 'redirect_service'],
      },
    },
  });
  const captured = baseCaptured({
    move: 'NUDGE_BREADTH',
    recommended_section_focus_id: 'requirements',
    recommended_focus:
      'What else does this system need, especially around slug generation, caching, or expiry?',
    breadth_coverage: {
      components_mentioned: ['ttl_expiry_handling', 'analytics_counter'],
      components_missing: ['caching_layer', 'id_generation', 'redirect_service'],
    },
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 4,
    candidateMessage: 'how about that?',
  });
  // Rewritten to a generic open NUDGE_BREADTH form.
  assert.equal(captured.move, 'NUDGE_BREADTH');
  assert.doesNotMatch(captured.recommended_focus, /slug generation|caching|expiry/i);
  assert.match(captured.recommended_focus, /what else does this system need/i);
  const histRow = interview.session_state.eval_history[0];
  assert.ok(histRow.leak_guard_fired, 'leak_guard_fired should be set');
  assert.match(histRow.leak_guard_fired, /^breadth:/);
});

test('seeding-leak guard: does NOT fire on terms the candidate has already used', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview({
    conversation_turns: [
      { role: 'candidate', content: 'I would add a Redis caching layer in front.' },
    ],
    session_state: {
      breadth_coverage: {
        components_mentioned: ['caching_layer'],
        components_missing: ['id_generation'],
      },
    },
  });
  const captured = baseCaptured({
    move: 'GO_DEEPER',
    recommended_section_focus_id: 'high_level_design',
    recommended_focus:
      'You mentioned the caching layer — how does the TTL on it work?',
    breadth_coverage: {
      components_mentioned: ['caching_layer'],
      components_missing: ['id_generation'],
    },
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 8,
    candidateMessage: 'TTL based on the link expiry config.',
  });
  // No rewrite — candidate has already said "caching layer".
  assert.equal(captured.move, 'GO_DEEPER');
  assert.match(captured.recommended_focus, /caching layer/);
  assert.equal(interview.session_state.eval_history[0].leak_guard_fired, null);
});

test('seeding-leak guard: skipped on carve-out moves (ANSWER_AND_RELEASE, INJECT_FAULT, RAISE_STAKES, INJECT_VARIANT)', () => {
  const config = loadInterviewConfig();
  for (const move of ['ANSWER_AND_RELEASE', 'INJECT_FAULT', 'RAISE_STAKES', 'INJECT_VARIANT']) {
    const interview = makeInterview({
      conversation_turns: [{ role: 'candidate', content: 'sure go ahead' }],
      session_state: {
        breadth_coverage: {
          components_mentioned: [],
          components_missing: ['caching_layer', 'id_generation'],
        },
      },
    });
    const captured = baseCaptured({
      move,
      recommended_section_focus_id: 'high_level_design',
      // Deliberately mention "caching layer" — the carve-out should let
      // this through because these moves are config-grounded by design.
      recommended_focus: 'Your caching layer just lost a node — what fails first?',
      breadth_coverage: {
        components_mentioned: [],
        components_missing: ['caching_layer', 'id_generation'],
      },
    });
    applyEvalToSessionState(interview, captured, {
      config,
      candidateTurnIndex: 8,
      candidateMessage: 'continuing on',
    });
    assert.equal(captured.move, move, `${move} should NOT be rewritten`);
    assert.match(captured.recommended_focus, /caching layer/);
  }
});

test('seeding-leak guard: scale-fact number leak rewrites to DRAW_NUMBERS', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview({
    conversation_turns: [{ role: 'candidate', content: 'I am thinking about the read path' }],
    session_state: {
      breadth_coverage: {
        components_mentioned: [],
        components_missing: [],
      },
    },
  });
  const captured = baseCaptured({
    move: 'GO_DEEPER',
    recommended_section_focus_id: 'high_level_design',
    // 500,000 is verbatim from config.scale_facts and the candidate has not raised it
    recommended_focus: 'How does your design handle 500,000 redirects/sec?',
  });
  applyEvalToSessionState(interview, captured, {
    config,
    candidateTurnIndex: 6,
    candidateMessage: 'reading the path',
  });
  assert.equal(captured.move, 'DRAW_NUMBERS');
  assert.doesNotMatch(captured.recommended_focus, /500,000/);
  assert.match(captured.recommended_focus, /numbers/i);
});

test('flag-emission observability: warns (no throw) when zero flags on substantive turn with rubric signals', () => {
  // Capture console.warn so the test isn't noisy and so we can assert on it.
  const config = loadInterviewConfig();
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => { calls.push(args.join(' ')); };
  try {
    const interview = makeInterview();
    const captured = baseCaptured({
      candidate_signal: 'driving',
      recommended_section_focus_id: 'requirements',
      flags: [], // missing!
    });
    applyEvalToSessionState(interview, captured, {
      config,
      candidateTurnIndex: 3,
      candidateMessage: 'I think we need TTLs and click counts',
    });
    const matched = calls.some((c) => /zero flags on substantive turn/.test(c));
    assert.ok(matched, 'expected a zero-flags warning on substantive turn');
  } finally {
    console.warn = original;
  }
});
