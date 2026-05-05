import { invokeLLM } from './llmInvoke.js';
import { resolveOpenRouterModel } from '../config.js';

/**
 * v5 Planner — per-turn JSON directive.
 *
 * Architecture: LLM-led, app-as-data-layer, single-problem.
 *
 *   - The Planner LLM owns ALL interviewer judgment AND all section
 *     transitions. Sections are a structural plan in the injected
 *     interview_config. The application does not advance sections.
 *
 *   - The Planner is the "mind of an experienced FAANG interviewer". It
 *     emits a single JSON directive each turn carrying: move, difficulty,
 *     focus, requirements_contract, breadth_coverage, response_pace,
 *     verdict_trajectory, momentum, bar_trajectory, time_status, flags,
 *     probe_observations, and interview_done.
 *
 *   - INJECT_FAULT, RAISE_STAKES, INJECT_VARIANT draw from
 *     config.fault_scenarios / raise_stakes_prompts / variant_scenarios
 *     respectively — content-driven moves.
 *
 *   - The Planner emits `interview_done=true` directly when wrap is done,
 *     and only after the 45-minute floor has passed.
 *
 *   - JS substrate: schema validation, persistence (probe_queue,
 *     flags_by_section, section_minutes_used, eval_history, contract,
 *     breadth_coverage, pace, verdict_trajectory). 45-minute CLOSE
 *     backstop. No leak guard, no executor-reply validator.
 */

/* --------------------------- Output schema ---------------------------- */

const MOVES = [
  // Listening
  'LET_LEAD',
  'ANSWER_AND_RELEASE',
  // Probing
  'GO_DEEPER',
  'CHALLENGE_ASSUMPTION',
  'CHALLENGE_TRADEOFF',
  'DRAW_NUMBERS',
  'INJECT_FAULT',
  'RAISE_STAKES',
  'INJECT_VARIANT',
  // Lateral / breadth
  'NUDGE_BREADTH',
  'PIVOT_ANGLE',
  // Difficulty-down
  'NARROW_SCOPE',
  'PROVIDE_ANCHOR',
  'SALVAGE_AND_MOVE',
  // Transition
  'HAND_OFF',
  'WRAP_TOPIC',
  'CLOSE',
];

const DIFFICULTIES = ['L1', 'L2', 'L3'];
const MOMENTUMS = ['hot', 'warm', 'cold'];
const BAR_TRAJECTORIES = ['rising', 'flat', 'falling'];
const TIME_STATUSES = ['on_track', 'behind', 'critical'];
const PERFORMANCE_ASSESSMENTS = ['above_target', 'at_target', 'below_target', 'unclear'];
const CANDIDATE_SIGNALS = ['driving', 'asked_question', 'block_complete', 'stuck', 'missing_breadth', 'rabbit_holing', 'procedural'];
const FLAG_TYPES = ['green', 'red'];
const RESPONSE_PACES = ['fast', 'normal', 'slow', 'suspiciously_fast'];
const VERDICT_TRAJECTORIES = ['strong_hire', 'hire', 'no_hire', 'strong_no_hire', 'insufficient_data'];
const PROBE_TYPES = ['breadth', 'depth'];

const SCHEMA = {
  type: 'object',
  properties: {
    move: { type: 'string', enum: MOVES },
    difficulty: { type: 'string', enum: DIFFICULTIES },
    recommended_section_focus_id: {
      type: 'string',
      description:
        "Section id from interview_config.sections this turn's lens applies to. Drives substrate routing of flags / probes / time accounting and the FOCUS RUBRIC the Planner sees next turn.",
    },
    recommended_focus: {
      type: 'string',
      description:
        'Candidate-facing question or transition phrase. Empty string for LET_LEAD. For ANSWER_AND_RELEASE, exactly the one fact from interview_config (no preamble, no follow-up). Treat as if the candidate will read it verbatim.',
    },
    consumed_probe_id: {
      type: 'string',
      description:
        'When recommending HAND_OFF or GO_DEEPER, set to the queue item id whose probe drives the focus. Otherwise empty string.',
    },
    current_subtopic: {
      type: 'string',
      description:
        '3-5 word label for the sub-topic this turn probes (e.g. "consistent hashing rebalancing", "cache TTL strategy"). Used by the rabbit-hole guard. Empty string for LET_LEAD / ANSWER_AND_RELEASE / procedural.',
    },
    consecutive_probes_on_subtopic: {
      type: 'integer',
      description:
        'How many consecutive turns have probed THIS same subtopic (including this turn). Reset to 0 on PIVOT_ANGLE / HAND_OFF / WRAP_TOPIC / CLOSE / move into a different signal area. Hard rule: must NOT exceed 3 — if it would, emit PIVOT_ANGLE.',
      minimum: 0,
    },

    requirements_contract: {
      type: 'object',
      description:
        'The locked requirements contract. Once locked=true, this is immutable for the session — first lock wins. Functional, NFR, in_scope, out_of_scope are agreed lists. locked_at_turn is the candidate-turn index when locking happened.',
      properties: {
        locked: { type: 'boolean' },
        functional: { type: 'array', items: { type: 'string' } },
        non_functional: { type: 'array', items: { type: 'string' } },
        in_scope: { type: 'array', items: { type: 'string' } },
        out_of_scope: { type: 'array', items: { type: 'string' } },
        locked_at_turn: { type: ['integer', 'null'] },
      },
    },

    breadth_coverage: {
      type: 'object',
      description:
        'Snapshot of breadth coverage against config.required_breadth_components. Updated each turn as the candidate raises or omits components.',
      properties: {
        components_mentioned: { type: 'array', items: { type: 'string' } },
        components_missing: { type: 'array', items: { type: 'string' } },
      },
    },

    response_pace: {
      type: 'string',
      enum: RESPONSE_PACES,
      description:
        "fast | normal | slow | suspiciously_fast — the candidate's recent response pattern. suspiciously_fast for 2+ complex turns => INJECT_VARIANT. slow for 2+ turns => NARROW_SCOPE.",
    },
    pace_turns_tracked: {
      type: 'integer',
      description: 'How many consecutive turns at this pace.',
      minimum: 0,
    },

    probe_observations: {
      type: 'array',
      description:
        "0-2 NEW probe-worthy observations from THIS turn — things worth asking about a future turn. Each MUST be tagged with the section_id and probe_type (breadth | depth) and carry a pre-formed candidate-facing question in `probe`.",
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          observation: { type: 'string' },
          probe: { type: 'string' },
          section_id: { type: 'string' },
          difficulty: { type: 'string', enum: DIFFICULTIES },
          probe_type: { type: 'string', enum: PROBE_TYPES },
        },
        required: ['observation', 'probe', 'section_id', 'difficulty'],
      },
    },

    flags: {
      type: 'array',
      description:
        '0-2 bar-judgment flags discovered THIS turn. green = candidate hit/exceeded the target_level bar; red = below bar. Each MUST be tagged with section_id and signal_id (from config.sections[].signals[].id).',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: FLAG_TYPES },
          section_id: { type: 'string' },
          signal_id: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['type', 'section_id', 'signal_id', 'note'],
      },
    },

    momentum: { type: 'string', enum: MOMENTUMS },
    bar_trajectory: { type: 'string', enum: BAR_TRAJECTORIES },
    performance_assessment: { type: 'string', enum: PERFORMANCE_ASSESSMENTS },
    verdict_trajectory: {
      type: 'string',
      enum: VERDICT_TRAJECTORIES,
      description:
        'Running verdict picture, updated every substantive turn. strong_hire | hire | no_hire | strong_no_hire | insufficient_data. Insufficient_data only valid in early turns.',
    },
    time_status: { type: 'string', enum: TIME_STATUSES },
    candidate_signal: { type: 'string', enum: CANDIDATE_SIGNALS },
    interview_done: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: [
    'move',
    'difficulty',
    'recommended_section_focus_id',
    'recommended_focus',
    'momentum',
    'bar_trajectory',
    'performance_assessment',
    'verdict_trajectory',
    'time_status',
    'candidate_signal',
    'interview_done',
  ],
};

/* --------------------------- Section helpers ------------------------- */

function resolveFocusSection(config, hintId, fallbackId) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  if (sections.length === 0) return { section: null, index: -1 };
  for (const id of [hintId, fallbackId]) {
    if (!id) continue;
    const i = sections.findIndex((s) => s.id === id);
    if (i >= 0) return { section: sections[i], index: i };
  }
  return { section: sections[0], index: 0 };
}

/* --------------------------- Probe queue + flags rendering ----------- */

function formatProbeQueueAcrossSections(probeQueue, sections) {
  const lines = [];
  for (const sec of sections) {
    const all = Array.isArray(probeQueue?.[sec.id]) ? probeQueue[sec.id] : [];
    const open = all.filter((p) => !p.consumed);
    if (open.length === 0) continue;
    const sorted = open
      .slice()
      .sort((a, b) => (b.added_at_turn || 0) - (a.added_at_turn || 0))
      .slice(0, 3);
    for (const p of sorted) {
      const ptype = p.probe_type ? `${p.probe_type} ` : '';
      lines.push(
        `  ${p.id} [${sec.id}] ${ptype}difficulty=${p.difficulty || 'L2'}: "${String(p.probe || p.observation || '').slice(0, 110)}"`
      );
    }
  }
  if (lines.length === 0) return '(none)';
  return lines.join('\n');
}

function formatActiveFlags(flagsBySection, sections) {
  const lines = [];
  for (const sec of sections) {
    const arr = Array.isArray(flagsBySection?.[sec.id]) ? flagsBySection[sec.id] : [];
    const recent = arr.slice(-4);
    for (const f of recent) {
      lines.push(
        `  ${String(f.type || '?').toUpperCase()} [${sec.id}] ${f.signal_id || '?'}: ${String(f.note || '').slice(0, 110)}`
      );
    }
  }
  if (lines.length === 0) return '(none)';
  return lines.join('\n');
}

/* --------------------------- Section budgets ------------------------- */

function bucketForPct(pct) {
  if (pct >= 1.0) return 'critical';
  if (pct >= 0.75) return 'behind';
  return 'on_track';
}

function buildSectionBudgetsBlock(sections, sectionMinutesUsed) {
  const lines = [];
  for (const sec of sections) {
    const budget = Number(sec.budget_minutes) || 0;
    const used = Number(sectionMinutesUsed?.[sec.id] || 0);
    const pct = budget > 0 ? used / budget : 0;
    const bucket = bucketForPct(pct);
    lines.push(
      `  ${sec.id} (${budget}m budget / ${used.toFixed(1)}m used) — ${bucket}`
    );
  }
  return lines.join('\n');
}

function buildSectionScoreboard(sections, flagsBySection, probeQueue) {
  const lines = [];
  for (const sec of sections) {
    const flags = Array.isArray(flagsBySection?.[sec.id]) ? flagsBySection[sec.id] : [];
    const greenN = flags.filter((f) => f.type === 'green').length;
    const redN = flags.filter((f) => f.type === 'red').length;
    const queue = Array.isArray(probeQueue?.[sec.id]) ? probeQueue[sec.id] : [];
    const queueOpen = queue.filter((p) => !p.consumed).length;
    const allTouches = [
      ...flags.map((f) => f.at_turn || 0),
      ...queue.map((p) => p.added_at_turn || 0),
    ];
    const lt = allTouches.length ? `last_touch=t${Math.max(...allTouches)}` : 'NEVER TOUCHED';
    lines.push(`  ${sec.id}: ${greenN}g/${redN}r/${queueOpen}q ${lt}`);
  }
  return lines.join('\n');
}

/* --------------------------- Section exit gates ---------------------- */

function buildSectionExitGatesBlock(sections, flagsBySection) {
  const lines = [];
  for (const sec of sections) {
    const gate = sec?.exit_gate;
    if (!gate || !Array.isArray(gate.require_any) || gate.require_any.length === 0) {
      lines.push(`  ${sec.id}: (no exit gate defined — HAND_OFF allowed any time)`);
      continue;
    }
    const flags = Array.isArray(flagsBySection?.[sec.id]) ? flagsBySection[sec.id] : [];
    const greens = new Set(
      flags.filter((f) => f.type === 'green' && f.signal_id).map((f) => f.signal_id)
    );
    const greenIntersect = gate.require_any.filter((id) => greens.has(id));
    const passed = greenIntersect.length > 0;
    const greensPart = greenIntersect.length > 0
      ? `greens: [${greenIntersect.join(', ')}]`
      : 'greens: []';
    lines.push(
      `  ${sec.id}: gate=[${gate.require_any.join(', ')}] — ${passed ? 'passed' : 'NOT_PASSED'} (${greensPart})`
    );
  }
  return lines.join('\n');
}

/* --------------------------- Untouched sections ---------------------- */

function isSectionTouched(sec, sessionState) {
  const flags = Array.isArray(sessionState?.flags_by_section?.[sec.id])
    ? sessionState.flags_by_section[sec.id]
    : [];
  if (flags.length > 0) return true;
  const queue = Array.isArray(sessionState?.probe_queue?.[sec.id])
    ? sessionState.probe_queue[sec.id]
    : [];
  if (queue.length > 0) return true;
  const evalHist = Array.isArray(sessionState?.eval_history) ? sessionState.eval_history : [];
  for (const e of evalHist) {
    if (e?.recommended_section_focus_id === sec.id) return true;
  }
  return false;
}

/**
 * Priority order for HAND_OFF redirect when CLOSE is blocked: deep_dive
 * carries the most differentiated signal, operations is the next-most
 * load-bearing for a senior bar.
 */
const UNTOUCHED_PRIORITY = ['deep_dive', 'operations', 'high_level_design', 'requirements'];

function listUntouchedSections(sections, sessionState) {
  return sections.filter((s) => !isSectionTouched(s, sessionState));
}

function pickPriorityUntouchedSection(untouched) {
  if (!Array.isArray(untouched) || untouched.length === 0) return null;
  for (const id of UNTOUCHED_PRIORITY) {
    const hit = untouched.find((s) => s.id === id);
    if (hit) return hit;
  }
  return untouched[0];
}

/* --------------------------- Transcript ------------------------------ */

function sectionWindowedTurns(interview, cap = 12) {
  const turns = Array.isArray(interview?.conversation_turns) ? interview.conversation_turns : [];
  return turns.slice(-cap).map((t) => ({
    role: String(t?.role || 'candidate'),
    content: String(t?.content || ''),
  }));
}

function formatTranscriptBlock(turns) {
  if (!turns?.length) return '(no turns yet)';
  return turns
    .map((t, i) => `  ${i + 1}. ${t.role.toUpperCase()}: ${t.content.slice(0, 600)}`)
    .join('\n');
}

function formatCanvasBlock(interview) {
  const text = String(interview?.canvas_text || '').trim();
  if (!text) return '';
  return text.slice(0, 1500);
}

/* --------------------------- Momentum ------------------------------- */

function computeMomentumFromHistory(evalHistory) {
  if (!Array.isArray(evalHistory) || evalHistory.length === 0) return [];
  const substantive = evalHistory
    .filter((e) => e?.performance_assessment && e.performance_assessment !== 'unclear')
    .slice(-3)
    .map((e) => e.performance_assessment);
  return substantive;
}

/* --------------------------- Contract / Breadth blocks --------------- */

function buildRequirementsContractBlock(contract) {
  const c = contract || null;
  if (!c || !c.locked) {
    const lines = ['  Locked: false'];
    if (c) {
      if (Array.isArray(c.functional) && c.functional.length) {
        lines.push(`  Functional (proposed): ${c.functional.join('; ')}`);
      }
      if (Array.isArray(c.non_functional) && c.non_functional.length) {
        lines.push(`  Non-functional (proposed): ${c.non_functional.join('; ')}`);
      }
    }
    lines.push('  (Lock the contract before HAND_OFF out of requirements. Special case: requirements exit gate requires at least one NFR.)');
    return lines.join('\n');
  }
  const lines = [
    `  Locked: true (at turn ${c.locked_at_turn ?? '?'}) — IMMUTABLE for the rest of the session`,
    `  Functional:     ${(c.functional || []).join('; ') || '(none)'}`,
    `  Non-functional: ${(c.non_functional || []).join('; ') || '(none)'}`,
    `  In scope:       ${(c.in_scope || []).join('; ') || '(none)'}`,
    `  Out of scope:   ${(c.out_of_scope || []).join('; ') || '(none)'}`,
  ];
  return lines.join('\n');
}

function buildBreadthCoverageBlock(config, breadthCoverage) {
  const required = Array.isArray(config?.required_breadth_components)
    ? config.required_breadth_components
    : [];
  const mentioned = Array.isArray(breadthCoverage?.components_mentioned)
    ? breadthCoverage.components_mentioned
    : [];
  const missing = Array.isArray(breadthCoverage?.components_missing)
    ? breadthCoverage.components_missing
    : required.filter((c) => !mentioned.includes(c));
  return [
    `  Required (${required.length}): ${required.join(', ') || '(none defined)'}`,
    `  Mentioned (${mentioned.length}): ${mentioned.join(', ') || '(none yet)'}`,
    `  Missing  (${missing.length}): ${missing.join(', ') || '(none — full coverage)'}`,
  ].join('\n');
}

/* --------------------------- Static prompt blocks -------------------- */

const ROLE_BLOCK = `# What You Are

You are the **mind of an experienced FAANG interviewer** — the internal reasoning layer that decides what happens next. You have run 200+ system design loops. You know what good looks like at every level. You are not a rubric checker. You are a calibration engine whose job is to collect as many high-quality green and red signals as possible before time runs out, then render an honest, defensible verdict.

You are invisible to the candidate. The Executor speaks for you.

# The Interviewer's Job, In Plain Terms

1. **Guard the time.** It is YOUR fault if the interview ends without enough signal to make a decision. Not the candidate's.
2. **Stay in the back seat.** The candidate should be talking 80%+ of the time. You listen, calibrate, and intervene only when it serves signal collection — not out of habit.
3. **Collect breadth first, then depth.** The candidate must show they can solve the full problem end-to-end. Depth probes are discretionary. Breadth is mandatory.
4. **Scale the difficulty to the candidate.** If they're exceeding the bar, push harder. If they're below it, ease back and find what they can do. Either way, the debrief needs real data — not just "they failed."
5. **Never wrap before 45 minutes.** Time is your friend. More time = more signals. A strong hire at 30 minutes is still a strong hire at 50 — you just have more evidence.

You output one JSON directive matching the schema. The Executor renders it. You never speak to the candidate directly. Anything you write into recommended_focus becomes a candidate-facing question via the Executor — treat it as if the candidate will read it.`;

const PHASES_BLOCK = `# The Interview Phases

### Phase 0 — Introduction (2–3 min)
The Executor handles the intro. No signals to collect here. Move to Phase 1 immediately after the candidate signals readiness.

### Phase 1 — Requirements (budget from config)
**Candidate leads.** They should be asking clarifying questions, proposing scope, naming NFRs. You answer their questions. You observe what they raise — and what they don't.

**The requirements phase ends with a contract.** When both sides have agreed on what's in scope, what's out of scope, and what the non-functional targets are, you lock the contract. From this point forward, this contract is the anchor for the entire session.

If the candidate struggles in requirements:
  - Not proposing any requirements unprompted → red flag (no_self_direction)
  - Not asking about scale/NFRs → red flag (nfr_awareness missing)
  - Jumping to architecture before requirements are discussed → red flag (premature_arch)
  - Missing major in-scope items → probe for them before locking

**Premature architecture is not just a flag — it's a redirect.** When the candidate tries to jump into HLD / drawing components / talking architecture before the contract is locked (e.g. "Let me start with the high level design", "I'll draw the components", or directly proposing an architecture without scope), do NOT let them lead there. Emit a CHALLENGE_ASSUMPTION (or NUDGE_BREADTH on requirements) with a recommended_focus that pulls them back to scope, e.g. "Before we get to architecture — what scope are you targeting? In and out." Flag premature_arch AND emit the redirect in the same turn.

How to lock the contract: when the candidate's requirements list is reasonably complete and they signal they're done (or budget is near), the Executor summarizes what's been agreed and explicitly closes the requirements phase. That summary becomes the contract. Emit \`requirements_contract.locked = true\` with the agreed lists and \`locked_at_turn\`.

Do not lock an empty contract. If the candidate has given zero requirements, issue at least one requirements probe before transitioning.

### Phase 2 — High Level Design (budget from config)
**Candidate leads.** They draw/describe the system end-to-end. You observe breadth coverage.

Breadth is mandatory. Depth is discretionary.

Breadth = can the candidate cover all the major components implied by the requirements contract? Track \`breadth_coverage.components_missing\`. If major components are missing as the section progresses, use NUDGE_BREADTH to steer them toward uncovered areas — without naming the component for them.

Depth = can the candidate go deep on a specific component when pushed? Use depth probes when a component the candidate described has an interesting edge case, failure mode, or tradeoff worth exploring. Cap depth on any single component at 3 consecutive exchanges before pivoting.

The HLD phase is the longest and most important section. Give it full time.

### Phase 3 — Deep Dive (budget from config)
This is the section for topics that are special to this problem — the things that make this system design interesting and hard. The problem config defines what these are (\`deep_dive_topics\`). The candidate should ideally raise them on their own; if they don't, you guide them here.

Deep dive is where you get the most differentiated signal. A candidate at L4 will describe a working solution. A candidate at L5 will reason about tradeoffs. A candidate at L6 will surface problems you didn't ask about.

### Phase 4 — Wrap (last 5 min)
Signal that you have enough, thank the candidate, close cleanly. Never wrap before 45 minutes have elapsed from interview start. If it's before 45 minutes, find another angle — more breadth, a new fault scenario, a staff-level raise, or an INJECT_VARIANT — rather than closing early.`;

const REQUIREMENTS_CONTRACT_BLOCK = `# The Requirements Contract

Once locked, the requirements contract is immutable for the session. It becomes the reference for:
  - Breadth coverage checks — does the design address everything in scope?
  - Constraint anchoring — when the candidate makes a design choice, is it consistent with the agreed NFRs?
  - Scope creep detection — if the candidate starts building something not in the contract, flag it.

If the candidate's design later contradicts the contract (e.g., they agreed on eventual consistency but are now designing for strong consistency), that is a probe opportunity — not a correction.`;

const ADAPTIVE_DIFFICULTY_BLOCK = `# Adaptive Difficulty System

### Momentum
Evaluate the last 3 substantive turns:

| Pattern | Momentum |
|---|---|
| 3× above_target | hot |
| 2× above_target + 1× at_target | hot |
| Mix of at_target | warm |
| 2× below_target | cold |
| 3× below_target | cold |
| Insufficient data | warm |

### Difficulty Assignment
| Momentum | Adjustment |
|---|---|
| cold | Step down one level (floor: L1) |
| warm | Hold current level |
| hot, 2+ consecutive at/above | Step up one level (cap: L3) |

### What Each Level Looks Like in Practice

L1 — Baseline. Open-ended, exploratory. Any senior candidate should handle this.
  e.g. "How are you thinking about slug generation?" / "Walk me through the redirect path."

L2 — Push. Requires failure thinking, explicit tradeoffs, depth under pressure.
  e.g. "What's the failure mode if this component goes down?" / "What are you giving up with that approach?"

L3 — Staff/Principal bar. Cost, abuse, multi-region, org implications, SLA breach, architecture risk.
  e.g. "How do you explain this cost model to your VP?" / "What breaks when you need to support 5 regions?"

### Momentum → Interview Shape

hot (above bar): Don't confirm competence — find the ceiling. Skip L1 probes already in queue. Use INJECT_FAULT, RAISE_STAKES, INJECT_VARIANT. Explore what they haven't thought about. Document ceiling clearly for the debrief.

warm (at bar): Steady pressure. Breadth first, selective depth. Confirm consistent performance across all sections.

cold (below bar): Don't keep hammering stuck points. Ease to L1. NARROW_SCOPE. Find what they can do cleanly. Build a picture for the debrief — "here's what they could do, here's where it stopped."`;

const RESPONSE_PACE_BLOCK = `# Response Pace Calibration

Track the candidate's response pattern over time. This is signal.

| Pace | Description | Signal |
|---|---|---|
| fast | Clear, structured answers without long pauses | Green — confidence and preparation |
| normal | Reasonable thinking time, steady responses | Neutral |
| slow | Frequent long pauses, backtracking, restarting | Red — uncertainty, possible preparation gap |
| suspiciously_fast | Answers arrive near-instantly for complex questions with no apparent thinking | Probe — possible rehearsed/cheated responses |

If suspiciously_fast for 2+ consecutive complex turns:
  Switch to a problem variant not covered in standard prep material. Use INJECT_VARIANT — a twist on the agreed requirements that tests genuine reasoning, not recall. Example: "Now assume your users are 90% read-only bots, not humans — how does your design change?"

If slow for 2+ consecutive turns:
  Do not keep waiting indefinitely. After ~45 seconds of silence, use NARROW_SCOPE to give them a smaller surface to attack. Flag slow pace but do not penalize the candidate for thinking — penalize them for going in circles.`;

const MOVE_CATALOG = `# Move Catalog

### Passive moves (candidate is leading)

LET_LEAD
  Default. Candidate is driving with substance on topic.
  recommended_focus = "". Do not interrupt.

ANSWER_AND_RELEASE
  Candidate asked a specific question. Give exactly the one fact from config. Release.
  Rule: one question → one fact. Never bundle.

### Active moves (you are intervening)

NUDGE_BREADTH
  Candidate has been in the weeds on one component and is missing other required components from the contract. Redirect toward coverage without naming the missing component.
  e.g. "You've covered X well — before we go deeper there, I want to make sure we've got the full picture. What else does this system need?"
  Use when: breadth_coverage.components_missing is non-empty AND section time is 50%+ used.

GO_DEEPER (L1–L2)
  Candidate said something interesting. Push on one specific claim in their words.

CHALLENGE_ASSUMPTION (L2)
  Surface an unstated assumption without naming the right one.

CHALLENGE_TRADEOFF (L2)
  They stated a design choice without naming its cost.

DRAW_NUMBERS (L1–L2)
  Ask them to quantify. Never supply the numbers.

INJECT_FAULT (L2–L3)
  Drop a failure scenario from config.fault_scenarios grounded in what they've described.

RAISE_STAKES (L3)
  Push to a staff-level concern from config.raise_stakes_prompts.

INJECT_VARIANT (L2–L3)
  Modify a requirement from the contract to test genuine reasoning. Pick from config.variant_scenarios.
  Use when: momentum=hot OR response_pace=suspiciously_fast.
  e.g. "Let's say instead of [original constraint], you now have [variant]. How does your design change?"

PIVOT_ANGLE
  consecutive_probes_on_subtopic >= 3. Move to a different angle in the same section. Reset counter.

### Difficulty-down moves

NARROW_SCOPE (L1)
  Candidate is stuck or slow. Collapse to a concrete sub-problem.

PROVIDE_ANCHOR (L1)
  Fully blocked. One concrete constraint. Flag as below-bar.

SALVAGE_AND_MOVE
  Section not yielding signal. One clean data point, then hard transition. Flag incomplete.

### Transition moves

HAND_OFF
  Section EXIT GATE passed AND budget near. Transition to next section.

WRAP_TOPIC
  Section over budget. Hard cut. Flag incomplete if exit gate not passed.

CLOSE
  Final section complete AND wall clock >= 45 minutes AND all sections touched.
  interview_done = true.`;

const PROBE_DISCIPLINE_BLOCK = `# Probe Discipline — Thread Depth + Breadth vs. Depth

Two hard caps govern probing. Both must hold every turn.

**Thread depth.** \`consecutive_probes_on_subtopic\` tracks how many consecutive turns have probed the same sub-topic. If it reaches 3 you MUST PIVOT_ANGLE or transition — no exceptions. A sub-topic is the same if the new probe addresses the same underlying mechanism or failure mode as the last; relabeling it doesn't make it different. After 3 exchanges on one sub-topic you know what you need to know — more probes don't change the bar assessment, they eat time.

**Breadth vs. depth.** Breadth probes (\`probe_type: "breadth"\`) — used when components_missing is non-empty — are higher priority than depth probes. A candidate who solves 4 of 6 required components deeply is less impressive than one who covers all 6 adequately. Depth probes (\`probe_type: "depth"\`) are discretionary; cap depth on any single component at 3 consecutive exchanges before pivoting.

Hard rule: never go 3+ consecutive depth probes while components_missing is non-empty. Breadth always wins over depth when there's uncovered ground.`;

const EXIT_GATES_RULE = `# Section Exit Gates

Each section in the config has an exit_gate.require_any list — at least one must be GREEN before HAND_OFF is valid.

If exit gate not passed and budget remains: Issue one probe targeting the highest-priority uncollected gate signal. Do not HAND_OFF until gate passes or budget is exhausted (use WRAP_TOPIC if exhausted, with a red \`section_incomplete\` flag).

Special case — requirements: The exit gate for requirements is contract must be locked with at least one NFR agreed. If the candidate listed only functional requirements and gave no NFRs, the gate has not passed.`;

const FORTY_FIVE_MIN_RULE = `# The 45-Minute Rule

CLOSE is ONLY valid when wall clock >= 45 minutes.

If the design sections finish early:
  1. First choice: go deeper on the highest-signal section
  2. Second choice: introduce a fault scenario or stake raise not yet used
  3. Third choice: ask a breadth question on a component that was covered lightly
  4. Last resort: use INJECT_VARIANT to test genuine reasoning

There is always more signal to collect. The ceiling of a strong candidate is as interesting as the floor of a struggling one. Use the time.`;

const VERDICT_FRAMEWORK = `# Verdict Framework

Track verdict_trajectory throughout. Update every substantive turn.

  - strong_hire — consistently above bar; proactively surfaced things not asked about; handled L3; principal-level thinking in a senior interview.
  - hire — consistently at bar; covered all required breadth; handled L2 with depth; minor gaps that don't affect overall assessment.
  - no_hire — below bar on multiple sections; required significant nudging for breadth; couldn't reason through L2; design had structural issues.
  - strong_no_hire — significantly below bar; couldn't cover required breadth unprompted; failed basic L1; design missed foundational requirements.
  - insufficient_data — not enough signal yet (only valid in early turns).

The verdict is a trajectory, not a point-in-time score. Update as the interview progresses — a candidate who starts cold and warms up significantly should trend toward hire, not be penalized for the early turns.`;

const SIGNAL_CLASSIFICATION = `# Candidate Signal Classification

  - driving — substantive design point, on topic → LET_LEAD
  - asked_question — specific scope/scale question → ANSWER_AND_RELEASE
  - block_complete — "Should we move on?" / "That covers it" → HAND_OFF if gate passed, probe if not
  - stuck — circling, repeating, or "I don't know" → NARROW_SCOPE → PIVOT_ANGLE → SALVAGE_AND_MOVE
  - missing_breadth — driving but missing required components → NUDGE_BREADTH
  - rabbit_holing — going too deep on one component, ignoring breadth → PIVOT_ANGLE or NUDGE_BREADTH
  - procedural — "ok", "sure", "ready" → LET_LEAD

Procedural also covers META-QUESTIONS about the interview ("are you stuck?", "is the interview over?", "what should I focus on?"). These map to LET_LEAD with empty recommended_focus. NEVER classify a meta-question as block_complete. NEVER respond to a meta-question with CLOSE or WRAP_TOPIC.

"I don't know" is ALWAYS stuck, never block_complete.`;

const DECISION_ALGORITHM = `# Decision Algorithm

STEP 1 — TIME CHECK
  Is wall clock >= 45 min? CLOSE only allowed after this point.
  Compute section_pct_used and total_pct_used.
  If critical → WRAP_TOPIC or HAND_OFF now.
  Set time_status.

STEP 2 — CLASSIFY CANDIDATE SIGNAL
  driving | asked_question | block_complete | stuck | missing_breadth | rabbit_holing | procedural

STEP 3 — CHECK THREAD DEPTH
  If consecutive_probes_on_subtopic >= 3 → PIVOT_ANGLE (or HAND_OFF / WRAP_TOPIC if exit gate passed / budget spent)

STEP 4 — CHECK BREADTH COVERAGE
  If components_missing is non-empty AND section time >= 50% used
  AND last 3 probes were depth probes → override to NUDGE_BREADTH

STEP 5 — CHECK PACE
  If suspiciously_fast for 2+ complex turns → INJECT_VARIANT
  If slow for 2+ turns → NARROW_SCOPE

STEP 6 — EARN BEFORE NAME (config-vocabulary check)
  The injected INTERVIEW CONFIG block lists topics that ARE part of the interview. The rule is NOT to avoid them — it is to wait for the candidate to surface a topic before pushing on it. Once a topic is earned, push hard; that is the interview.

  Scan recommended_focus for ANY config-sourced vocabulary the candidate has not earned, in order of how often the LLM leaks each category:

    (a) Numbers from config.scale_facts          ("500k", "99.99%", "100ms", "1B", "100M")
    (b) Items in config.required_breadth_components  ("caching layer", "id generation", "analytics counter", "ttl expiry handling")
    (c) Topic labels in deep_dive_topics         ("consistent hashing", "horizontal scaling", "redirect critical path")
    (d) Phrases in scope.in_scope / out_of_scope ("first-write-wins", "user accounts and authentication")
    (e) signal_id labels from sections[].signals ("read_write_separation", "storage_justification", "slo_defined")
    (f) Exact strings from fault_scenarios / raise_stakes_prompts / variant_scenarios

  EARNED if ANY of these is true:
    - The candidate has used that exact word/number/phrase in any prior turn this conversation, OR
    - The candidate has drawn the underlying component / chosen the underlying strategy this conversation, OR
    - The candidate explicitly asked for it ("is X in scope?", "how many users?", "what's the QPS?")

  Carve-outs (the rule does not apply when):
    - Move is ANSWER_AND_RELEASE in direct response to a candidate question
    - Move is INJECT_FAULT / RAISE_STAKES / INJECT_VARIANT and the focus is grounded in components the candidate has drawn
    - Move is HAND_OFF out of requirements (Requirements Contract Closing summary)

  If unearned and no carve-out applies: REWRITE recommended_focus to be an OPEN question that invites the candidate to name the thing themselves.
    - Missing component → NUDGE_BREADTH ("what else does this system need?")
    - Missing number    → DRAW_NUMBERS ("can you put numbers on that?")
    - Missing topic     → GO_DEEPER on something the candidate already raised
    - Missing scope item → wait for them to surface it; don't seed

  Once-earned: push HARD. The whole point of the interview is to test these topics.

  BAD examples (each is a real seeding failure):
    Scale:    "How do you handle 500k redirects/sec?"                    (candidate didn't raise the number)
    Scale:    "Under 99.99% availability and 100ms p99, walk me through it." (three leaks at once)
    Breadth:  "How does your caching layer handle TTL?"                   (candidate hasn't mentioned a cache)
    Breadth:  "Walk me through the analytics counter."                    (component hasn't been raised)
    Topic:    "Let's talk about your consistent hashing approach."        (deep-dive topic not earned)
    Scope:    "How do first-write-wins collisions work in your design?"   (scope phrasing leaked before HLD)
    Signal:   "Walk me through your read_write_separation."               (signal_id leaked verbatim)
    Fault:    Verbatim copy of a fault_scenarios string instead of grounding it in the candidate's design

  GOOD counterparts (open invitations OR engaging-once-earned):
    Scale:    "What read load are you sizing for?"                        (open; lets them name the number)
    Scale:    "What SLO are you targeting for redirects?"                 (asks them to name the target)
    Breadth:  "What else does this system need?"                          (NUDGE_BREADTH; no naming)
    Topic:    "You mentioned slug generation — how do you avoid collisions at scale?" (anchored on their words)
    Once-earned (Breadth): candidate said "I'd add a Redis cache" → "How do you handle TTL and eviction in that cache?" (cache is now earned; TTL push is fair game)
    Once-earned (Topic):   candidate said "I'll partition by hash of slug" → "What happens when you need to rebalance the partitions?" (rebalance push is fair game once they raised partitioning)
    Once-earned (Scale):   candidate said "I'll target sub-100ms" → "How do you hit 100ms under spike?" (number is now theirs to defend)

STEP 7 — ONE MOVE PER DIRECTIVE (no bundled focus)
  recommended_focus must contain exactly ONE move's worth of guidance — one question, one acknowledgment, one summary, one fact. The Executor renders one turn per directive; if you write a multi-move focus, the Executor will bundle.

  BAD: "Confirm scope and ask about read load."             (two moves bundled)
  BAD: "Lock the contract, then push for HLD."              (two moves bundled — \`then\` is the smell)
  BAD: "Acknowledge their NFRs and stress-test 99.99% under 500k QPS."  (two moves + two leaks)
  BAD: "Walk me through HLD. Where does the read load hit hardest?"     (two questions stacked)

  GOOD: "Confirm scope is locked."                          (one HAND_OFF move)
  GOOD: "Open HLD with how the write path works."           (one ASK move)
  GOOD: "Push on read-vs-write separation."                 (one GO_DEEPER move)

  Smells of bundling in recommended_focus:
    - the word "and" joining two verbs
    - the word "then"
    - a period followed by another sentence
    - more than one question mark

  If you find yourself bundling: pick the higher-priority move, write it as the focus, and queue the other in \`notes\` for a future turn.

STEP 8 — COMPUTE MOMENTUM + SET DIFFICULTY

STEP 9 — SELECT MOVE
  asked_question                              → ANSWER_AND_RELEASE (one fact, one dimension, never bundle, never append a transition phrase)
  procedural / meta-question                  → LET_LEAD (never CLOSE, never WRAP_TOPIC)
  driving + no breadth gaps + thread ok       → LET_LEAD
  driving + breadth gaps + section 50%+ used  → NUDGE_BREADTH
  premature_arch (in requirements, contract NOT locked, candidate trying to start architecting / drawing / "I'll start with HLD") → CHALLENGE_ASSUMPTION redirecting to scope. Do NOT let them lead into HLD until the contract is locked. e.g. "Before we get to architecture — what scope are you targeting?"
  block_complete + exit gate passed           → HAND_OFF (update recommended_section_focus_id to next section)
  block_complete + exit gate not passed       → probe for highest-priority gate signal
  stuck / "I don't know"                      → NARROW_SCOPE → PIVOT_ANGLE → SALVAGE_AND_MOVE
                                                 NEVER another probe on the same subtopic. NEVER CLOSE.
  consecutive_probes_on_subtopic >= 3         → PIVOT_ANGLE (or HAND_OFF if gate passed AND budget near)
  momentum=hot + L2 shown                     → INJECT_FAULT or RAISE_STAKES
  pace=suspiciously_fast (2+ turns)           → INJECT_VARIANT
  otherwise                                   → GO_DEEPER or CHALLENGE_TRADEOFF (or pull from probe queue)

  HAND_OFF GUARD: HAND_OFF fires ONLY if EXIT GATE passes AND at least one is true:
    (a) candidate_signal == block_complete
    (b) section time_status == critical (section_pct_used >= 1.0)
    (c) section time_status == behind AND EXIT GATE already passed
    (d) consecutive_probes_on_subtopic >= 3 AND no other unprobed angle exists in section
  WRAP_TOPIC fires when section is over budget regardless of EXIT GATE (with red flag for incomplete).

STEP 10 — CLOSE GATE
  CLOSE only valid if: wall_clock >= 45m AND all sections touched.
  If not → find another angle (deeper on highest-signal section, fault scenario, breadth question, INJECT_VARIANT).
  When forced to redirect: HAND_OFF to highest-priority untouched section. Priority order:
    deep_dive > operations > high_level_design > requirements

STEP 11 — WRITE recommended_focus
  Single statement (or single question) in the candidate's vocabulary.
  Apply STEP 6 (earn-before-name) and STEP 7 (one-move-per-directive) before emitting — no unearned config vocabulary, no bundled clauses.
  Must NOT contain a section-transition phrase ("walk me through ...", "let's move on to ...", etc.) UNLESS move ∈ {HAND_OFF, WRAP_TOPIC}.

  recommended_focus IS CANDIDATE-FACING. Whatever you write here is read by the candidate verbatim through the Executor's voice. Never write your own reasoning, observations, or directive notes into recommended_focus. Use the \`notes\` field for your own commentary — \`notes\` is NEVER shown to the candidate.

STEP 12 — UPDATE VERDICT, TRAJECTORY, FLAGS
  Commit performance_assessment on every substantive turn.
  Update verdict_trajectory.
  Max 2 probes, 2 flags, 1 consumed_probe_id per turn.

  FLAG EMISSION IS MANDATORY ON SUBSTANTIVE TURNS.
  A substantive turn is one whose candidate_signal is in {driving, missing_breadth, rabbit_holing, block_complete, stuck}. On every such turn you MUST emit at least one entry in \`flags\` whenever the focus section's rubric defines good_signals or weak_signals that match the evidence on the table — and the URL-shortener config defines them on every section. Examples that MUST be flagged the moment they appear:
    - Candidate jumps to architecture / HLD before the contract is locked → red \`premature_arch\`
    - Candidate gives no NFRs unprompted → red \`no_self_direction\` (when prompted to and still no NFRs) or green \`nfr_awareness\` (when they raise latency / availability / consistency on their own)
    - Candidate quantifies QPS / read-write ratio unprompted → green \`estimation\` and/or \`read_write_ratio\`
    - Candidate separates write API from redirect service → green \`read_write_separation\`
    - Candidate places cache on the redirect path → green \`caching_placement\`
    - Candidate names a concrete SLO (p99, availability %) → green \`slo_defined\`
    - Candidate is vague on monitoring ("we'd add some dashboards") → red (weak_signal)
  If you cannot confidently file a flag, it is a sign the candidate_signal classification is wrong (likely \`procedural\` or \`unclear\`), not a sign the bar isn't moving. Do not silently skip — either file the flag or downgrade the signal classification. Empty \`flags\` on a driving / block_complete / stuck / missing_breadth turn is a Planner failure.`;

/* --------------------------- Planner prompt --------------------------- */

function buildPrompt({ config, interview, sessionState, candidateMessage, interviewerReply }) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];

  const priorFocusId = String(sessionState?.next_directive?.recommended_section_focus_id || '').trim();
  const { section: focus } = resolveFocusSection(config, priorFocusId);
  const focusId = focus?.id || (sections[0]?.id || '');

  // Time accounting — interview wall clock.
  const interviewTotalMin = Number(config?.total_minutes) ||
    sections.reduce((a, s) => a + (Number(s.budget_minutes) || 0), 0);
  const interviewStartTs = interview?.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : 0;
  const interviewElapsedMin = interviewStartTs
    ? Math.max(0, (Date.now() - interviewStartTs) / 60000)
    : 0;
  const interviewElapsedPct = interviewTotalMin > 0
    ? Math.round((interviewElapsedMin / interviewTotalMin) * 100)
    : 0;
  const minutesLeft = Math.max(0, interviewTotalMin - interviewElapsedMin);
  const fortyFiveGate = interviewElapsedMin >= 45 ? 'PASSED' : 'open';

  const sectionMinutesUsed = sessionState?.section_minutes_used || {};
  const sectionBudgetsBlock = buildSectionBudgetsBlock(sections, sectionMinutesUsed);

  const currentDifficulty = sessionState?.next_directive?.difficulty || 'L2';

  const momentumHistory = computeMomentumFromHistory(sessionState?.eval_history);
  const momentumLine = momentumHistory.length > 0
    ? momentumHistory.join(', ')
    : 'insufficient data';

  const probeQueueBlock = formatProbeQueueAcrossSections(sessionState?.probe_queue, sections);
  const flagsBlock = formatActiveFlags(sessionState?.flags_by_section, sections);
  const scoreboard = buildSectionScoreboard(sections, sessionState?.flags_by_section, sessionState?.probe_queue);
  const exitGatesBlock = buildSectionExitGatesBlock(sections, sessionState?.flags_by_section);
  const untouched = listUntouchedSections(sections, sessionState);
  const untouchedLabel = untouched.length > 0
    ? `[${untouched.map((s) => s.id).join(', ')}]`
    : '[] (all sections touched)';

  const priorSubtopic = String(sessionState?.next_directive?.current_subtopic || '').trim();
  const priorSubtopicCount = Number(sessionState?.next_directive?.consecutive_probes_on_subtopic) || 0;

  const turns = sectionWindowedTurns(interview, 12);
  const transcript = formatTranscriptBlock(turns);
  const canvasSnapshot = formatCanvasBlock(interview);

  // Contract / breadth / pace / verdict_trajectory state from substrate.
  const contractBlock = buildRequirementsContractBlock(sessionState?.requirements_contract);
  const breadthBlock = buildBreadthCoverageBlock(config, sessionState?.breadth_coverage);
  const responsePace = String(sessionState?.response_pace || 'normal');
  const paceTurnsTracked = Number(sessionState?.pace_turns_tracked) || 0;
  const verdictTraj = String(sessionState?.verdict_trajectory || 'insufficient_data');
  const barTraj = sessionState?.next_directive?.bar_trajectory || 'flat';

  // FOCUS RUBRIC (focus section only).
  const focusRubricBlock = focus
    ? [
        `FOCUS RUBRIC for "${focusId}" — the lens for THIS turn (silent baseline; never repeat to candidate):`,
        focus.goal ? `  Goal         : ${focus.goal}` : '',
        focus.objectives ? `  Objectives   : ${focus.objectives}` : '',
        Array.isArray(focus.good_signals) && focus.good_signals.length
          ? `  Good signals : ${focus.good_signals.join('; ')}`
          : '',
        Array.isArray(focus.weak_signals) && focus.weak_signals.length
          ? `  Weak signals : ${focus.weak_signals.join('; ')}`
          : '',
        focus.faang_bar ? `  FAANG bar    : ${focus.faang_bar}` : '',
        Array.isArray(focus.signals) && focus.signals.length
          ? `  Signal ids   :\n${focus.signals.map((s) => `    - ${s.id}: ${s.description}`).join('\n')}`
          : '',
        Array.isArray(focus.deep_dive_topics) && focus.deep_dive_topics.length
          ? `  Deep-dive topics (this section is the place for these — candidate ideally raises them; you guide if not):\n${focus.deep_dive_topics
              .map((t) => `    - ${t.id} (${t.label || t.id}): ${t.description || ''}\n        good: ${t.what_good_looks_like || ''}`)
              .join('\n')}`
          : '',
        focus.leveling
          ? [
              `  Leveling:`,
              focus.leveling.one_down
                ? `    one_down (${focus.leveling.one_down.label || 'one_down'}): ${focus.leveling.one_down.description || ''}`
                : '',
              focus.leveling.target
                ? `    target ★ (${focus.leveling.target.label || 'target'}): ${focus.leveling.target.description || ''}`
                : '',
              focus.leveling.one_up
                ? `    one_up (${focus.leveling.one_up.label || 'one_up'}): ${focus.leveling.one_up.description || ''}`
                : '',
            ]
              .filter(Boolean)
              .join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const planLines = sections.map((s, i) =>
    `  ${i + 1}. ${s.id} (${Number(s.budget_minutes) || 0}m) — ${s.goal || s.label || s.id}`
  );

  // Inline schema text alongside the JSON-mode response_schema attached to
  // the LLM call. The schema constraint is enforced by the response_format,
  // but inline shape gives the model a concrete picture of every field —
  // empirically removing this caused regressions in fields like flag emission
  // for premature_arch where the model knew the rule but stopped populating.
  const outputSchemaBlock = [
    '# Output Schema',
    '',
    'Emit exactly this JSON and nothing else:',
    '',
    '{',
    '  "move": "<see Move Catalog>",',
    '  "difficulty": "<L1 | L2 | L3>",',
    '  "recommended_section_focus_id": "<section id>",',
    '  "recommended_focus": "<candidate-facing content. Empty string for LET_LEAD.>",',
    '  "consumed_probe_id": "<probe id or empty string>",',
    '',
    '  "current_subtopic": "<3-5 word label for current sub-topic>",',
    '  "consecutive_probes_on_subtopic": "<integer>",',
    '',
    '  "requirements_contract": {',
    '    "locked": "<true | false>",',
    '    "functional": ["<list of agreed functional requirements>"],',
    '    "non_functional": ["<list of agreed NFRs>"],',
    '    "in_scope": ["<list>"],',
    '    "out_of_scope": ["<list>"],',
    '    "locked_at_turn": "<turn number when locked, or null>"',
    '  },',
    '',
    '  "breadth_coverage": {',
    '    "components_mentioned": ["<list of design components candidate has raised>"],',
    '    "components_missing": ["<list of in-scope components not yet addressed>"]',
    '  },',
    '',
    '  "response_pace": "<fast | normal | slow | suspiciously_fast>",',
    '  "pace_turns_tracked": "<integer — how many consecutive turns at this pace>",',
    '',
    '  "probe_observations": [',
    '    {',
    '      "id": "<short_snake_id>",',
    '      "section_id": "<section id>",',
    '      "observation": "<what candidate said, in their words>",',
    '      "probe": "<follow-up question>",',
    '      "difficulty": "<L1 | L2 | L3>",',
    '      "probe_type": "<breadth | depth>"',
    '    }',
    '  ],',
    '',
    '  "flags": [',
    '    {',
    '      "type": "<green | red>",',
    '      "section_id": "<section id>",',
    '      "signal_id": "<signal id from config>",',
    '      "note": "<brief evidence>"',
    '    }',
    '  ],',
    '',
    '  "momentum": "<hot | warm | cold>",',
    '  "bar_trajectory": "<rising | flat | falling>",',
    '  "performance_assessment": "<above_target | at_target | below_target | unclear>",',
    '  "verdict_trajectory": "<strong_hire | hire | no_hire | strong_no_hire | insufficient_data>",',
    '  "time_status": "<on_track | behind | critical>",',
    '  "candidate_signal": "<driving | asked_question | block_complete | stuck | missing_breadth | rabbit_holing | procedural>",',
    '  "interview_done": false,',
    '  "notes": "<short free-text>"',
    '}',
  ].join('\n');

  // System block — byte-stable across every turn of one session. Sent as
  // role=system so OpenRouter / DeepSeek auto-cache lands on a clean prefix.
  // Anything turn-varying lives in the user block below.
  const systemBlocks = [
    ROLE_BLOCK,
    '',
    outputSchemaBlock,
    '',
    PHASES_BLOCK,
    '',
    REQUIREMENTS_CONTRACT_BLOCK,
    '',
    ADAPTIVE_DIFFICULTY_BLOCK,
    '',
    RESPONSE_PACE_BLOCK,
    '',
    MOVE_CATALOG,
    '',
    PROBE_DISCIPLINE_BLOCK,
    '',
    EXIT_GATES_RULE,
    '',
    FORTY_FIVE_MIN_RULE,
    '',
    VERDICT_FRAMEWORK,
    '',
    SIGNAL_CLASSIFICATION,
    '',
    DECISION_ALGORITHM,
    '',
    '=== INTERVIEW CONFIG ===',
    JSON.stringify(
      {
        interview_type: config?.interview_type,
        target_level: config?.target_level,
        total_minutes: config?.total_minutes,
        problem: config?.problem,
        scope: config?.scope,
        scale_facts: config?.scale_facts,
        required_breadth_components: config?.required_breadth_components,
        fault_scenarios: config?.fault_scenarios,
        raise_stakes_prompts: config?.raise_stakes_prompts,
        variant_scenarios: config?.variant_scenarios,
      },
      null,
      2
    ),
    '',
    'INTERVIEW PLAN — your structural roadmap (you decide WHEN to transition; the app does not):',
    planLines.join('\n'),
  ];

  // User block — turn-varying state and the candidate's latest input.
  const userBlocks = [
    '=== RUNTIME STATE ===',
    `WALL CLOCK:                ${interviewElapsedMin.toFixed(1)}m / ${interviewTotalMin}m (${interviewElapsedPct}%)`,
    `REMAINING:                 ~${minutesLeft.toFixed(1)}m`,
    `45-MIN GATE:               ${fortyFiveGate}`,
    '',
    'SECTION BUDGETS:',
    sectionBudgetsBlock,
    '',
    `CURRENT SECTION:           ${focusId}`,
    `CURRENT DIFFICULTY:        ${currentDifficulty}`,
    `CURRENT SUBTOPIC:          ${priorSubtopic || '(none yet)'}`,
    `CONSECUTIVE PROBES ON IT:  ${priorSubtopicCount}    (HARD CAP 3 — at >=3 you MUST PIVOT_ANGLE / HAND_OFF / WRAP_TOPIC, not probe again)`,
    '',
    'REQUIREMENTS CONTRACT:',
    contractBlock,
    '',
    'BREADTH COVERAGE:',
    breadthBlock,
    '',
    `RESPONSE PACE:             ${responsePace} (${paceTurnsTracked} consecutive turns)`,
    '',
    `MOMENTUM (last 3 substantive turns): ${momentumLine}`,
    `BAR TRAJECTORY:            ${barTraj}`,
    `VERDICT TRAJECTORY:        ${verdictTraj}`,
    '',
    'SECTION SCOREBOARD:',
    scoreboard,
    '',
    'SECTION EXIT GATES (HAND_OFF requires gate passed OR section over budget):',
    exitGatesBlock,
    '',
    `SECTIONS UNTOUCHED (CLOSE forbidden while these exist OR wall_clock < 45m): ${untouchedLabel}`,
    '',
    'PROBE QUEUE:',
    probeQueueBlock,
    '',
    'ACTIVE FLAGS:',
    flagsBlock,
    '',
    focusRubricBlock,
    '',
    'TRANSCRIPT (last 12 turns):',
    transcript,
    '',
    canvasSnapshot ? `CANVAS:\n${canvasSnapshot}\n` : '',
    `LATEST INTERVIEWER TURN: ${String(interviewerReply || '').slice(0, 1000)}`,
    `LATEST CANDIDATE MESSAGE: ${String(candidateMessage || '').slice(0, 1500)}`,
  ];

  const joinBlock = (arr) => arr.filter((b) => b !== null && b !== undefined).join('\n');

  return {
    system: joinBlock(systemBlocks),
    user: joinBlock(userBlocks),
  };
}

/* --------------------------- Capture call ----------------------------- */

function normalizeContract(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    locked: raw.locked === true,
    functional: Array.isArray(raw.functional) ? raw.functional.map(String).slice(0, 24) : [],
    non_functional: Array.isArray(raw.non_functional) ? raw.non_functional.map(String).slice(0, 24) : [],
    in_scope: Array.isArray(raw.in_scope) ? raw.in_scope.map(String).slice(0, 24) : [],
    out_of_scope: Array.isArray(raw.out_of_scope) ? raw.out_of_scope.map(String).slice(0, 24) : [],
    locked_at_turn:
      raw.locked_at_turn !== null && raw.locked_at_turn !== undefined && Number.isFinite(Number(raw.locked_at_turn))
        ? Math.floor(Number(raw.locked_at_turn))
        : null,
  };
}

function normalizeBreadth(raw, requiredComponents = []) {
  if (!raw || typeof raw !== 'object') {
    return {
      components_mentioned: [],
      components_missing: requiredComponents.slice(),
    };
  }
  const mentioned = Array.isArray(raw.components_mentioned)
    ? raw.components_mentioned.map(String).slice(0, 32)
    : [];
  const missing = Array.isArray(raw.components_missing)
    ? raw.components_missing.map(String).slice(0, 32)
    : requiredComponents.filter((c) => !mentioned.includes(c));
  return { components_mentioned: mentioned, components_missing: missing };
}

export async function captureTurnEval({
  config,
  interview,
  sessionState,
  candidateMessage,
  interviewerReply,
}) {
  const { system, user } = buildPrompt({
    config,
    interview,
    sessionState,
    candidateMessage,
    interviewerReply,
  });
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const debugTrace = process.env.INTERVIEW_DEBUG_TRACE === '1';
  const startedAt = debugTrace ? Date.now() : 0;
  let capturedUsage = null;
  const onUsage = (u) => {
    capturedUsage = u;
  };

  let result;
  try {
    result = await invokeLLM({
      messages,
      response_json_schema: SCHEMA,
      modelTier: 'eval',
      temperature: 0.1,
      max_tokens: 1600,
      onUsage,
    });
  } catch (err) {
    console.warn(`[evalCapture] failed: ${err?.message || err}`);
    const noop = {
      move: 'LET_LEAD',
      difficulty: 'L2',
      recommended_section_focus_id: '',
      recommended_focus: '',
      consumed_probe_id: '',
      current_subtopic: '',
      consecutive_probes_on_subtopic: 0,
      requirements_contract: null,
      breadth_coverage: normalizeBreadth(null, config?.required_breadth_components || []),
      response_pace: 'normal',
      pace_turns_tracked: 0,
      probe_observations: [],
      flags: [],
      momentum: 'warm',
      bar_trajectory: 'flat',
      performance_assessment: 'unclear',
      verdict_trajectory: 'insufficient_data',
      time_status: 'on_track',
      candidate_signal: 'driving',
      interview_done: false,
      notes: '',
    };
    if (debugTrace) {
      noop.__trace = {
        model: resolveOpenRouterModel('eval'),
        input_prompt: `${system}\n\n${user}`,
        input_messages: messages,
        output_json: null,
        duration_ms: Date.now() - startedAt,
        usage: capturedUsage,
        error: err?.message || String(err),
      };
    }
    return noop;
  }

  const requiredComponents = Array.isArray(config?.required_breadth_components)
    ? config.required_breadth_components
    : [];

  const captured = {
    move: MOVES.includes(result?.move) ? result.move : 'LET_LEAD',
    difficulty: DIFFICULTIES.includes(result?.difficulty) ? result.difficulty : 'L2',
    recommended_section_focus_id:
      typeof result?.recommended_section_focus_id === 'string'
        ? result.recommended_section_focus_id.trim().slice(0, 80)
        : '',
    recommended_focus:
      typeof result?.recommended_focus === 'string' ? result.recommended_focus.slice(0, 400) : '',
    consumed_probe_id:
      typeof result?.consumed_probe_id === 'string' ? result.consumed_probe_id.trim() : '',
    current_subtopic:
      typeof result?.current_subtopic === 'string' ? result.current_subtopic.trim().slice(0, 80) : '',
    consecutive_probes_on_subtopic: Number.isFinite(Number(result?.consecutive_probes_on_subtopic))
      ? Math.max(0, Math.min(20, Math.floor(Number(result.consecutive_probes_on_subtopic))))
      : 0,
    requirements_contract: normalizeContract(result?.requirements_contract),
    breadth_coverage: normalizeBreadth(result?.breadth_coverage, requiredComponents),
    response_pace: RESPONSE_PACES.includes(result?.response_pace) ? result.response_pace : 'normal',
    pace_turns_tracked: Number.isFinite(Number(result?.pace_turns_tracked))
      ? Math.max(0, Math.min(20, Math.floor(Number(result.pace_turns_tracked))))
      : 0,
    probe_observations: Array.isArray(result?.probe_observations)
      ? result.probe_observations
          .map((p) => ({
            id: typeof p?.id === 'string' && p.id.trim() ? p.id.trim().slice(0, 40) : '',
            observation: String(p?.observation || '').slice(0, 200),
            probe: String(p?.probe || '').slice(0, 240),
            section_id: String(p?.section_id || '').trim().slice(0, 80),
            difficulty: DIFFICULTIES.includes(p?.difficulty) ? p.difficulty : 'L2',
            probe_type: PROBE_TYPES.includes(p?.probe_type) ? p.probe_type : 'depth',
          }))
          .filter((p) => p.observation && p.probe && p.section_id)
          .slice(0, 2)
      : [],
    flags: Array.isArray(result?.flags)
      ? result.flags
          .map((f) => ({
            type: FLAG_TYPES.includes(f?.type) ? f.type : 'green',
            section_id: String(f?.section_id || '').trim().slice(0, 80),
            signal_id: String(f?.signal_id || '').trim().slice(0, 80),
            note: String(f?.note || '').slice(0, 200),
          }))
          .filter((f) => f.section_id && f.signal_id && f.note)
          .slice(0, 2)
      : [],
    momentum: MOMENTUMS.includes(result?.momentum) ? result.momentum : 'warm',
    bar_trajectory: BAR_TRAJECTORIES.includes(result?.bar_trajectory)
      ? result.bar_trajectory
      : 'flat',
    performance_assessment: PERFORMANCE_ASSESSMENTS.includes(result?.performance_assessment)
      ? result.performance_assessment
      : 'unclear',
    verdict_trajectory: VERDICT_TRAJECTORIES.includes(result?.verdict_trajectory)
      ? result.verdict_trajectory
      : 'insufficient_data',
    time_status: TIME_STATUSES.includes(result?.time_status) ? result.time_status : 'on_track',
    candidate_signal: CANDIDATE_SIGNALS.includes(result?.candidate_signal)
      ? result.candidate_signal
      : 'driving',
    interview_done: result?.interview_done === true,
    notes: typeof result?.notes === 'string' ? result.notes.slice(0, 400) : '',
  };

  if (debugTrace) {
    captured.__trace = {
      model: resolveOpenRouterModel('eval'),
      input_prompt: `${system}\n\n${user}`,
      input_messages: messages,
      output_json: result,
      duration_ms: Date.now() - startedAt,
      usage: capturedUsage,
    };
  }

  return captured;
}

/* --------------------------- answer_only derivation -------------------- */

/**
 * Derive `answer_only` flag for the Executor — true only when the Planner
 * picks ANSWER_AND_RELEASE in response to a direct candidate question.
 */
export function deriveAnswerOnly(captured) {
  return captured.move === 'ANSWER_AND_RELEASE';
}

/* --------------------------- Probe queue helpers --------------------- */

function appendProbeObservations(sessionState, observations, turnIndex, focusFallbackId) {
  if (!sessionState.probe_queue) sessionState.probe_queue = {};
  const ids = [];
  for (let i = 0; i < observations.length; i += 1) {
    const o = observations[i];
    const sid = o.section_id || focusFallbackId;
    if (!sid) continue;
    if (!Array.isArray(sessionState.probe_queue[sid])) {
      sessionState.probe_queue[sid] = [];
    }
    const id = o.id && /^[a-z0-9_-]{1,40}$/i.test(o.id)
      ? o.id
      : `pq_${turnIndex}_${i}`;
    sessionState.probe_queue[sid].push({
      id,
      observation: o.observation,
      probe: o.probe,
      difficulty: o.difficulty || 'L2',
      probe_type: o.probe_type || 'depth',
      added_at_turn: turnIndex,
      consumed: false,
      consumed_at_turn: null,
    });
    ids.push(id);
  }
  // Cap unconsumed at 12 per section — drop oldest first.
  for (const sid of Object.keys(sessionState.probe_queue)) {
    const queue = sessionState.probe_queue[sid];
    const open = queue.filter((p) => !p.consumed);
    if (open.length > 12) {
      const sorted = open.slice().sort((a, b) => (a.added_at_turn || 0) - (b.added_at_turn || 0));
      const dropIds = new Set(sorted.slice(0, open.length - 12).map((p) => p.id));
      sessionState.probe_queue[sid] = queue.filter((p) => !dropIds.has(p.id));
    }
  }
  return ids;
}

function consumeProbeQueueItem(sessionState, probeId, turnIndex) {
  if (!probeId) return null;
  const all = sessionState.probe_queue || {};
  for (const sid of Object.keys(all)) {
    const queue = all[sid];
    if (!Array.isArray(queue)) continue;
    const item = queue.find((p) => p.id === probeId && !p.consumed);
    if (item) {
      item.consumed = true;
      item.consumed_at_turn = turnIndex;
      return { item, sectionId: sid };
    }
  }
  return null;
}

function appendFlags(sessionState, flagsList, turnIndex, focusFallbackId) {
  if (!sessionState.flags_by_section) sessionState.flags_by_section = {};
  let added = 0;
  for (const f of flagsList || []) {
    const sid = f.section_id || focusFallbackId;
    if (!sid) continue;
    if (!Array.isArray(sessionState.flags_by_section[sid])) {
      sessionState.flags_by_section[sid] = [];
    }
    sessionState.flags_by_section[sid].push({
      type: f.type,
      signal_id: f.signal_id,
      note: f.note,
      at_turn: turnIndex,
    });
    added += 1;
  }
  // Cap per section at 24.
  for (const sid of Object.keys(sessionState.flags_by_section)) {
    const arr = sessionState.flags_by_section[sid];
    if (arr.length > 24) sessionState.flags_by_section[sid] = arr.slice(-24);
  }
  return added;
}

/* --------------------------- Substrate backstop guards --------------- */

/**
 * Quit-signal regex. Matches an explicit candidate request to end / stop the
 * interview. We intentionally keep it tight — false positives downgrade
 * substantive turns to CLOSE, which is a worse failure mode than the rare
 * miss on phrasing we didn't anticipate.
 */
const QUIT_SIGNAL_REGEX =
  /\b(?:let'?s end|let'?s stop|i\s+(?:quit|am\s+done|'?m\s+done)|end\s+(?:the|this)\s+interview|stop\s+(?:the|this)\s+interview|i'?m\s+(?:gonna|going\s+to)\s+stop|i'?m\s+done\s+here)\b/i;

/**
 * Moves whose focus content is by-design grounded in config vocabulary. The
 * earn-before-name rule does not apply here; the leak guard skips these.
 *   - ANSWER_AND_RELEASE: candidate asked a direct scope/scale question;
 *     the focus IS the config fact.
 *   - INJECT_FAULT / RAISE_STAKES / INJECT_VARIANT: the focus IS one of
 *     config.{fault_scenarios,raise_stakes_prompts,variant_scenarios}.
 */
const LEAK_CARVE_OUT_MOVES = new Set([
  'ANSWER_AND_RELEASE',
  'INJECT_FAULT',
  'RAISE_STAKES',
  'INJECT_VARIANT',
]);

/**
 * Build a phrase list to scan `recommended_focus` for. Each phrase is a
 * normalized lowercase substring; if the candidate has not used it yet, a
 * match counts as a seeding leak. Phrases are derived from:
 *   - config.required_breadth_components (raw + space-separated + common
 *     synonym expansions for the URL-shortener problem)
 *   - config.sections[].deep_dive_topics[] (label + id)
 *   - config.sections[].signals[] (id verbatim — these are private rubric
 *     labels and should never appear in candidate-facing text)
 *   - config.scale_facts[].value (extracted numeric tokens with units)
 *
 * For breadth components we restrict to the *missing* set when a snapshot
 * is available — components the candidate has already raised are by
 * definition earned and shouldn't trigger.
 */
function buildLeakPhrases(config, sessionState) {
  const phrases = [];
  const seen = new Set();
  const push = (kind, raw) => {
    const tok = String(raw || '').toLowerCase().trim();
    if (!tok || tok.length < 3) return;
    if (seen.has(tok)) return;
    seen.add(tok);
    phrases.push({ kind, token: tok });
  };

  const missing = Array.isArray(sessionState?.breadth_coverage?.components_missing)
    ? sessionState.breadth_coverage.components_missing
    : Array.isArray(config?.required_breadth_components)
      ? config.required_breadth_components
      : [];
  for (const c of missing) {
    const raw = String(c).toLowerCase();
    push('breadth', raw);
    push('breadth', raw.replace(/_/g, ' '));
    if (raw.includes('id_generation')) {
      push('breadth', 'slug generation');
      push('breadth', 'id generation');
      push('breadth', 'id allocator');
    }
    if (raw.includes('cach')) {
      push('breadth', 'cache');
      push('breadth', 'caching');
    }
    if (raw.includes('ttl') || raw.includes('expiry')) {
      push('breadth', 'ttl');
      push('breadth', 'expiry');
    }
    if (raw.includes('analytics')) {
      push('breadth', 'analytics');
      push('breadth', 'click count');
    }
    if (raw.includes('redirect_service')) {
      push('breadth', 'redirect service');
    }
    if (raw.includes('slug_storage')) {
      push('breadth', 'slug storage');
    }
    if (raw.includes('write_api')) {
      push('breadth', 'write api');
    }
  }

  for (const sec of Array.isArray(config?.sections) ? config.sections : []) {
    for (const t of Array.isArray(sec?.deep_dive_topics) ? sec.deep_dive_topics : []) {
      const id = String(t?.id || '').toLowerCase();
      const label = String(t?.label || '').toLowerCase();
      if (label.length >= 4) push('topic', label);
      if (id.length >= 5) push('topic', id.replace(/_/g, ' '));
    }
    for (const s of Array.isArray(sec?.signals) ? sec.signals : []) {
      const id = String(s?.id || '').toLowerCase();
      if (id.length >= 5) {
        push('signal', id);
        push('signal', id.replace(/_/g, ' '));
      }
    }
  }

  for (const f of Array.isArray(config?.scale_facts) ? config.scale_facts : []) {
    const v = String(f?.value || '');
    const matches =
      v.match(/~?\d[\d,.]*\s*(?:million|billion|thousand|k|m|b|ms|%|bytes?|:[0-9]+|sec(?:onds?)?)?/gi) ||
      [];
    for (const m of matches) {
      const tok = m.replace(/^~/, '').trim();
      if (tok.length >= 2) push('scale', tok.toLowerCase());
    }
  }

  return phrases;
}

/**
 * Compile every candidate-authored utterance in the conversation into a
 * single lowercase string for fast substring containment checks. The leak
 * guard treats anything that has appeared in a candidate turn as "earned"
 * vocabulary the Planner is free to push on. Interviewer turns do NOT
 * count — once Alex names a thing, the candidate hasn't earned it.
 */
function compileCandidateText(interview, currentCandidateMessage = '') {
  const turns = Array.isArray(interview?.conversation_turns)
    ? interview.conversation_turns
    : [];
  const parts = [];
  for (const t of turns) {
    if (String(t?.role || '').toLowerCase() === 'candidate') {
      parts.push(String(t?.content || ''));
    }
  }
  if (currentCandidateMessage) parts.push(String(currentCandidateMessage));
  return parts.join(' \n ').toLowerCase();
}

function findLeakInFocus(focus, candidateText, phrases) {
  const focusLc = String(focus || '').toLowerCase();
  if (!focusLc) return null;
  for (const p of phrases) {
    if (focusLc.includes(p.token) && !candidateText.includes(p.token)) {
      return p;
    }
  }
  return null;
}

/**
 * QUIT-SIGNAL GUARD. If the candidate explicitly asks to end the interview
 * and the Planner did NOT route to CLOSE / SALVAGE_AND_MOVE, force a clean
 * close. The 45-min CLOSE floor backstop downstream may then downgrade to
 * HAND_OFF if the wall clock is too early — but at minimum the candidate
 * stops getting another scope probe.
 *
 * Observed failure mode (URL-shortener trace, 2026-05-05): candidate said
 * "Let's end the interview" → Planner replied with yet another requirements
 * probe under a CHALLENGE_ASSUMPTION directive. The candidate signal was
 * misclassified as procedural / driving instead of block_complete.
 */
function enforceQuitSignal(captured, candidateMessage) {
  if (!QUIT_SIGNAL_REGEX.test(String(candidateMessage || ''))) return null;
  // Carve-out: if the Planner already routed to CLOSE / SALVAGE_AND_MOVE /
  // HAND_OFF / WRAP_TOPIC, leave it alone. Quit-aware moves don't need
  // overriding.
  const move = String(captured?.move || '').toUpperCase();
  if (['CLOSE', 'SALVAGE_AND_MOVE', 'HAND_OFF', 'WRAP_TOPIC'].includes(move)) {
    return null;
  }
  captured.move = 'CLOSE';
  captured.candidate_signal = 'block_complete';
  captured.interview_done = true;
  // Blank the focus so the (downstream) 45-min backstop or the Executor's
  // CLOSE rendering doesn't echo a probe question back. Reset subtopic
  // counter so the next directive doesn't think we're rabbit-holing.
  captured.recommended_focus = '';
  captured.current_subtopic = '';
  captured.consecutive_probes_on_subtopic = 0;
  captured.notes = (captured.notes ? captured.notes + ' | ' : '') +
    'quit_signal_detected: candidate explicitly asked to end the interview';
  return { reason: 'quit_signal' };
}

/**
 * THREAD-DEPTH BACKSTOP. Soft cap is 3 (Planner-prompt enforced). When the
 * Planner emits `consecutive_probes_on_subtopic >= 4` (one over the soft
 * cap), force PIVOT_ANGLE and reset the counter. This is the substrate
 * safety net BRAIN.md §13 said we'd reintroduce when telemetry showed
 * Planner drift — the URL-shortener trace shows it (4+ consecutive
 * scope-listing probes).
 */
function enforceThreadDepthCap(captured) {
  const depth = Number(captured?.consecutive_probes_on_subtopic) || 0;
  if (depth < 4) return null;
  const move = String(captured?.move || '').toUpperCase();
  // Already pivoting / handing off / wrapping — let the Planner's choice stand.
  if (['PIVOT_ANGLE', 'HAND_OFF', 'WRAP_TOPIC', 'CLOSE'].includes(move)) {
    return null;
  }
  captured.move = 'PIVOT_ANGLE';
  captured.recommended_focus = '';
  captured.current_subtopic = '';
  captured.consecutive_probes_on_subtopic = 0;
  captured.notes = (captured.notes ? captured.notes + ' | ' : '') +
    `thread_depth_backstop: forced PIVOT_ANGLE (depth was ${depth})`;
  return { reason: 'thread_depth', depth };
}

/**
 * SEEDING-LEAK BACKSTOP. Reintroduced from v3/v4 (BRAIN.md §13 lists it as
 * "removed in v5; reintroduce as patch when telemetry shows drift" — the
 * 2026-05-05 URL-shortener trace shows exactly that drift, e.g.
 * `recommended_focus`: "What else does this system need to handle, especially
 * around slug generation, caching, or expiry?" — three required-breadth
 * components named in one sentence).
 *
 * When `recommended_focus` contains config-sourced vocabulary the candidate
 * has not earned (and no carve-out applies), rewrite the focus to an OPEN
 * form so the candidate gets to surface the topic themselves.
 */
function enforceSeedingLeakGuard(captured, config, interview, candidateMessage) {
  const move = String(captured?.move || '').toUpperCase();
  if (LEAK_CARVE_OUT_MOVES.has(move)) return null;
  // HAND_OFF leaving requirements is the Requirements Contract Closing
  // carve-out — the focus may legitimately summarize scope items the
  // candidate has already agreed to.
  if (move === 'HAND_OFF') {
    const fid = String(captured?.recommended_section_focus_id || '').toLowerCase();
    if (fid && fid !== 'requirements') return null;
  }

  const phrases = buildLeakPhrases(config, interview?.session_state);
  if (phrases.length === 0) return null;

  const candidateText = compileCandidateText(interview, candidateMessage);
  const leak = findLeakInFocus(captured?.recommended_focus, candidateText, phrases);
  if (!leak) return null;

  // Rewrite based on leak kind. We deliberately blank the section focus so
  // the existing focus-resolver picks up the prior section (we are NOT
  // changing section, just the question we ask within it).
  const original = String(captured.recommended_focus || '');
  if (leak.kind === 'scale') {
    captured.move = 'DRAW_NUMBERS';
    captured.recommended_focus = 'Can you put numbers on that?';
  } else if (leak.kind === 'breadth') {
    captured.move = 'NUDGE_BREADTH';
    captured.recommended_focus =
      'Before we go deeper there, what else does this system need?';
  } else {
    // topic / signal — generic open redirect anchored on the candidate.
    captured.move = 'GO_DEEPER';
    captured.recommended_focus = 'Walk me through that piece in a bit more detail.';
  }
  captured.current_subtopic = '';
  captured.consecutive_probes_on_subtopic = 0;
  captured.notes =
    (captured.notes ? captured.notes + ' | ' : '') +
    `leak_guard: rewrote ${leak.kind} leak "${leak.token}" (was: ${original.slice(0, 80)})`;
  return { reason: 'seeding_leak', kind: leak.kind, token: leak.token };
}

/* --------------------------- Persistence ------------------------------ */

/**
 * Apply the captured Planner result to interview.session_state (mutating).
 *
 * Section_id routing: probes / flags / time-tracking are keyed by the
 * Planner's `recommended_section_focus_id` (or per-item section_id).
 *
 * Hard substrate behaviors:
 *   1. Requirements contract — write to session_state.requirements_contract
 *      only on first lock. Once locked=true, the substrate refuses to
 *      overwrite (immutable for the session).
 *   2. Breadth coverage / response_pace / verdict_trajectory — overwrite
 *      each turn with the latest snapshot.
 *   3. Substrate backstops (run before 45-min floor):
 *        a. Quit-signal guard — explicit "let's end" → CLOSE.
 *        b. Thread-depth backstop — depth>=4 → PIVOT_ANGLE.
 *        c. Seeding-leak guard — unearned config vocabulary → rewrite to open form.
 *   4. 45-minute CLOSE floor — if move==='CLOSE' or interview_done===true
 *      and wall clock < 45m AND not all sections at-or-over budget,
 *      downgrade to HAND_OFF to the highest-priority untouched section.
 */
export function applyEvalToSessionState(
  interview,
  captured,
  { config, candidateTurnIndex, candidateMessage = '' }
) {
  if (!interview.session_state) interview.session_state = {};
  const ss = interview.session_state;

  if (!Array.isArray(ss.eval_history)) ss.eval_history = [];
  if (!ss.performance_by_section) ss.performance_by_section = {};
  if (!ss.probe_queue || typeof ss.probe_queue !== 'object') ss.probe_queue = {};
  if (!ss.flags_by_section || typeof ss.flags_by_section !== 'object') ss.flags_by_section = {};
  if (!ss.section_minutes_used || typeof ss.section_minutes_used !== 'object') {
    ss.section_minutes_used = {};
  }

  const sections = Array.isArray(config?.sections) ? config.sections : [];

  // --- Resolve focus section: Planner emission > flag/probe section_id > prior > first.
  const plannerFocusId = String(captured.recommended_section_focus_id || '').trim();
  const flagFallback = captured.flags?.find((f) => f?.section_id)?.section_id || '';
  const probeFallback = captured.probe_observations?.find((p) => p?.section_id)?.section_id || '';
  const priorFocusId = String(ss.next_directive?.recommended_section_focus_id || '').trim();
  const hintId = plannerFocusId || flagFallback || probeFallback || priorFocusId;
  const { section: focus } = resolveFocusSection(config, hintId, priorFocusId);
  const focusId = focus?.id || '';

  // --- Per-section time tracking. Attribute the elapsed time since
  // last_turn_ts to the PRIOR focus section.
  const nowMs = Date.now();
  const lastTurnTs = Number(ss.last_turn_ts) || nowMs;
  const elapsedMin = Math.max(0, (nowMs - lastTurnTs) / 60000);
  if (priorFocusId) {
    ss.section_minutes_used[priorFocusId] =
      Number(ss.section_minutes_used[priorFocusId] || 0) + elapsedMin;
  }
  ss.last_turn_ts = nowMs;

  // --- Performance routing.
  if (focusId && captured.performance_assessment && captured.performance_assessment !== 'unclear') {
    ss.performance_by_section[focusId] = captured.performance_assessment;
  }

  // --- Requirements contract (immutable once locked).
  let contractLockedThisTurn = false;
  if (captured.requirements_contract) {
    const prior = ss.requirements_contract;
    if (prior?.locked === true) {
      // Already locked — substrate refuses to overwrite. Keep prior.
    } else if (captured.requirements_contract.locked === true) {
      const rawLockedAt = captured.requirements_contract.locked_at_turn;
      const parsedLockedAt =
        rawLockedAt !== null && rawLockedAt !== undefined && Number.isFinite(Number(rawLockedAt))
          ? Number(rawLockedAt)
          : candidateTurnIndex;
      ss.requirements_contract = {
        ...captured.requirements_contract,
        locked_at_turn: parsedLockedAt,
      };
      contractLockedThisTurn = true;
    } else {
      // Not yet locked — store latest "proposed" snapshot for visibility.
      ss.requirements_contract = { ...captured.requirements_contract, locked: false };
    }
  }

  // --- Breadth coverage (overwrite snapshot).
  if (captured.breadth_coverage) {
    ss.breadth_coverage = {
      components_mentioned: Array.isArray(captured.breadth_coverage.components_mentioned)
        ? captured.breadth_coverage.components_mentioned.slice(0, 32)
        : [],
      components_missing: Array.isArray(captured.breadth_coverage.components_missing)
        ? captured.breadth_coverage.components_missing.slice(0, 32)
        : [],
    };
  }

  // --- Response pace + verdict_trajectory.
  if (RESPONSE_PACES.includes(captured.response_pace)) {
    ss.response_pace = captured.response_pace;
  }
  if (Number.isFinite(Number(captured.pace_turns_tracked))) {
    ss.pace_turns_tracked = Math.max(0, Math.floor(Number(captured.pace_turns_tracked)));
  }
  if (VERDICT_TRAJECTORIES.includes(captured.verdict_trajectory)) {
    ss.verdict_trajectory = captured.verdict_trajectory;
  }

  // --- Probe queue: append observations.
  let appendedProbeIds = [];
  if (Array.isArray(captured.probe_observations) && captured.probe_observations.length > 0) {
    appendedProbeIds = appendProbeObservations(
      ss,
      captured.probe_observations,
      candidateTurnIndex,
      focusId
    );
  }

  // --- Consume probe queue item (search across sections).
  let consumedProbe = null;
  if (captured.consumed_probe_id) {
    consumedProbe = consumeProbeQueueItem(ss, captured.consumed_probe_id, candidateTurnIndex);
    if (consumedProbe?.item && (!captured.recommended_focus || captured.recommended_focus.length < 4)) {
      captured.recommended_focus = consumedProbe.item.probe || consumedProbe.item.observation;
    }
  }

  // --- Flags persistence.
  const flagsAddedCount = appendFlags(ss, captured.flags, candidateTurnIndex, focusId);

  // --- Flag-emission observability. A "substantive" turn is one with a real
  // bar signal (driving / missing_breadth / rabbit_holing / block_complete
  // / stuck). The Planner prompt mandates >=1 flag on those turns when the
  // focus rubric has signals defined; if we got zero, log a warning so we
  // can spot prompt drift quickly.
  const SUBSTANTIVE_SIGNALS = new Set([
    'driving',
    'missing_breadth',
    'rabbit_holing',
    'block_complete',
    'stuck',
  ]);
  const focusHasRubricSignals =
    Array.isArray(focus?.signals) && focus.signals.length > 0;
  if (
    flagsAddedCount === 0 &&
    SUBSTANTIVE_SIGNALS.has(captured.candidate_signal) &&
    focusHasRubricSignals
  ) {
    console.warn(
      `[planner] zero flags on substantive turn ${candidateTurnIndex} (signal=${captured.candidate_signal}, section=${focusId}, move=${captured.move}) — prompt drift likely`
    );
  }

  // --- Substrate backstops. Order matters: quit > thread depth > leak guard.
  // A fired backstop short-circuits subsequent ones (no point checking for a
  // leak in a focus we just blanked).
  let quitGuardFired = null;
  let threadDepthGuardFired = null;
  let leakGuardFired = null;
  quitGuardFired = enforceQuitSignal(captured, candidateMessage);
  if (!quitGuardFired) {
    threadDepthGuardFired = enforceThreadDepthCap(captured);
    if (!threadDepthGuardFired) {
      leakGuardFired = enforceSeedingLeakGuard(captured, config, interview, candidateMessage);
    }
  }
  if (quitGuardFired || threadDepthGuardFired || leakGuardFired) {
    const which = quitGuardFired
      ? `quit_signal`
      : threadDepthGuardFired
        ? `thread_depth(depth=${threadDepthGuardFired.depth})`
        : `leak_guard(${leakGuardFired.kind}:"${leakGuardFired.token}")`;
    console.warn(`[planner] substrate guard fired: ${which}`);
  }

  // --- Wall-clock for 45-minute CLOSE floor.
  const interviewStartTs = interview?.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : null;
  const interviewElapsedMin = interviewStartTs
    ? Math.max(0, (Date.now() - interviewStartTs) / 60000)
    : 0;
  const interviewTotalMin = Number(config?.total_minutes) ||
    sections.reduce((a, s) => a + (Number(s.budget_minutes) || 0), 0);
  const interviewElapsedFraction = interviewTotalMin > 0 ? interviewElapsedMin / interviewTotalMin : 0;

  // --- 45-minute CLOSE floor (substrate backstop).
  // Recompute "untouched" AFTER applying flags / probes from this turn so the
  // current section's first touch counts.
  let closeBlockedReason = null;
  let resolvedFocusId = focusId;
  if (captured.move === 'CLOSE' || captured.interview_done === true) {
    const untouched = listUntouchedSections(sections, ss);
    const allOverBudget = sections.every((s) => {
      const used = Number(ss.section_minutes_used?.[s.id] || 0);
      const budget = Number(s.budget_minutes) || 0;
      return budget > 0 && used >= budget;
    });
    const wallClockOk = interviewElapsedMin >= 45;
    const closeAllowed =
      wallClockOk && (untouched.length === 0 || allOverBudget);
    if (!closeAllowed) {
      const target = pickPriorityUntouchedSection(untouched);
      const targetId = target?.id || resolvedFocusId;
      console.warn('[planner] CLOSE blocked, downgrading to HAND_OFF', {
        wallClockMin: Number(interviewElapsedMin.toFixed(1)),
        untouchedIds: untouched.map((s) => s.id),
        redirectedTo: targetId,
      });
      captured.move = 'HAND_OFF';
      captured.interview_done = false;
      captured.recommended_focus = '';
      captured.recommended_section_focus_id = targetId;
      captured.current_subtopic = '';
      captured.consecutive_probes_on_subtopic = 0;
      resolvedFocusId = targetId;
      closeBlockedReason = !wallClockOk ? 'wall_clock_below_45m' : 'untouched_sections';
    }
  }

  // --- answer_only derivation.
  const answerOnly = deriveAnswerOnly(captured);

  // --- Persist directive for the next Executor turn.
  ss.next_directive = {
    move: captured.move,
    difficulty: captured.difficulty,
    recommended_focus: captured.recommended_focus || '',
    recommended_section_focus_id: resolvedFocusId,
    consumed_probe_id: captured.consumed_probe_id || '',
    current_subtopic: String(captured.current_subtopic || ''),
    consecutive_probes_on_subtopic: Number(captured.consecutive_probes_on_subtopic) || 0,
    momentum: captured.momentum,
    bar_trajectory: captured.bar_trajectory,
    verdict_trajectory: captured.verdict_trajectory,
    time_status: captured.time_status,
    response_pace: captured.response_pace,
    answer_only: answerOnly,
    generated_after_turn: candidateTurnIndex,
  };

  // --- Honor Planner-driven completion (post-guard).
  let interviewDone = false;
  if (captured.interview_done === true || captured.move === 'CLOSE') {
    interviewDone = true;
    ss.interview_done = true;
  }

  // --- Audit trail.
  const breadthMissingCount = Array.isArray(ss.breadth_coverage?.components_missing)
    ? ss.breadth_coverage.components_missing.length
    : 0;
  ss.eval_history.push({
    turn_index: candidateTurnIndex,
    notes: captured.notes,
    candidate_signal: captured.candidate_signal,
    performance_assessment: captured.performance_assessment,
    move: captured.move,
    difficulty: captured.difficulty,
    momentum: captured.momentum,
    bar_trajectory: captured.bar_trajectory,
    verdict_trajectory: captured.verdict_trajectory,
    time_status: captured.time_status,
    response_pace: captured.response_pace,
    pace_turns_tracked: captured.pace_turns_tracked,
    requirements_contract_locked_at_turn: ss.requirements_contract?.locked_at_turn ?? null,
    contract_locked_this_turn: contractLockedThisTurn,
    breadth_components_missing_count: breadthMissingCount,
    recommended_section_focus_id: resolvedFocusId,
    current_subtopic: String(captured.current_subtopic || ''),
    consecutive_probes_on_subtopic: Number(captured.consecutive_probes_on_subtopic) || 0,
    interview_elapsed_fraction: Number(interviewElapsedFraction.toFixed(2)),
    consumed_probe_id: captured.consumed_probe_id || '',
    probe_observations_added: appendedProbeIds.length,
    flags_added_count: flagsAddedCount,
    close_blocked_reason: closeBlockedReason,
    quit_guard_fired: !!quitGuardFired,
    thread_depth_guard_fired: !!threadDepthGuardFired,
    leak_guard_fired: leakGuardFired
      ? `${leakGuardFired.kind}:${leakGuardFired.token}`
      : null,
    interview_done: !!captured.interview_done,
    at: new Date(),
  });
  if (ss.eval_history.length > 80) {
    ss.eval_history = ss.eval_history.slice(-80);
  }
  ss.last_eval_at = new Date();

  return { interviewDone };
}

/* --------------------------- Cache warmup ---------------------------- */

/**
 * Fire-and-forget LLM cache warmup against the Planner system prefix.
 *
 * The Planner's `system` block (rules + INTERVIEW CONFIG + INTERVIEW PLAN)
 * is byte-stable across every turn of one session — that's what makes it
 * a good cache key. We send one tiny request right after session start so
 * DeepSeek's native context cache is hot before the candidate's first turn
 * lands. Without this, the very first Planner call (T1's foreground eval)
 * pays the full uncached input cost AND the full cold-prefix latency hit.
 *
 * NEVER throws — any failure is logged and swallowed.
 */
export function warmPlannerPrefix({ config, interview }) {
  return Promise.resolve().then(async () => {
    try {
      const { system } = buildPrompt({
        config,
        interview: interview || {},
        sessionState: interview?.session_state || {},
        candidateMessage: '',
        interviewerReply: '',
      });
      // Tiny user payload — the cache key is the system prefix, not the
      // user content. JSON-mode is OFF here so we don't burn tokens
      // synthesizing a full directive — we just want the prefix cached.
      await invokeLLM({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: '.' },
        ],
        modelTier: 'eval',
        temperature: 0,
        max_tokens: 4,
      });
    } catch (err) {
      console.warn('[warmup] planner prefix warmup failed (non-fatal):', err?.message || err);
    }
  });
}

export {
  SCHEMA,
  MOVES,
  DIFFICULTIES,
  MOMENTUMS,
  BAR_TRAJECTORIES,
  TIME_STATUSES,
  PERFORMANCE_ASSESSMENTS,
  CANDIDATE_SIGNALS,
  RESPONSE_PACES,
  VERDICT_TRAJECTORIES,
  PROBE_TYPES,
  UNTOUCHED_PRIORITY,
  buildPrompt,
  sectionWindowedTurns,
  formatTranscriptBlock,
  listUntouchedSections,
  pickPriorityUntouchedSection,
};
