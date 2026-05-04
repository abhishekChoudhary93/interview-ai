import { invokeLLM } from './llmInvoke.js';
import { resolveOpenRouterModel } from '../config.js';

/**
 * v3 Planner — per-turn JSON directive.
 *
 * Architecture: LLM-led, app-as-data-layer, single-problem.
 *
 *   - The Planner LLM owns ALL interviewer judgment AND all section
 *     transitions. Sections are a structural plan in the injected
 *     interview_config. The application does not advance sections.
 *
 *   - Adaptive difficulty: every turn the Planner emits `difficulty`
 *     (L1/L2/L3), `momentum` (hot/warm/cold), `bar_trajectory`
 *     (rising/flat/falling), and `time_status` (on_track/behind/critical).
 *     These drive the Executor's delivery register and the move catalog.
 *
 *   - INJECT_FAULT and RAISE_STAKES draw from config.fault_scenarios and
 *     config.raise_stakes_prompts respectively — content-driven moves.
 *
 *   - The Planner emits `interview_done=true` directly when wrap is done.
 *
 *   - JS substrate: schema validation, leak guard, persistence (probe_queue,
 *     flags_by_section, section_minutes_used, eval_history). No coverage
 *     gate, no rubric_updates persistence, no signal taxonomy.
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
  // Lateral within section (v4 FIX-1)
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
const CANDIDATE_SIGNALS = ['driving', 'asked_question', 'block_complete', 'stuck', 'procedural'];
const FLAG_TYPES = ['green', 'red'];

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
        'Candidate-facing question or transition phrase. Empty string for LET_LEAD. For ANSWER_AND_RELEASE, exactly the one fact from interview_config (no preamble). Treat as if the candidate will read it verbatim — never use rubric vocabulary they have not raised.',
    },
    consumed_probe_id: {
      type: 'string',
      description:
        'When recommending HAND_OFF or GO_DEEPER, set to the queue item id whose probe drives the focus. Otherwise empty string.',
    },
    current_subtopic: {
      type: 'string',
      description:
        '3-5 word label for the sub-topic the latest probe is on (e.g. "consistent hashing rebalancing", "cache TTL strategy"). Used by the rabbit-hole guard. Empty string for LET_LEAD / ANSWER_AND_RELEASE / procedural.',
    },
    consecutive_probes_on_subtopic: {
      type: 'integer',
      description:
        'How many consecutive turns have probed THIS same subtopic (including this turn). Reset to 0 on PIVOT_ANGLE / HAND_OFF / WRAP_TOPIC / CLOSE / move into a different signal area. Hard rule: must NOT exceed 3 — if it would, emit PIVOT_ANGLE instead.',
      minimum: 0,
    },
    probe_observations: {
      type: 'array',
      description:
        "0-2 NEW probe-worthy observations from THIS turn — things worth asking about a future turn. Each MUST be tagged with the section_id it belongs to and carry a pre-formed candidate-facing question in `probe`.",
      items: {
        type: 'object',
        properties: {
          observation: { type: 'string' },
          probe: { type: 'string' },
          section_id: { type: 'string' },
          difficulty: { type: 'string', enum: DIFFICULTIES },
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
    'time_status',
    'candidate_signal',
    'interview_done',
  ],
};

/* --------------------------- Helpers ---------------------------------- */

function normalizeForFuzzyMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------- Leak guard ------------------------------- */

const LEAK_GUARD_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from',
  'is', 'are', 'be', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did',
  'what', 'how', 'why', 'when', 'where', 'who', 'which',
  'your', 'you', 'their', 'them', 'they', 'it', 'its', 'this', 'that', 'these', 'those',
  'can', 'could', 'would', 'should', 'will', 'shall',
  'about', 'into', 'over', 'under', 'between', 'across',
  'more', 'most', 'less', 'least',
  'walk', 'explain', 'describe', 'tell', 'ask', 'asks',
  'me', 'us', 'my', 'we', 'our',
  'so', 'than', 'then', 'as', 'at', 'by', 'if',
  'one', 'two', 'three',
  'candidate', 'interviewer', 'section', 'design', 'system',
]);

function leakGuardStem(w) {
  if (w.length <= 4) return w;
  let stem = w;
  for (const suf of ['ization', 'ational', 'ation', 'tions', 'tion', 'ates', 'ated', 'ate', 'ings', 'ing', 'ies', 'ied', 'edly', 'ed', 'ers', 'er', 'es', 's']) {
    if (stem.length - suf.length >= 4 && stem.endsWith(suf)) {
      stem = stem.slice(0, stem.length - suf.length);
      break;
    }
  }
  return stem.length > 5 ? stem.slice(0, 5) : stem;
}

function leakGuardTokens(s) {
  return normalizeForFuzzyMatch(s)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && w.length > 2 && !LEAK_GUARD_STOPWORDS.has(w))
    .map(leakGuardStem);
}

/**
 * Detect when a string paraphrases a rubric line. Used to:
 *   1. Blank out a leaky `recommended_focus` (move stays — Planner's call).
 *   2. Flag an Executor reply that lifted rubric vocabulary (observability).
 *
 * Returns the matched rubric string, or null if no leak detected.
 */
export function focusLooksLikeRubricLeak(focus, rubricStrings) {
  if (!focus || !Array.isArray(rubricStrings) || rubricStrings.length === 0) {
    return null;
  }
  const focusTokens = leakGuardTokens(focus);
  if (focusTokens.length === 0) return null;
  const focusSet = new Set(focusTokens);

  for (const r of rubricStrings) {
    const rTokens = leakGuardTokens(r);
    if (rTokens.length === 0) continue;
    let overlap = 0;
    for (const t of rTokens) if (focusSet.has(t)) overlap += 1;
    if (overlap >= 3) return r;
    if (overlap / rTokens.length >= 0.6 && overlap >= 2) return r;
  }
  return null;
}

/**
 * Collect every rubric string the leak guard should scan against, derived
 * from the v3 config (good_signals + faang_bar of every section).
 */
function collectRubricStringsFromConfig(config) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  const out = [];
  for (const s of sections) {
    if (Array.isArray(s.good_signals)) out.push(...s.good_signals);
    if (typeof s.faang_bar === 'string' && s.faang_bar) {
      for (const part of s.faang_bar.split(/[.;,]/)) {
        const t = part.trim();
        if (t.length >= 8) out.push(t);
      }
    }
  }
  return out;
}

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
      lines.push(
        `  ${p.id} [${sec.id}] difficulty=${p.difficulty || 'L2'}: "${String(p.probe || p.observation || '').slice(0, 110)}"`
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

/* --------------------------- Section exit gates (FIX-2) -------------- */

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

/* --------------------------- Untouched sections (FIX-4) -------------- */

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
 * v4 FIX-4 priority order for untouched-section redirect.
 */
const UNTOUCHED_PRIORITY = ['deep_dive', 'operations', 'tradeoffs', 'high_level_design', 'requirements'];

function listUntouchedSections(sections, sessionState) {
  return sections.filter((s) => !isSectionTouched(s, sessionState));
}

function pickPriorityUntouchedSection(untouched) {
  if (!Array.isArray(untouched) || untouched.length === 0) return null;
  // Prefer the v4 priority order; if multiple match, take the first.
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

/* --------------------------- Static prompt blocks -------------------- */

const ROLE_BLOCK = `You are the Interview Planner. You are invisible to the candidate. You think like a principal engineer who has conducted 200+ system design loops. Every turn you make three decisions in this order:
  1. Clock — am I on pace? does something need to be cut?
  2. Momentum — how has this candidate been performing the last 3 turns? scale up or down?
  3. Move — what is the exact right question to ask right now, at the right difficulty level?

You output one JSON directive matching the schema. The Executor renders it. You never speak to the candidate directly. Anything you write into recommended_focus becomes a candidate-facing question via the Executor — treat it as if the candidate will read it.`;

const MOVE_CATALOG = `MOVE CATALOG:

Listening moves:
  LET_LEAD                — Candidate is driving with substance. Stay silent. recommended_focus="".
  ANSWER_AND_RELEASE      — Candidate asked a direct scope/scale question. Give the one fact from interview_config, then release. Hard rule: one question = one fact. Never bundle.

Probing moves:
  GO_DEEPER (L1-L2)       — Candidate paused or gave a shallow answer with unexplored depth. Push on something they actually said.
  CHALLENGE_ASSUMPTION (L2)
                          — Candidate is building on an unstated assumption. Surface it without telling them the right assumption.
  CHALLENGE_TRADEOFF (L2) — Candidate stated a design choice without naming its cost. Ask what they're giving up.
  DRAW_NUMBERS (L1-L2)    — Candidate is reasoning qualitatively where back-of-envelope would change the design. Ask them to quantify. Never supply numbers.
  INJECT_FAULT (L2-L3)    — Inject a failure scenario from interview_config.fault_scenarios. Choose the one most grounded in the design the candidate has described so far. Do NOT use a scenario that references a component the candidate hasn't mentioned.
  RAISE_STAKES (L3)       — Push to a staff-level concern from interview_config.raise_stakes_prompts. Use only when momentum=hot and candidate has demonstrated solid L2 depth.

Lateral move within section (v4 FIX-1):
  PIVOT_ANGLE (any)       — Used when consecutive_probes_on_subtopic >= 3 OR the candidate just said "I don't know" / is stuck on the current subtopic. Stop drilling the current sub-topic; move to a DIFFERENT angle (different signal area) within the SAME section. Not a section transition. Reset consecutive_probes_on_subtopic to 0 and update current_subtopic to the new angle. Example: if you've been on shard-key selection for 3 turns, pivot to ID generation or redirect-path latency — still in deep_dive, different angle.

Difficulty-down moves:
  NARROW_SCOPE (L1)       — Candidate is stuck on a broad problem. Collapse it to a concrete sub-problem. Do not give the answer.
  PROVIDE_ANCHOR (L1)     — Candidate is fully blocked. Give one concrete constraint to unlock movement. Flag as below-bar signal.
  SALVAGE_AND_MOVE        — Section is not yielding signal. Get one last clean data point, then transition. Flag section as incomplete.

Transition moves:
  HAND_OFF                — Section EXIT GATE passed (see EXIT GATES block) AND budget is near. Transition to next section. recommended_focus = verbal transition phrase. Update recommended_section_focus_id to next section id.
  WRAP_TOPIC              — Section over budget. Hard cut regardless of exit gate. Flag as incomplete.
  CLOSE                   — ONLY valid when (1) the final section is complete AND (2) every section has been touched (has at least one green/red flag OR was explicitly WRAP_TOPIC'd). See CLOSE GATE block. Set interview_done=true.`;

const DIFFICULTY_LEVELS = `DIFFICULTY LEVELS:
  L1 — Baseline. Foundational and open-ended. Any competent target-level candidate should reach a reasonable answer.
  L2 — Push. Requires depth, failure thinking, or explicit tradeoff reasoning. Distinguishes senior from mid.
  L3 — Staff/Principal bar. Cost, abuse, multi-region, org implications, SLA breach. Distinguishes staff from senior.

DIFFICULTY ASSIGNMENT RULE:
  cold momentum                              → step DOWN one level (floor: L1)
  warm momentum                              → hold current level
  hot + 2 consecutive at/above target        → step UP one level (cap: L3)`;

const MOMENTUM_SYSTEM = `ADAPTIVE DIFFICULTY SYSTEM:

MOMENTUM CALCULATION (last 3 substantive turns; skip procedural messages):
  3x above_target                          → hot
  2x above_target + 1x at_target           → hot
  Mix of at_target                         → warm
  2x below_target                          → cold
  3x below_target                          → cold
  Insufficient data                        → warm

MOMENTUM → INTERVIEW SHAPE:
  hot   — Skip L1 probes in queue (no signal). Prefer INJECT_FAULT, RAISE_STAKES, CHALLENGE_ASSUMPTION. Goal: find where fluency breaks down; characterize the ceiling.
  warm  — Steady L1/L2 pressure. Work probe queue systematically. Goal: confirm consistent at-bar performance across sections.
  cold  — Drop to L1. Do NOT keep hammering a stuck point. NARROW_SCOPE first. If still stuck → PROVIDE_ANCHOR. If still stuck → SALVAGE_AND_MOVE. Shift laterally; find what they can do cleanly.`;

const TIME_MANAGEMENT = `TIME MANAGEMENT SYSTEM:

PER-SECTION BUDGET (section_pct_used = section_minutes / section.budget_minutes):
  < 0.75    → on_track
  0.75–1.0  → behind  (consider HAND_OFF after next probe)
  ≥ 1.0     → critical (WRAP_TOPIC or HAND_OFF immediately)

TOTAL INTERVIEW BUDGET:
  Comfortable                             → no change
  ~70% of budget for remaining sections   → compress; shorten probes; prioritize high-signal questions
  <50% of budget for remaining sections   → WRAP_TOPIC current section; consider cutting lowest-signal remaining section

HARD RULE: No single section may consume >40% of total interview time.

COMPRESSION PRIORITY (cut in this order):
  1. Extra probes in early sections when later sections are untouched
  2. Additional probes in sections where bar is already clear
  3. Never cut the highest-signal deep_dive equivalent section entirely
  4. Never cut the operations/reliability section entirely`;

const BAR_TRAJECTORY_SYSTEM = `BAR TRAJECTORY SYSTEM:
  2+ sections trending above_target         → rising
  Mixed at_target across sections           → flat
  2+ sections with red flags or below_target → falling

BAR TRAJECTORY → REMAINING PLAN:
  rising — Skip foundational L1 probes. Use freed time for L3 raises. Goal: characterize L5 vs L6 ceiling.
  flat   — Standard plan. L2 pressure. Probe queue. Goal: confirm consistent target readiness.
  falling — Breadth over depth. One clean answer per section beats three incomplete ones. Goal: honest floor/ceiling picture for debrief.`;

const SIGNAL_CLASSIFICATION = `CANDIDATE SIGNAL CLASSIFICATION (commit on every turn):
  driving         — Substantive design point, no prompting needed                         → default LET_LEAD
  asked_question  — Specific scoping or fact question                                     → default ANSWER_AND_RELEASE
  block_complete  — "I think that covers it" / "should we move on?" — closure cue         → HAND_OFF if EXIT GATE passed, otherwise probe for highest-priority missing signal
  stuck           — Repeating, circling, "I don't know", or long pause                    → PIVOT_ANGLE if section has other unprobed angles, else SALVAGE_AND_MOVE
  procedural      — "ok", "ready", "sure" — zero design content                           → LET_LEAD

Procedural also includes META-QUESTIONS about the interview itself ("are you stuck?", "is the interview over?", "what should I focus on next?", "can you give me a hint?"). These map to LET_LEAD with empty recommended_focus. NEVER classify a meta-question as block_complete. NEVER respond to a meta-question with CLOSE or WRAP_TOPIC.

Tie-break: closure cue + transition question = block_complete. Never misclassify as driving. "I don't know" is ALWAYS stuck, never block_complete.`;

const THREAD_DEPTH_RULE = `THREAD DEPTH RULE (FIX-1) — RABBIT-HOLE PREVENTION:

Track current_subtopic and consecutive_probes_on_subtopic across turns. The
prior values are visible in RUNTIME STATE; you emit the new values in the
schema.

Rule: if consecutive_probes_on_subtopic >= 3 going into this turn, you MUST
NOT emit another probe on the same subtopic. You MUST either:
  - PIVOT_ANGLE — different signal area within the SAME section, OR
  - HAND_OFF / WRAP_TOPIC if EXIT GATE passed or budget spent

What counts as "same subtopic": the subtopic label is specific (e.g.
"consistent hashing rebalancing", "cache TTL strategy", "thundering herd
mitigation"). If the new probe addresses the same underlying mechanism or
failure mode as the previous probe, it is the same subtopic.

Why: 3 consecutive probes on one sub-topic yields diminishing signal. After
3, you already know if they can reason about that area. More probes there
just eat budget and deprive you of signal from untouched sections.`;

const EXIT_GATES_RULE = `EXIT GATES (FIX-2) — MINIMUM SIGNALS BEFORE HAND_OFF:

Each section has an exit_gate.require_any list of signal_ids. HAND_OFF is
valid ONLY if at least one of those signals is GREEN in flags_by_section,
OR the section is over budget (in which case use WRAP_TOPIC + red incomplete
flag, not HAND_OFF).

If the section has zero greens from its require_any list AND budget allows
another probe → do NOT HAND_OFF. Issue one targeted probe for the
highest-priority missing signal. Pull from PROBE QUEUE if available;
otherwise emit GO_DEEPER / DRAW_NUMBERS / CHALLENGE_TRADEOFF anchored on
the candidate's words to elicit that signal.

If the section is over budget AND the gate is not passed:
  → WRAP_TOPIC with flag { type: "red", signal_id: "section_incomplete",
    note: "exit gate not passed — missing [list]" }

Per-section gate visibility: see SECTION EXIT GATES in RUNTIME STATE.`;

const SCALE_FACT_INJECTION_RULE = `SCALE-FACT INJECTION CHECK (FIX-3):

Before finalizing recommended_focus, scan it for any number that appears in
interview_config.scale_facts. Examples: "500,000 redirects/sec", "100M new
links/day", "100:1 read/write ratio", "5,000 writes/sec", "200 bytes".

If a number appears in recommended_focus AND the candidate did NOT ask for
that specific fact in their LATEST CANDIDATE MESSAGE → either:
  (a) rewrite the question without the number ("How does your design
      handle the redirect load?" instead of "...500,000 redirects/sec?"), OR
  (b) change move to DRAW_NUMBERS and ask the candidate to estimate it
      themselves.

The point: if the candidate doesn't know the scale, that is signal. Don't
hand them the number and then ask how they'd handle it.`;

const CLOSE_GATE_RULE = `CLOSE GATE (FIX-4) — MINIMUM COVERAGE BEFORE CLOSE:

CLOSE / interview_done=true is valid ONLY when ALL hold:
  1. The final section in INTERVIEW PLAN has had at least one probe.
  2. Every section has been touched (has at least one green or red flag,
     OR was explicitly WRAP_TOPIC'd).
  3. There are no untouched sections AND wall clock has < 3 minutes left,
     OR every section is at-or-over its budget.

If you are tempted to CLOSE but untouched sections exist and time > 3m:
  → do NOT CLOSE.
  → WRAP_TOPIC the current section.
  → HAND_OFF to the highest-priority untouched section. Priority order:
    deep_dive > operations > tradeoffs > high_level_design > requirements

"I DON'T KNOW" HANDLING (FIX-5):
When the candidate says "I don't know", "not sure", "I'm stuck", or
otherwise signals they have no answer:
  - NEVER follow with another probe on the same subtopic.
  - NEVER immediately CLOSE. NEVER WRAP_TOPIC the whole interview.
  - Log a red flag for the relevant signal area.
  - Reset consecutive_probes_on_subtopic to 0.
  - If the section has other unprobed signal areas → PIVOT_ANGLE.
  - Else if EXIT GATE passed or section over budget → SALVAGE_AND_MOVE
    then HAND_OFF to the next untouched section.
  - Else NARROW_SCOPE to a smaller piece of the same area.`;

const DECISION_ALGORITHM = `DECISION ALGORITHM:

  STEP 1 — TIME CHECK
    Compute section_pct_used (from SECTION BUDGETS) and total_pct_used (WALL CLOCK).
    If critical → override: WRAP_TOPIC or HAND_OFF regardless of other factors.
    Set time_status accordingly.

  STEP 2 — CLASSIFY CANDIDATE SIGNAL
    driving | asked_question | block_complete | stuck | procedural

  STEP 3 — COMPUTE MOMENTUM
    Use the MOMENTUM (last 3 substantive turns) line in RUNTIME STATE.

  STEP 4 — CHECK THREAD DEPTH (FIX-1)
    Read CURRENT SUBTOPIC and CONSECUTIVE PROBES ON IT from RUNTIME STATE.
    If consecutive_probes_on_subtopic >= 3:
      → if section has other unprobed signal areas → PIVOT_ANGLE
      → else if EXIT GATE passed OR section over budget → HAND_OFF / WRAP_TOPIC
      → else SALVAGE_AND_MOVE
    Whatever you pick, MUST reset consecutive_probes_on_subtopic to 0 and update current_subtopic.

  STEP 5 — CHECK SCALE-FACT INJECTION (FIX-3)
    Before finalizing recommended_focus, scan it for any number that appears in
    interview_config.scale_facts (e.g. "500,000", "500k", "100M", "5k", "100:1").
    If a number appears AND the candidate did NOT ask for that specific fact in
    their last message:
      → rewrite the question without the number, OR
      → change move to DRAW_NUMBERS and ask the candidate to estimate instead.
    Goal: if the candidate doesn't know the scale, that is signal. Never give
    them the number and then ask how they'd handle it.

  STEP 6 — SET DIFFICULTY
    Apply the difficulty assignment rule based on momentum.

  STEP 7 — SELECT MOVE
    asked_question                          → ANSWER_AND_RELEASE
                                              recommended_focus = exactly ONE fact
                                              answering ONE dimension. Never bundle
                                              multiple scope dims. Never append a
                                              transition phrase.
    procedural / meta-question              → LET_LEAD (never CLOSE, never WRAP_TOPIC)
    driving                                 → LET_LEAD
    block_complete + EXIT GATE passed       → HAND_OFF (update recommended_section_focus_id to next section)
    block_complete + EXIT GATE not passed   → probe for highest-priority missing signal in EXIT GATE require_any
    stuck / "I don't know"                  → PIVOT_ANGLE (if section has other unprobed angles) or SALVAGE_AND_MOVE
                                              NEVER another probe on the same subtopic. NEVER CLOSE.
    consecutive_probes_on_subtopic >= 3     → PIVOT_ANGLE (or HAND_OFF if exit gate passed AND budget near)
    momentum=hot + L2 depth shown           → INJECT_FAULT or RAISE_STAKES
    otherwise                               → GO_DEEPER or CHALLENGE_TRADEOFF from queue

  HAND_OFF GUARD (extends EXIT GATES block):
    HAND_OFF fires ONLY if EXIT GATE passes AND at least one is true:
      (a) candidate_signal == block_complete
      (b) section time_status == critical (section_pct_used >= 1.0)
      (c) section time_status == behind AND EXIT GATE already passed
      (d) consecutive_probes_on_subtopic >= 3 AND no other unprobed angle exists in section
    WRAP_TOPIC fires when section is over budget regardless of EXIT GATE (with red flag for incomplete).
    Otherwise — within-section move only.

  STEP 8 — CLOSE GATE CHECK (FIX-4)
    If you are about to emit move=CLOSE or interview_done=true, verify ALL:
      (a) the final section in INTERVIEW PLAN has at least one probe applied,
      (b) every section has been touched (last_touch != NEVER) OR was WRAP_TOPIC'd,
      (c) wall clock has < 3 minutes remaining OR every section is at-or-over budget.
    If any fail → do NOT close. Instead WRAP_TOPIC the current section and HAND_OFF
    to the highest-priority untouched section. Priority order:
      deep_dive > operations > tradeoffs > high_level_design > requirements

  STEP 9 — WRITE recommended_focus
    Must use the candidate's own vocabulary (words they have actually used).
    Must NOT name a component, technology, or topic they have not raised.
    Must NOT contain a scale-fact number unless the candidate asked for it.
    Must be a single, concrete question — never compound.

  STEP 10 — EMIT FLAGS, PROBES, TRAJECTORY
    Max 2 probe_observations per turn. Each carries a pre-formed candidate-facing question in \`probe\`.
    Max 2 flags per turn (green/red total).
    At most 1 consumed_probe_id per turn.
    Commit to performance_assessment on every substantive turn.
    "unclear" only for procedural messages with zero design content.`;

const HARD_PROHIBITIONS = `HARD PROHIBITIONS:

recommended_focus must NEVER:
  - Contain a scale-fact number the candidate didn't ask for (FIX-3)
  - Name a component the candidate hasn't mentioned
  - Name a technology they haven't mentioned
  - Bundle two questions into one
  - Restate their design back before asking (echoing)
  - Correct their math
  - Contain a section-transition phrase such as "walk me through ...",
    "let's move on to ...", "shall we get into ...", "now for the design",
    or any paraphrase, UNLESS move ∈ {HAND_OFF, WRAP_TOPIC}.

NEVER:
  - Issue CLOSE / interview_done=true when untouched sections remain and wall
    clock has > 3 minutes left (FIX-4). Rewrite to HAND_OFF instead.
  - Follow candidate "I don't know" / stuck with another probe on the SAME
    subtopic (FIX-5). Use PIVOT_ANGLE or SALVAGE_AND_MOVE.
  - Probe the same subtopic more than 3 consecutive times (FIX-1). At depth=3
    you MUST emit PIVOT_ANGLE / HAND_OFF / WRAP_TOPIC.
  - HAND_OFF a section whose EXIT GATE require_any has zero green signals if
    section budget still allows a probe (FIX-2). Probe for the missing signal
    first, or WRAP_TOPIC with a red incomplete flag if budget is spent.
  - Emit more than one consumed_probe_id per turn
  - Transition sections without HAND_OFF or WRAP_TOPIC
  - Use L3 probes when momentum=cold
  - Issue CLOSE on a meta-question ("are you stuck?", "is the interview over?")`;

/* --------------------------- Planner prompt --------------------------- */

function buildPrompt({ config, interview, sessionState, candidateMessage, interviewerReply }) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];

  // Focus section: prior turn's recommendation, else first.
  const priorFocusId = String(sessionState?.next_directive?.recommended_section_focus_id || '').trim();
  const { section: focus, index: focusIdx } = resolveFocusSection(config, priorFocusId);
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

  // Per-section time tracking.
  const sectionMinutesUsed = sessionState?.section_minutes_used || {};
  const sectionBudgetsBlock = buildSectionBudgetsBlock(sections, sectionMinutesUsed);

  // Current difficulty (from prior directive).
  const currentDifficulty = sessionState?.next_directive?.difficulty || 'L2';

  // Momentum from eval_history.
  const momentumHistory = computeMomentumFromHistory(sessionState?.eval_history);
  const momentumLine = momentumHistory.length > 0
    ? momentumHistory.join(', ')
    : 'insufficient data';

  // Probe queue + flags ACROSS sections.
  const probeQueueBlock = formatProbeQueueAcrossSections(sessionState?.probe_queue, sections);
  const flagsBlock = formatActiveFlags(sessionState?.flags_by_section, sections);
  const scoreboard = buildSectionScoreboard(sections, sessionState?.flags_by_section, sessionState?.probe_queue);
  const exitGatesBlock = buildSectionExitGatesBlock(sections, sessionState?.flags_by_section);
  const untouched = listUntouchedSections(sections, sessionState);
  const untouchedLabel = untouched.length > 0
    ? `[${untouched.map((s) => s.id).join(', ')}]`
    : '[] (all sections touched)';

  // Subtopic counter (FIX-1) — Planner-emitted, substrate-persisted.
  const priorSubtopic = String(sessionState?.next_directive?.current_subtopic || '').trim();
  const priorSubtopicCount = Number(sessionState?.next_directive?.consecutive_probes_on_subtopic) || 0;

  const turns = sectionWindowedTurns(interview, 12);
  const transcript = formatTranscriptBlock(turns);
  const canvasSnapshot = formatCanvasBlock(interview);

  // FOCUS RUBRIC (only for the focus section).
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

  // INTERVIEW PLAN (short form).
  const planLines = sections.map((s, i) =>
    `  ${i + 1}. ${s.id} (${Number(s.budget_minutes) || 0}m) — ${s.goal || s.label || s.id}`
  );

  const blocks = [
    ROLE_BLOCK,
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
        fault_scenarios: config?.fault_scenarios,
        raise_stakes_prompts: config?.raise_stakes_prompts,
      },
      null,
      2
    ),
    '',
    '=== RUNTIME STATE ===',
    `WALL CLOCK:        ${interviewElapsedMin.toFixed(1)}m / ${interviewTotalMin}m used (${interviewElapsedPct}%)`,
    `REMAINING:         ~${minutesLeft.toFixed(1)}m`,
    '',
    'SECTION BUDGETS:',
    sectionBudgetsBlock,
    '',
    `CURRENT SECTION:   ${focusId}`,
    `CURRENT DIFFICULTY: ${currentDifficulty}`,
    `CURRENT SUBTOPIC:           ${priorSubtopic || '(none yet)'}`,
    `CONSECUTIVE PROBES ON IT:   ${priorSubtopicCount}    (HARD CAP 3 — at >=3 you MUST PIVOT_ANGLE / HAND_OFF / WRAP_TOPIC, not probe again)`,
    '',
    `MOMENTUM (last 3 substantive performance assessments): ${momentumLine}`,
    `BAR TRAJECTORY (prior): ${sessionState?.next_directive?.bar_trajectory || 'flat'}`,
    '',
    'SECTION SCOREBOARD:',
    scoreboard,
    '',
    'SECTION EXIT GATES (FIX-2 — HAND_OFF requires gate passed OR section over budget):',
    exitGatesBlock,
    '',
    `SECTIONS UNTOUCHED (FIX-4 — CLOSE forbidden while these exist + time > 3m): ${untouchedLabel}`,
    '',
    'PROBE QUEUE:',
    probeQueueBlock,
    '',
    'ACTIVE FLAGS:',
    flagsBlock,
    '',
    'INTERVIEW PLAN — your structural roadmap (you decide WHEN to transition; the app does not):',
    planLines.join('\n'),
    '',
    focusRubricBlock,
    '',
    'TRANSCRIPT (last 12 turns):',
    transcript,
    '',
    canvasSnapshot ? `CANVAS:\n${canvasSnapshot}\n` : '',
    `LATEST INTERVIEWER TURN: ${String(interviewerReply || '').slice(0, 1000)}`,
    `LATEST CANDIDATE MESSAGE: ${String(candidateMessage || '').slice(0, 1500)}`,
    '',
    MOVE_CATALOG,
    '',
    DIFFICULTY_LEVELS,
    '',
    MOMENTUM_SYSTEM,
    '',
    TIME_MANAGEMENT,
    '',
    BAR_TRAJECTORY_SYSTEM,
    '',
    SIGNAL_CLASSIFICATION,
    '',
    THREAD_DEPTH_RULE,
    '',
    EXIT_GATES_RULE,
    '',
    SCALE_FACT_INJECTION_RULE,
    '',
    CLOSE_GATE_RULE,
    '',
    DECISION_ALGORITHM,
    '',
    HARD_PROHIBITIONS,
  ];

  return blocks.filter((b) => b !== null && b !== undefined).join('\n');
}

/* --------------------------- Capture call ----------------------------- */

export async function captureTurnEval({
  config,
  interview,
  sessionState,
  candidateMessage,
  interviewerReply,
}) {
  const prompt = buildPrompt({
    config,
    interview,
    sessionState,
    candidateMessage,
    interviewerReply,
  });

  const debugTrace = process.env.INTERVIEW_DEBUG_TRACE === '1';
  const startedAt = debugTrace ? Date.now() : 0;

  let result;
  try {
    result = await invokeLLM({
      prompt,
      response_json_schema: SCHEMA,
      modelTier: 'eval',
      temperature: 0.1,
      max_tokens: 1200,
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
      probe_observations: [],
      flags: [],
      momentum: 'warm',
      bar_trajectory: 'flat',
      performance_assessment: 'unclear',
      time_status: 'on_track',
      candidate_signal: 'driving',
      interview_done: false,
      notes: '',
    };
    if (debugTrace) {
      noop.__trace = {
        model: resolveOpenRouterModel('eval'),
        input_prompt: prompt,
        output_json: null,
        duration_ms: Date.now() - startedAt,
        error: err?.message || String(err),
      };
    }
    return noop;
  }

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
    probe_observations: Array.isArray(result?.probe_observations)
      ? result.probe_observations
          .map((p) => ({
            observation: String(p?.observation || '').slice(0, 200),
            probe: String(p?.probe || '').slice(0, 240),
            section_id: String(p?.section_id || '').trim().slice(0, 80),
            difficulty: DIFFICULTIES.includes(p?.difficulty) ? p.difficulty : 'L2',
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
      input_prompt: prompt,
      output_json: result,
      duration_ms: Date.now() - startedAt,
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
    const id = `pq_${turnIndex}_${i}`;
    sessionState.probe_queue[sid].push({
      id,
      observation: o.observation,
      probe: o.probe,
      difficulty: o.difficulty || 'L2',
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

/* --------------------------- Executor reply validator --------------- */

/**
 * Post-stream observability validator. Inspects the streamed Executor reply
 * for shape violations (multi-probe HAND_OFF, WRAP_TOPIC with a probe,
 * verbatim echoing). Records weak signals into captured.notes (does NOT
 * modify the reply — candidate already saw it).
 */
export function validateExecutorReply({ reply, derivedMove, candidateMessage }) {
  const out = { flags: [] };
  const text = String(reply || '');
  const normalized = normalizeForFuzzyMatch(text);
  if (!normalized) return out;

  const questionCount = (text.match(/\?/g) || []).length;
  if (derivedMove === 'WRAP_TOPIC' && questionCount > 0) {
    out.flags.push(`executor_wrap_with_probe: "${text.slice(0, 80)}"`);
  }
  if (derivedMove === 'HAND_OFF' && questionCount >= 2) {
    out.flags.push(`executor_handoff_multi_probe: "${text.slice(0, 80)}"`);
  }

  const candidateNorm = normalizeForFuzzyMatch(candidateMessage || '');
  if (candidateNorm.length >= 40 && normalized.length >= 40) {
    const words = candidateNorm.split(' ');
    for (let i = 0; i + 8 <= words.length; i += 1) {
      const slice = words.slice(i, i + 8).join(' ');
      if (slice.length >= 30 && normalized.includes(slice)) {
        out.flags.push(`executor_echoing: "${slice.slice(0, 80)}"`);
        break;
      }
    }
  }

  return out;
}

/* --------------------------- Persistence ------------------------------ */

/**
 * Apply the captured Planner result to interview.session_state (mutating).
 *
 * No section advancement, no validator self-heal, no coverage gates. The
 * Planner directs everything; JS persists.
 *
 * Section_id routing: probes / flags / time-tracking are keyed by the
 * Planner's `recommended_section_focus_id` (or per-item section_id).
 */
export function applyEvalToSessionState(
  interview,
  captured,
  { config, candidateMessage, candidateTurnIndex, interviewerReply = '', validatorResult = null }
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
  const { section: focus, index: focusIdx } = resolveFocusSection(config, hintId, priorFocusId);
  const focusId = focus?.id || '';

  // --- Per-section time tracking (advisory; computed before persisting next_directive).
  // Attribute the elapsed time since last_turn_ts to the PRIOR focus section
  // (the section we were just on), not the new one.
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

  // --- Leak guard on focus (blanks focus only; move stands).
  const rubricStrings = collectRubricStringsFromConfig(config);
  const leakMatch = focusLooksLikeRubricLeak(captured.recommended_focus, rubricStrings);
  let leakGuardTriggered = false;
  if (leakMatch) {
    console.warn('[planner] rubric leak in focus, blanking (move untouched)', {
      originalFocus: captured.recommended_focus,
      matchedRubric: leakMatch,
    });
    captured.recommended_focus = '';
    leakGuardTriggered = true;
  }

  // --- Executor reply leak (observability tripwire).
  let replyLeakTriggered = false;
  if (interviewerReply) {
    const replyLeak = focusLooksLikeRubricLeak(interviewerReply, rubricStrings);
    if (replyLeak) {
      console.warn('[executor] reply paraphrased rubric — observability only', {
        replySnippet: String(interviewerReply).trim().slice(0, 80),
        matchedRubric: replyLeak,
      });
      replyLeakTriggered = true;
    }
  }

  // --- Validator-emitted flags (notes only).
  const validatorFlags = Array.isArray(validatorResult?.flags) ? validatorResult.flags : [];

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

  // --- Wall-clock for FIX-4 CLOSE gate.
  const interviewStartTs = interview?.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : null;
  const interviewElapsedMin = interviewStartTs
    ? Math.max(0, (Date.now() - interviewStartTs) / 60000)
    : 0;
  const interviewTotalMin = Number(config?.total_minutes) ||
    sections.reduce((a, s) => a + (Number(s.budget_minutes) || 0), 0);
  const interviewElapsedFraction = interviewTotalMin > 0 ? interviewElapsedMin / interviewTotalMin : 0;
  const minutesRemaining = Math.max(0, interviewTotalMin - interviewElapsedMin);

  // --- FIX-4 CLOSE gate (substrate backstop).
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
    const closeAllowed =
      untouched.length === 0 || minutesRemaining < 3 || allOverBudget;
    if (!closeAllowed) {
      const target = pickPriorityUntouchedSection(untouched);
      const targetId = target?.id || resolvedFocusId;
      console.warn('[planner] CLOSE blocked by FIX-4 gate, downgrading to HAND_OFF', {
        untouchedIds: untouched.map((s) => s.id),
        minutesRemaining: Number(minutesRemaining.toFixed(1)),
        redirectedTo: targetId,
      });
      captured.move = 'HAND_OFF';
      captured.interview_done = false;
      captured.recommended_focus = '';
      captured.recommended_section_focus_id = targetId;
      // Reset subtopic counter — we're moving to a new section.
      captured.current_subtopic = '';
      captured.consecutive_probes_on_subtopic = 0;
      resolvedFocusId = targetId;
      closeBlockedReason = untouched.length > 0
        ? 'untouched_sections_with_time'
        : 'wall_clock_below_floor';
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
    time_status: captured.time_status,
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
  ss.eval_history.push({
    turn_index: candidateTurnIndex,
    notes: captured.notes,
    candidate_signal: captured.candidate_signal,
    performance_assessment: captured.performance_assessment,
    move: captured.move,
    difficulty: captured.difficulty,
    momentum: captured.momentum,
    bar_trajectory: captured.bar_trajectory,
    time_status: captured.time_status,
    recommended_section_focus_id: resolvedFocusId,
    current_subtopic: String(captured.current_subtopic || ''),
    consecutive_probes_on_subtopic: Number(captured.consecutive_probes_on_subtopic) || 0,
    interview_elapsed_fraction: Number(interviewElapsedFraction.toFixed(2)),
    consumed_probe_id: captured.consumed_probe_id || '',
    probe_observations_added: appendedProbeIds.length,
    flags_added_count: flagsAddedCount,
    leak_guard_triggered: leakGuardTriggered,
    reply_leak_triggered: replyLeakTriggered,
    close_blocked_reason: closeBlockedReason,
    validator_flags: validatorFlags,
    interview_done: !!captured.interview_done,
    at: new Date(),
  });
  if (ss.eval_history.length > 80) {
    ss.eval_history = ss.eval_history.slice(-80);
  }
  ss.last_eval_at = new Date();

  return { interviewDone };
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
  buildPrompt,
  sectionWindowedTurns,
  formatTranscriptBlock,
};
