import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvalToSessionState, buildPrompt, normalizeResult, SCHEMA, MOVES } from './interviewEvalCapture.js';
import { loadInterviewConfig } from './interviewConfig.js';

function makeInterview(overrides = {}) {
  return {
    session_state: {},
    conversation_turns: [],
    session_started_at: new Date(),
    markModified: () => {},
    ...overrides,
  };
}

test('MOVES enum uses planner high-level move types', () => {
  assert.deepEqual(MOVES, ['LISTEN', 'ASK', 'CHALLENGE', 'GUIDE', 'TRANSITION', 'CLOSE']);
});

test('SCHEMA advertises YAML shorthand contract', () => {
  assert.equal(SCHEMA.type, 'yaml');
  assert.deepEqual(SCHEMA.required, ['m', 'f', 'hier', 'cs', 'sig', 'done']);
  assert.ok(SCHEMA.fields.hier);
  assert.ok(SCHEMA.fields.cs);
  assert.ok(SCHEMA.fields.sig);
});

test('buildPrompt includes configuration and runtime state blocks', () => {
  const config = loadInterviewConfig();
  const { system, user } = buildPrompt({
    config,
    interview: makeInterview(),
    sessionState: {},
    candidateMessage: 'How about I start with the high level design first?',
    interviewerReply: 'Design a URL shortener like bit.ly. Take it from there.',
  });
  assert.match(system, /# Who You Are/);
  assert.match(system, /## CONFIGURATION/);
  assert.match(system, /```yaml/);
  assert.match(system, /interview_structure:/);
  assert.match(user, /## STATE PAYLOAD/);
  assert.match(user, /```yaml/);
  assert.match(user, /runtime_state:/);
  assert.match(user, /candidate_progress:/);
  assert.match(user, /transcript:/);
  assert.match(user, /output YAML only/);
});

test('normalizeResult maps shorthand YAML fields into canonical state shape', () => {
  const normalized = normalizeResult({
    m: 'ASK',
    f: 'Can you describe the write path?',
    hier: {
      ph: 'deep_dive',
      tp: 'storage_layer',
      stp: 'ttl_indexing',
      tt: 3,
      tst: 2,
      tph: 14.2,
      pq: 'adequate',
      tpr: 'deepening',
      ss: 'new_insight',
    },
    cs: {
      mom: 'driving',
      perf: 'at_bar',
      trend: 'improving',
      qual: 'solid',
    },
    sig: {
      turn: [{ t: 'green', o: 'Explained write flow', w: 'major' }],
      sum: { str: 2, wk: 1, obs: ['good depth'] },
      traj: 'hire',
      conf: 'medium',
    },
    done: false,
  });
  assert.equal(normalized.move, 'ASK');
  assert.equal(normalized.focus, 'Can you describe the write path?');
  assert.equal(normalized.conversation_hierarchy.phase.current, 'deep_dive');
  assert.equal(normalized.conversation_hierarchy.topic.current, 'storage_layer');
  assert.equal(normalized.conversation_hierarchy.subtopic.current, 'ttl_indexing');
  assert.equal(normalized.conversation_hierarchy.phase.time_in_phase_min, 14.2);
  assert.equal(normalized.candidate_state.momentum, 'driving');
  assert.equal(normalized.signals_collected.this_turn[0].observation, 'Explained write flow');
  assert.equal(normalized.signals_collected.section_summary.strong_signals, 2);
  assert.equal(normalized.signals_collected.overall_trajectory, 'hire');
  assert.equal(normalized.signals_collected.confidence_level, 'medium');
  assert.equal(normalized.interview_done, false);
});

test('applyEvalToSessionState persists planner directive and trace snapshots', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    {
      move: 'GUIDE',
      focus: 'Before architecture, clarify scope and NFRs.',
      recommended_focus: 'Before architecture, clarify scope and NFRs.',
      recommended_phase_focus_id: 'requirements',
      conversation_hierarchy: {
        phase: { current: 'requirements', time_in_phase_min: 1, phase_signal_quality: 'weak' },
        topic: {
          all_possible_topics_for_question: ['scope', 'nfrs'],
          current: 'scope',
          turns_on_topic: 1,
          topic_progress: 'exploring'
        },
        subtopic: {
          all_possible_sub_topics_for_question: { scope: ['functional_scope', 'nfrs'] },
          current: 'nfrs',
          turns_on_subtopic: 1,
          subtopic_signal: 'new_insight'
        }
      },
      candidate_state: {
        momentum: 'responding',
        performance_this_section: 'unclear',
        performance_trend: 'steady',
        response_quality: 'solid'
      },
      signals_collected: {
        this_turn: [{ type: 'red', observation: 'jumped to design too early', weight: 'major' }],
        section_summary: { strong_signals: 0, weak_signals: 1, key_observations: ['premature design'] },
        overall_trajectory: 'insufficient_data',
        confidence_level: 'low'
      },
      time_management: {
        elapsed_min: 1,
        remaining_min: 49,
        section_budget_status: 'on_track',
        should_transition_soon: false,
        transition_readiness: 'need_more_signal'
      },
      reasoning_trace: {
        situation_assessment: 'Candidate is trying to skip requirements.',
        decision_factors: ['insufficient requirements signal'],
        decision_rationale: 'Redirect to requirements first.',
        alternative_considered: 'Could allow HLD first, but it weakens calibration.'
      },
      interview_done: false
    },
    { config, candidateTurnIndex: 2, candidateMessage: 'Can I start with HLD?' }
  );
  const d = interview.session_state.next_directive;
  assert.equal(d.move, 'GUIDE');
  assert.equal(d.focus, 'Before architecture, clarify scope and NFRs.');
  assert.equal(d.recommended_focus, 'Before architecture, clarify scope and NFRs.');
  assert.equal(d.recommended_phase_focus_id, 'requirements');
  assert.equal(interview.session_state.raw_planner_outputs.length, 1);
  assert.equal(interview.session_state.eval_history.length, 1);
  assert.equal(interview.session_state.runtime_state.conversation_hierarchy.current_phase, 'requirements');
});

test('next buildPrompt runtime_state uses YAML-derived persisted state from prior turn', () => {
  const config = loadInterviewConfig();
  const interview = makeInterview();
  applyEvalToSessionState(
    interview,
    normalizeResult({
      m: 'CHALLENGE',
      f: 'How does this handle regional failover?',
      hier: {
        ph: 'deep_dive',
        tp: 'id_generation_at_scale',
        stp: 'collision_probability',
        tt: 5,
        tst: 2,
        tph: 17.5,
        pq: 'strong',
        tpr: 'deepening',
        ss: 'new_insight',
      },
      cs: {
        mom: 'driving',
        perf: 'above_bar',
        trend: 'improving',
        qual: 'insightful',
      },
      sig: {
        turn: [{ t: 'green', o: 'Handled failover tradeoffs', w: 'major' }],
        sum: { str: 3, wk: 0, obs: ['strong systems depth'] },
        traj: 'strong_hire',
        conf: 'high',
      },
      done: false,
    }),
    { config, candidateTurnIndex: 3, candidateMessage: 'I would replicate asynchronously.' }
  );

  const { user } = buildPrompt({
    config,
    interview,
    sessionState: interview.session_state,
    candidateMessage: 'I would replicate asynchronously.',
    interviewerReply: 'How will you manage consistency?',
  });

  assert.match(user, /current_phase:\s+deep_dive/);
  assert.match(user, /current_topic:\s+id_generation_at_scale/);
  assert.match(user, /current_subtopic:\s+collision_probability/);
  assert.match(user, /momentum:\s+driving/);
});
