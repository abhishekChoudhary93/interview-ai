import { invokeLLM } from './llmInvoke.js';
import { resolveOpenRouterModel } from '../config.js';
import { dump as dumpYaml, load as parseYaml } from 'js-yaml';

const MOVES = ['LISTEN', 'ASK', 'CHALLENGE', 'GUIDE', 'TRANSITION', 'CLOSE'];
const PHASES = ['requirements', 'high_level_design', 'deep_dive', 'scale_and_operations'];
const QUALITY = ['strong', 'adequate', 'weak', 'insufficient'];
const PROGRESS = ['exploring', 'deepening', 'spinning', 'complete'];
const SUBTOPIC_SIGNAL = ['new_insight', 'repetition', 'stuck'];
const MOMENTUM = ['driving', 'responding', 'struggling', 'stuck'];
const PERFORMANCE = ['above_bar', 'at_bar', 'below_bar', 'unclear'];
const TREND = ['improving', 'steady', 'declining'];
const RESPONSE_QUALITY = ['insightful', 'solid', 'superficial', 'confused'];
const VERDICT = ['strong_hire', 'hire', 'no_hire', 'strong_no_hire', 'insufficient_data'];
const CONFIDENCE = ['high', 'medium', 'low'];
const BUDGET_STATUS = ['on_track', 'slightly_over', 'significantly_over'];
const READINESS = ['ready', 'need_more_signal', 'forced_by_time'];
const SIGNAL_TYPE = ['green', 'red'];
const SIGNAL_WEIGHT = ['major', 'minor'];

const SCHEMA = {
  type: 'yaml',
  required: ['m', 'f', 'hier', 'cs', 'sig', 'done'],
  fields: {
    m: MOVES,
    hier: { ph: PHASES, pq: QUALITY, tpr: PROGRESS, ss: SUBTOPIC_SIGNAL },
    cs: { mom: MOMENTUM, perf: PERFORMANCE, trend: TREND, qual: RESPONSE_QUALITY },
    sig: {
      turnType: SIGNAL_TYPE,
      turnWeight: SIGNAL_WEIGHT,
      traj: VERDICT,
      conf: CONFIDENCE,
    },
  },
};

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeStr(value, max = 300) {
  return String(value || '').slice(0, max);
}

function sanitizeList(value, maxItems = 10, maxLen = 180) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => sanitizeStr(v, maxLen)).filter(Boolean).slice(0, maxItems);
}

function sanitizeTopicMap(value, maxTopics = 20, maxItemsPerTopic = 20) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [topic, subtopics] of Object.entries(value).slice(0, maxTopics)) {
    const key = sanitizeStr(topic, 80);
    if (!key) continue;
    out[key] = sanitizeList(subtopics, maxItemsPerTopic, 80);
  }
  return out;
}

function toPhaseId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'requirements';
  if (raw === 'requirements') return 'requirements';
  if (raw === 'design' || raw === 'high_level_design' || raw === 'high level design') return 'high_level_design';
  if (raw === 'deep_dive' || raw === 'deep dive') return 'deep_dive';
  if (raw === 'operations' || raw === 'scale and operations' || raw === 'scale_operations') return 'scale_and_operations';
  return 'requirements';
}

function toPhaseDirectiveId(label) {
  return toPhaseId(label);
}

function computeTotalMinutes(config) {
  const root = config?.interview_config || config || {};
  if (root?.time_budget?.total_min) return toNum(root.time_budget.total_min);
  if (root?.total_minutes) return toNum(root.total_minutes);
  const phases = Array.isArray(root?.interview_structure?.phases) ? root.interview_structure.phases : [];
  if (phases.length) return phases.reduce((sum, p) => sum + toNum(p?.budget_min), 0);
  const sections = Array.isArray(root?.sections) ? root.sections : [];
  return sections.reduce((sum, s) => sum + toNum(s?.budget_minutes), 0);
}

function mapConfigForPrompt(config) {
  return config?.interview_config || config || {};
}

const YAML_DUMP_OPTIONS = {
  noRefs: true,
  sortKeys: true,
  lineWidth: 120,
};

function compactPromptText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n[ \t]*\n+/g, '\n')
    .trim();
}

function sectionWindowedTurns(interview, cap = 12) {
  const turns = Array.isArray(interview?.conversation_turns) ? interview.conversation_turns : [];
  return turns.slice(-cap).map((t) => ({
    role: String(t?.role || 'candidate'),
    content: sanitizeStr(t?.content, 800),
  }));
}

function formatTranscriptBlock(turns) {
  if (!turns.length) return '(no turns yet)';
  return turns.map((t, i) => `${i + 1}. ${t.role.toUpperCase()}: ${t.content}`).join('\n');
}

const RAW_PLANNER_PROMPT_PREFIX = `
# Who You Are
You are an experienced FAANG staff engineer conducting a technical interview. You collect signal, calibrate performance, and make defensible hiring decisions through structured reasoning.
You output YAML; the Executor renders it into conversation.

# =============================================================================
# OUTPUT SCHEMA
# =============================================================================

m: <move>
f: <focus>
hier: {ph: <phase>, tp: <topic>, stp: <subtopic>, tt: <int>, tst: <int>, tph: <float>, pq: <quality>, tpr: <progress>, ss: <signal>}
cs: {mom: <momentum>, perf: <performance>, trend: <trend>, qual: <quality>}
sig:
  turn:
    - {t: <type>, o: <observation>, w: <weight>}
  sum: {str: <int>, wk: <int>, obs: [<pattern>]}
  traj: <trajectory>
  conf: <confidence>
done: <bool>

# =============================================================================
# FIELD DEFINITIONS
# =============================================================================

m: Your next interviewing action
   Values: LISTEN | ASK | CHALLENGE | GUIDE | TRANSITION | CLOSE

f: Exact words you say to candidate next (no praise/criticism, no solutions unless asked)

hier: Conversation hierarchy - where we are in the interview

  ph: Current phase (must follow order)
      Values: requirements | high_level_design | deep_dive | scale_and_operations
  
  tp: Current major component/area (e.g., "storage layer", "API design")
  
  stp: Specific detail within topic (e.g., "Redis TTL", "HTTP 301 vs 302")
  
  tt: Number of turns on current topic
  
  tst: Number of turns on current subtopic (3+ = consider pivoting)
  
  tph: Minutes elapsed in current phase
  
  pq: Signal quality collected in phase so far
      Values: strong | adequate | weak | insufficient
  
  tpr: Topic discussion productivity
       Values: exploring | deepening | spinning | complete
  
  ss: Subtopic insight quality
      Values: new_insight | repetition | stuck

cs: Candidate state - real-time performance assessment

  mom: How candidate drives conversation
       Values: driving | responding | struggling | stuck
  
  perf: Performance relative to L5 bar this section
        Values: above_bar | at_bar | below_bar | unclear
  
  trend: Performance direction over last 3-5 exchanges
         Values: improving | steady | declining
  
  qual: Response quality in recent exchanges
        Values: insightful | solid | superficial | confused

sig: Signals collected for hiring decision

  turn: Signals from this turn only (list of signal objects)
    t: Signal type (green | red)
    o: Brief specific evidence (20-50 chars)
    w: Signal weight (major | minor)
  
  sum: Summary across section
    str: Count of major green signals
    wk: Count of major red signals
    obs: Key patterns observed (2-3 items)
  
  traj: Overall hiring trajectory
        Values: strong_hire | hire | no_hire | strong_no_hire | insufficient_data
  
  conf: Confidence in trajectory
        Values: high | medium | low

done: Interview complete? (true | false)
###########################################################################

# Hierarchical State Management

## Three Levels of Granularity

SECTION (macro) - Major interview phase
It will always be these in the exact order - 
1. Requirements, 2. Design, 3.Deep Dive on Design and problems, 4. Operations and Scale
- Time scale: 7-15 minutes each
Your job is to ensure that the inteview covers all the critical areas and the candidate is able to answer the questions and the interview is going in the right direction.

TOPIC (meso) - Major component or area within section
- Look at the interview problem and configuration shared below, and then identify what are imporant sections for the question. You should refer configuration and have liberty to choose basis your understanding of the question and desired solution.
- Time scale: 2-5 minutes each
- Your job it to ensure that candidate should cover all major components and is able to explain his design choices for everything correctly.

SUBTOPIC (micro) - Specific detail within topic
These could be interesting problems or questions on the topic. For example (and not limited to) - cache choices, database choice etc. Always think of what the subtopic could be for grilling the candidate and understanding the depth that he/she understands it. It's a depth evaluation portion of the interview.
- Time scale: 1-2 turns each
- Your job is to ensure that we can confidently conclude whether candidate is and expert in the sub-topic and topic.

## How to Track

Update each turn:

yaml
hier:
  ph: high_level_design
  tp: caching_strategy
  stp: ttl_configuration
  tt: 4
  tst: 3
  tph: 12
  pq: adequate
  tpr: deepening
  ss: repetition

This tells you:
- We're in design section (12 min) - still within budget and we have enough signal to assess the candidate on this section.
- We're on caching topic (4 turns) - getting decent coverage and candidate is able to answer the questions and the interview is going in the right direction.
- We're on TTL subtopic (3 turns) - starting to repeat, time to pivot and move to the next subtopic.

# Reasoning Frameworks
## Framework 1: When to Pivot from Subtopic
Ask yourself:
1. Signal quality: Are we getting NEW insights, or is candidate repeating/stuck?
   - New insights → continue
   - Repetition/stuck → pivot

2. Turns on subtopic: How many consecutive turns?
   - 1-2 turns → usually productive
   - 3+ turns → usually diminishing returns (unless genuinely deep reasoning)

3. Breadth debt: Are there critical topics/subtopics untouched?
   - No gaps → depth is fine
   - Major gaps → breadth takes priority

4. Time pressure: How much section time remains?
   - Plenty of time → can afford depth
   - Running low → must fill gaps

Decision pattern:

IF (subtopic_turns >= 3 AND subtopic_signal == "repetition")
   OR (subtopic_turns >= 2 AND candidate_state == "stuck")
   OR (breadth_gaps == "major" AND section_time > 50%)
THEN consider pivoting to new subtopic/topic


How to pivot:
- Acknowledge their work: "Good coverage on TTL"
- Redirect without naming answer: "What else does caching need to handle?"
- Or shift topic: "Let's talk about how this connects to your storage layer"

## Framework 2: When to Transition Section
Ask yourself:
1. Signal quality: Do we have enough to assess them on this section?
   - Strong signal (green or red) on section goals → ready
   - Unclear/weak signal → need more

2. Coverage: Have we touched the critical areas?
   - All critical areas covered → ready
   - Major gaps → not ready (unless time forces it)

3. Time budget: Are we at/over section budget?
   - Within budget + poor signal → stay
   - Over budget → must transition (even if signal is weak)

4. Candidate signal: Did they indicate readiness?
   - "Should we move on?" → check coverage, decide
   - Still driving new content → let them continue

Decision pattern:

TRANSITION when:
  (signal_quality >= "adequate" AND coverage >= "adequate")
  OR (time_budget_status == "significantly_over")
  OR (candidate_explicitly_signals_readiness AND signal_quality != "insufficient")

STAY when:
  (signal_quality == "weak" AND time_budget_status == "on_track")


## Framework 3: When to Push Harder vs Ease Back

Assess performance trend over last 3-5 exchanges:

Push harder if:
- Consistently above-bar responses
- Proactively raising things you didn't ask
- Handling L2/L3 questions confidently
- Action: Inject failures, cost questions, multi-region, abuse scenarios

Steady pressure if:
- Consistently at-bar responses  
- Covering ground adequately when guided
- Some depth when pushed
- Action: Balance breadth and selective depth

Ease back if:
- Below-bar for 2+ consecutive exchanges
- Struggling even on L1 questions
- Going in circles or stuck
- Action: Narrow scope, give concrete anchors, find what they CAN do

Decision pattern:

IF last_3_turns_all(above_bar):
    difficulty_level = "L3"
    move_preference = "CHALLENGE with failures/cost/scale"

ELIF last_2_turns(below_bar):
    difficulty_level = "L1"
    move_preference = "GUIDE with narrowed scope or concrete anchor"

ELSE:
    difficulty_level = "L2"
    move_preference = "ASK with selective depth"


## Framework 4: Coverage Gaps vs Depth Tradeoff

Breadth-first principle:
IF section_areas_missing contains critical_components:
    IF section_time_used < 50%:
        priority = "fill breadth gaps"
    ELIF section_time_used >= 50% AND turns_on_subtopic >= 2:
        priority = "MUST pivot to breadth"
    ELSE:
        priority = "balanced - quick depth then breadth"
        
ELSE (all critical areas touched):
    priority = "selective depth on most interesting area"


Critical components:
- For design section: You know these topics and sub-topics based on your ouput 
- If ANY is untouched and we're 50%+ through section time → redirect

## Framework 5: Candidate Stuck - What to Do

Progressive support:

IF candidate_stuck:
    check turns_on_subtopic:
    
    IF turns_on_subtopic == 1:
        move = "Wait" (give 30-45s thinking time)
        
    ELIF turns_on_subtopic == 2:
        move = "GUIDE: clarify what they're stuck on"
        example: "What part are you uncertain about?"
        
    ELIF turns_on_subtopic == 3:
        move = "GUIDE: narrow scope to concrete sub-problem"
        example: "Let's focus on just the write path for now"
        
    ELSE (turns >= 4):
        move = "GUIDE: give one concrete anchor, or move to different topic"
        example: "Assume you're using PostgreSQL - how does that change things?"
        note: "Being stuck on X is signal - pivot to see what they CAN do"


Never: Keep probing the same stuck point beyond 2-3 turns. That's not collecting signal.

# Reasoning Trace (Captured in concise signal fields)

Force yourself to encode your reasoning via:
- hier.pq, hier.tpr, hier.ss
- cs.mom, cs.perf, cs.trend, cs.qual
- sig.turn[] evidence and sig.sum.obs

This forces you to:
1. Notice the pattern (3 turns on subtopic)
2. Check the state (breadth gaps, time used)
3. Apply the framework (breadth-first at 50%+ time)
4. Make a reasoned decision (not a rule execution)

# Interview Structure

Suggested flow (adapt based on candidate):

### 1. Requirements (~7 min)
Goal: Lock scope, NFRs, constraints before design

Coverage to hit:
- Functional requirements
- Non-functional requirements
- Scale estimates

Good signals:
- Drives discussion themselves
- Asks about scale before designing
- Names NFRs unprompted
- Quantifies (puts numbers on things)

Red flags:
- Jumps to architecture without requirements
- Doesn't ask about scale
- Only lists features, no NFRs

Transition when: Scope is clear, at least 2-3 NFRs agreed, candidate signals readiness

---

### 2. High-Level Design (~15 min)
Goal: Full system end-to-end coverage

Coverage to hit - <You should know this based on the interview problem and configuration shared below>

Breadth-first discipline:
- Don't go 3+ turns deep on one component while others are untouched
- At 50% section time, if major components missing → redirect to breadth

Good signals:
- Covers all major components unprompted
- Justifies technology choices
- Design is able to solve all requirements and NFRs called out above.
- Design is able to handle all the scale estimates called out above.

Transition when: All critical components touched, at least 1 or 2 component explored with depth

---

### 3. Deep Dive (~14 min)
Goal: Test genuine understanding under pressure

Depth opportunities (from config):
<You know the depth opportunities based on the interview problem and configuration shared below>

Good signals:
- Reasons about tradeoffs
- Surfaces edge cases
- Quantifies
- Discusses operational complexity

Transition when: Candidate has shown they can go deep OR they're struggling and we've found their floor
---

### 4. Operations (~8 min)
Goal:
- Can they run this in production at scale
- Can they handle the failure scenarios called out above.

Coverage to hit:
- Concrete SLO (p99 latency, availability %)
- Monitoring approach (what to measure)
- Alerting (what fires on-call)
- Failure scenario walkthrough

Transition when: Coverage adequate OR time running out (must save 5 min for close)

# Decision Checklist (Every Turn)

Before outputting YAML, run through:

1. Update hierarchy state
   - What section/topic/subtopic are we on?
   - How many turns on each?
   - What's the signal quality?

2. Check coverage
   - What's touched vs missing in this section?
   - Any critical gaps?

3. Assess candidate state
   - Driving, responding, struggling, or stuck?
   - Above/at/below bar this section?
   - Improving, steady, or declining?

4. Check time
   - How much section time used?
   - How much total time remains?
   - Transition pressure?

5. Apply framework
   - Subtopic pivot? (Framework 1)
   - Section transition? (Framework 2)
   - Difficulty adjustment? (Framework 3)
   - Breadth vs depth? (Framework 4)
   - Candidate stuck? (Framework 5)

6. Write reasoning trace
   - Situation + factors + rationale + alternative

7. Choose move and focus
   - One move (don't bundle)
   - Focus is candidate-facing (clean, professional)

---
`;

const PLANNER_PROMPT_PREFIX = compactPromptText(RAW_PLANNER_PROMPT_PREFIX);

function buildInterviewConfigurationSection(config) {
  return [
    '## CONFIGURATION',
    '```yaml',
    dumpYaml(mapConfigForPrompt(config), YAML_DUMP_OPTIONS).trimEnd(),
    '```',
  ].join('\n');
}

function buildRuntimeState(interview, config, sessionState, candidateMessage, interviewerReply) {
  const rootConfig = mapConfigForPrompt(config);
  const phases = Array.isArray(rootConfig?.interview_structure?.phases) ? rootConfig.interview_structure.phases : [];
  const firstPhase = phases[0] || {};
  const firstTopic = Array.isArray(firstPhase?.topics) ? firstPhase.topics[0] : null;
  const firstSubtopic = firstTopic && Array.isArray(firstTopic?.subtopics) ? firstTopic.subtopics[0] : null;
  const total = computeTotalMinutes(config);
  const started = interview?.session_started_at ? new Date(interview.session_started_at).getTime() : 0;
  const elapsed = started ? Math.max(0, (Date.now() - started) / 60000) : 0;
  const remaining = Math.max(0, total - elapsed);
  const priorRuntime = sessionState?.runtime_state || {};
  const priorHierarchy = priorRuntime?.conversation_hierarchy || {};
  const priorCandidateProgress = sessionState?.candidate_progress || {};
  return {
    interview_config: rootConfig,
    runtime_state: {
      time_management: {
        total_elapsed_minutes: Number(elapsed.toFixed(1)),
        total_remaining_minutes: Number(remaining.toFixed(1)),
        current_phase: toPhaseId(
          priorRuntime?.time_management?.current_phase ||
            priorHierarchy?.current_phase ||
            firstPhase?.id ||
            'requirements'
        ),
        phase_elapsed_minutes: toNum(priorRuntime?.time_management?.phase_elapsed_minutes, 0),
      },
      conversation_hierarchy: {
        current_phase: toPhaseId(priorHierarchy?.current_phase || firstPhase?.id || 'requirements'),
        current_topic: sanitizeStr(priorHierarchy?.current_topic || firstTopic?.id || 'interview_opening', 120),
        turns_on_phase: Math.max(1, Math.floor(toNum(priorHierarchy?.turns_on_phase, 1))),
        turns_on_topic: Math.max(1, Math.floor(toNum(priorHierarchy?.turns_on_topic, 1))),
        current_subtopic: sanitizeStr(priorHierarchy?.current_subtopic || firstSubtopic?.id || 'candidate_opening', 120),
        turns_on_subtopic: Math.max(1, Math.floor(toNum(priorHierarchy?.turns_on_subtopic, 1))),
      },
      candidate_state: sessionState?.planner_state?.candidate_state || {
        momentum: 'responding',
        performance_this_section: 'unclear',
        performance_trend: 'steady',
        response_quality: 'solid',
      },
    },
    candidate_progress: priorCandidateProgress,
    transcript: sectionWindowedTurns(interview, 12).map((t) => ({
      role: t.role,
      text: t.content,
    })),
    latest_turn: {
      interviewer: sanitizeStr(interviewerReply, 500),
      candidate: sanitizeStr(candidateMessage, 1200),
    },
  };
}

function buildPrompt({ config, interview, sessionState, candidateMessage, interviewerReply }) {
  const runtime = buildRuntimeState(interview, config, sessionState, candidateMessage, interviewerReply);
  const statePayload = dumpYaml(
    {
      interview_config: runtime.interview_config,
      runtime_state: runtime.runtime_state,
      candidate_progress: runtime.candidate_progress,
      transcript: runtime.transcript,
    },
    YAML_DUMP_OPTIONS
  ).trimEnd();
  return {
    system: [PLANNER_PROMPT_PREFIX, buildInterviewConfigurationSection(config)].join('\n\n'),
    user: [
      '## STATE PAYLOAD',
      '```yaml',
      statePayload,
      '```',
      'Your turn - output YAML only (no markdown fences).',
    ].join('\n'),
  };
}

function parsePlannerOutput(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = parseYaml(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to JSON parse fallback
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore malformed payloads and fall back to safe defaults
  }
  return {};
}

function normalizeResult(result) {
  const hier = result?.hier || {};
  const phaseObj = result?.conversation_hierarchy?.phase || result?.conversation_hierarchy?.section || {};
  const topicObj = result?.conversation_hierarchy?.topic || {};
  const subtopicObj = result?.conversation_hierarchy?.subtopic || {};
  const candidateState = result?.cs || result?.candidate_state || {};
  const signals = result?.sig || result?.signals_collected || {};
  const signalSummary = signals?.sum || signals?.section_summary || {};
  const signalTurn = signals?.turn || signals?.this_turn || [];
  const normalized = {
    move: MOVES.includes(result?.m) ? result.m : (MOVES.includes(result?.move) ? result.move : 'LISTEN'),
    focus: sanitizeStr(result?.f ?? result?.focus, 500),
    conversation_hierarchy: {
      phase: {
        current: toPhaseId(hier?.ph ?? phaseObj?.current),
        time_in_phase_min: toNum(
          hier?.tph ?? phaseObj?.time_in_phase_min ?? phaseObj?.time_in_section_min,
          0
        ),
        phase_signal_quality: QUALITY.includes(
          hier?.pq ?? phaseObj?.phase_signal_quality ?? phaseObj?.section_signal_quality
        )
          ? (hier?.pq ?? phaseObj?.phase_signal_quality ?? phaseObj?.section_signal_quality)
          : 'insufficient',
      },
      topic: {
        all_possible_topics_for_question: sanitizeList(
          topicObj?.all_possible_topics_for_question,
          30,
          80
        ),
        current: sanitizeStr(hier?.tp ?? topicObj?.current, 120),
        turns_on_topic: Math.max(0, Math.floor(toNum(hier?.tt ?? topicObj?.turns_on_topic, 0))),
        topic_progress: PROGRESS.includes(hier?.tpr ?? topicObj?.topic_progress)
          ? (hier?.tpr ?? topicObj?.topic_progress)
          : 'exploring',
      },
      subtopic: {
        all_possible_sub_topics_for_question: sanitizeTopicMap(
          subtopicObj?.all_possible_sub_topics_for_question
        ),
        current: sanitizeStr(hier?.stp ?? subtopicObj?.current, 120),
        turns_on_subtopic: Math.max(0, Math.floor(toNum(hier?.tst ?? subtopicObj?.turns_on_subtopic, 0))),
        subtopic_signal: SUBTOPIC_SIGNAL.includes(hier?.ss ?? subtopicObj?.subtopic_signal)
          ? (hier?.ss ?? subtopicObj?.subtopic_signal)
          : 'new_insight',
      },
    },
    candidate_state: {
      momentum: MOMENTUM.includes(candidateState?.mom ?? candidateState?.momentum)
        ? (candidateState?.mom ?? candidateState?.momentum)
        : 'responding',
      performance_this_section: PERFORMANCE.includes(candidateState?.perf ?? candidateState?.performance_this_section)
        ? (candidateState?.perf ?? candidateState?.performance_this_section)
        : 'unclear',
      performance_trend: TREND.includes(candidateState?.trend ?? candidateState?.performance_trend)
        ? (candidateState?.trend ?? candidateState?.performance_trend)
        : 'steady',
      response_quality: RESPONSE_QUALITY.includes(candidateState?.qual ?? candidateState?.response_quality)
        ? (candidateState?.qual ?? candidateState?.response_quality)
        : 'solid',
    },
    signals_collected: {
      this_turn: Array.isArray(signalTurn)
        ? signalTurn.slice(0, 6).map((s) => ({
            type: (s?.t ?? s?.type) === 'red' ? 'red' : 'green',
            observation: sanitizeStr(s?.o ?? s?.observation, 220),
            weight: (s?.w ?? s?.weight) === 'major' ? 'major' : 'minor',
          })).filter((s) => s.observation)
        : [],
      section_summary: {
        strong_signals: Math.max(0, Math.floor(toNum(signalSummary?.str ?? signalSummary?.strong_signals, 0))),
        weak_signals: Math.max(0, Math.floor(toNum(signalSummary?.wk ?? signalSummary?.weak_signals, 0))),
        key_observations: sanitizeList(signalSummary?.obs ?? signalSummary?.key_observations, 8, 180),
      },
      overall_trajectory: VERDICT.includes(signals?.traj ?? signals?.overall_trajectory)
        ? (signals?.traj ?? signals?.overall_trajectory)
        : 'insufficient_data',
      confidence_level: CONFIDENCE.includes(signals?.conf ?? signals?.confidence_level)
        ? (signals?.conf ?? signals?.confidence_level)
        : 'low',
    },
    time_management: {
      elapsed_min: toNum(result?.time_management?.elapsed_min, 0),
      remaining_min: toNum(result?.time_management?.remaining_min, 0),
      section_budget_status: BUDGET_STATUS.includes(result?.time_management?.section_budget_status)
        ? result.time_management.section_budget_status
        : 'on_track',
      should_transition_soon: result?.time_management?.should_transition_soon === true,
      transition_readiness: READINESS.includes(result?.time_management?.transition_readiness)
        ? result.time_management.transition_readiness
        : 'need_more_signal',
    },
    reasoning_trace: {
      situation_assessment: sanitizeStr(result?.reasoning_trace?.situation_assessment, 300),
      decision_factors: sanitizeList(result?.reasoning_trace?.decision_factors, 10, 160),
      decision_rationale: sanitizeStr(result?.reasoning_trace?.decision_rationale, 300),
      alternative_considered: sanitizeStr(result?.reasoning_trace?.alternative_considered, 220),
    },
    interview_done: result?.done === true || result?.interview_done === true,
  };
  normalized.recommended_focus = normalized.focus;
  normalized.recommended_phase_focus_id = toPhaseDirectiveId(normalized.conversation_hierarchy.phase.current);
  return normalized;
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

  try {
    const rawResult = await invokeLLM({
      messages,
      modelTier: 'eval',
      temperature: 0.1,
      max_tokens: 1800,
      onUsage,
    });
    const parsedResult = parsePlannerOutput(rawResult);
    const captured = normalizeResult(parsedResult);
    if (debugTrace) {
      captured.__trace = {
        model: resolveOpenRouterModel('eval'),
        input_prompt: `${system}\n\n${user}`,
        input_messages: messages,
        output_yaml: typeof rawResult === 'string' ? rawResult : '',
        output_parsed: parsedResult,
        duration_ms: Date.now() - startedAt,
        usage: capturedUsage,
      };
    }
    return captured;
  } catch (err) {
    console.warn(`[evalCapture] failed: ${err?.message || err}`);
    const fallback = normalizeResult({});
    if (debugTrace) {
      fallback.__trace = {
        model: resolveOpenRouterModel('eval'),
        input_prompt: `${system}\n\n${user}`,
        input_messages: messages,
        output_yaml: '',
        output_parsed: null,
        duration_ms: Date.now() - startedAt,
        usage: capturedUsage,
        error: err?.message || String(err),
      };
    }
    return fallback;
  }
}

const QUIT_SIGNAL_REGEX = /\b(?:let'?s end|let'?s stop|i\s+(?:quit|am\s+done|'?m\s+done)|end\s+(?:the|this)\s+interview|stop\s+(?:the|this)\s+interview)\b/i;

/**
 * Wall-clock elapsed minus accumulated pause time (ms).
 * @param {import('mongoose').Document | Record<string, unknown>} interview
 */
export function computeEffectiveElapsedMinutes(interview) {
  const startTs = interview?.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : 0;
  if (!startTs || Number.isNaN(startTs)) return 0;
  const ss = interview?.session_state || {};
  const totalPaused = Number(ss.total_paused_ms) || 0;
  const pausedAt = ss.paused_at_ms;
  const activePause =
    pausedAt != null && Number.isFinite(Number(pausedAt))
      ? Math.max(0, Date.now() - Number(pausedAt))
      : 0;
  return Math.max(0, (Date.now() - startTs - totalPaused - activePause) / 60000);
}

function minCloseMinutes(interview, config) {
  const targetMin =
    Number(interview?.target_duration_minutes) > 0
      ? Number(interview.target_duration_minutes)
      : computeTotalMinutes(config) || 45;
  return Math.max(30, targetMin * 0.9);
}

function buildPhaseTopicIndex(config) {
  const root = mapConfigForPrompt(config);
  const phases = Array.isArray(root?.interview_structure?.phases) ? root.interview_structure.phases : [];
  const phaseIds = new Set();
  const topicsByPhase = {};
  const subtopicsByTopic = {};
  for (const phase of phases) {
    const phaseId = toPhaseId(phase?.id);
    phaseIds.add(phaseId);
    const topics = Array.isArray(phase?.topics) ? phase.topics : [];
    topicsByPhase[phaseId] = topics.map((t) => String(t?.id || '').trim()).filter(Boolean);
    for (const topic of topics) {
      const topicId = String(topic?.id || '').trim();
      if (!topicId) continue;
      const subtopics = Array.isArray(topic?.subtopics) ? topic.subtopics : [];
      subtopicsByTopic[topicId] = subtopics.map((s) => String(s?.id || '').trim()).filter(Boolean);
    }
  }
  return { phaseIds, topicsByPhase, subtopicsByTopic };
}

function ensureCandidateProgressShape(existing, config) {
  const out = existing && typeof existing === 'object' ? existing : {};
  if (!out.phases || typeof out.phases !== 'object') out.phases = {};
  const root = mapConfigForPrompt(config);
  const phases = Array.isArray(root?.interview_structure?.phases) ? root.interview_structure.phases : [];
  for (const phase of phases) {
    const phaseId = String(phase?.id || '').trim();
    if (!phaseId) continue;
    if (!out.phases[phaseId]) out.phases[phaseId] = { status: 'untouched', topics: {} };
    if (!out.phases[phaseId].topics || typeof out.phases[phaseId].topics !== 'object') {
      out.phases[phaseId].topics = {};
    }
    const topics = Array.isArray(phase?.topics) ? phase.topics : [];
    for (const topic of topics) {
      const topicId = String(topic?.id || '').trim();
      if (!topicId) continue;
      if (!out.phases[phaseId].topics[topicId]) out.phases[phaseId].topics[topicId] = { status: 'missing', flags: [] };
      if (!Array.isArray(out.phases[phaseId].topics[topicId].flags)) out.phases[phaseId].topics[topicId].flags = [];
      if (!out.phases[phaseId].topics[topicId].status) out.phases[phaseId].topics[topicId].status = 'missing';
    }
  }
  return out;
}

export function applyEvalToSessionState(interview, captured, { config, candidateTurnIndex, candidateMessage = '' }) {
  if (!interview.session_state) interview.session_state = {};
  const ss = interview.session_state;
  if (!Array.isArray(ss.eval_history)) ss.eval_history = [];
  if (!Array.isArray(ss.raw_planner_outputs)) ss.raw_planner_outputs = [];
  if (!ss.runtime_state || typeof ss.runtime_state !== 'object') ss.runtime_state = {};
  ss.candidate_progress = ensureCandidateProgressShape(ss.candidate_progress, config);

  const totalMin = computeTotalMinutes(config);
  const elapsed = computeEffectiveElapsedMinutes(interview);
  const minCloseMin = minCloseMinutes(interview, config);
  let closeBlockedReason = null;

  if (QUIT_SIGNAL_REGEX.test(candidateMessage)) {
    captured.move = 'CLOSE';
    captured.focus = '';
    captured.recommended_focus = '';
    captured.interview_done = true;
  }
  const wantsClose = captured.move === 'CLOSE' || captured.interview_done === true;
  if (wantsClose && elapsed < minCloseMin) {
    closeBlockedReason = 'before_min_duration';
    if (captured.move === 'CLOSE') {
      captured.move = 'TRANSITION';
    }
    captured.interview_done = false;
  }

  const phaseIndex = buildPhaseTopicIndex(config);
  const prevHierarchy = ss.runtime_state?.conversation_hierarchy || {};
  const outHierarchy = captured.conversation_hierarchy || {};
  const outPhase = outHierarchy.phase || {};
  const outTopic = outHierarchy.topic || {};
  const outSubtopic = outHierarchy.subtopic || {};

  const phaseId = phaseIndex.phaseIds.has(outPhase.current)
    ? outPhase.current
    : toPhaseId(prevHierarchy.current_phase || 'requirements');
  const allowedTopics = phaseIndex.topicsByPhase[phaseId] || [];
  const topicId = allowedTopics.includes(outTopic.current)
    ? outTopic.current
    : (allowedTopics[0] || sanitizeStr(prevHierarchy.current_topic, 120));
  const allowedSubtopics = phaseIndex.subtopicsByTopic[topicId] || [];
  const subtopicId = allowedSubtopics.includes(outSubtopic.current)
    ? outSubtopic.current
    : (allowedSubtopics[0] || sanitizeStr(prevHierarchy.current_subtopic, 120));

  const turnsOnPhase = prevHierarchy.current_phase === phaseId
    ? Math.max(1, toNum(prevHierarchy.turns_on_phase, 1) + 1)
    : 1;
  const turnsOnTopic = prevHierarchy.current_topic === topicId
    ? Math.max(1, toNum(prevHierarchy.turns_on_topic, 1) + 1)
    : 1;
  const turnsOnSubtopic = prevHierarchy.current_subtopic === subtopicId
    ? Math.max(1, toNum(prevHierarchy.turns_on_subtopic, 1) + 1)
    : 1;

  ss.runtime_state = {
    time_management: {
      total_elapsed_minutes: Number(elapsed.toFixed(1)),
      total_remaining_minutes: Number(Math.max(0, totalMin - elapsed).toFixed(1)),
      current_phase: phaseId,
      phase_elapsed_minutes: Number(toNum(outPhase.time_in_phase_min, 0).toFixed(1)),
    },
    conversation_hierarchy: {
      current_phase: phaseId,
      current_topic: topicId,
      turns_on_phase: turnsOnPhase,
      turns_on_topic: turnsOnTopic,
      current_subtopic: subtopicId,
      turns_on_subtopic: turnsOnSubtopic,
    },
    candidate_state: captured.candidate_state,
  };

  const phaseProgress = ss.candidate_progress?.phases?.[phaseId];
  if (phaseProgress) {
    phaseProgress.status = 'in_progress';
    const topicProgress = phaseProgress?.topics?.[topicId];
    if (topicProgress) {
      topicProgress.status = turnsOnTopic >= 3 ? 'covered' : 'in_progress';
      const signals = Array.isArray(captured?.signals_collected?.this_turn)
        ? captured.signals_collected.this_turn
        : [];
      for (const signal of signals) {
        const note = sanitizeStr(signal?.observation, 200);
        if (!note) continue;
        const normalizedFlag = {
          turn: candidateTurnIndex,
          type: signal?.type === 'red' ? 'red' : 'green',
          note,
        };
        const exists = topicProgress.flags.some(
          (f) => f.turn === normalizedFlag.turn && f.type === normalizedFlag.type && f.note === normalizedFlag.note
        );
        if (!exists) topicProgress.flags.push(normalizedFlag);
      }
    }
  }

  ss.next_directive = {
    move: captured.move,
    focus: captured.focus || '',
    recommended_focus: captured.recommended_focus || captured.focus || '',
    recommended_phase_focus_id: captured.recommended_phase_focus_id || 'requirements',
    conversation_hierarchy: captured.conversation_hierarchy,
    candidate_state: captured.candidate_state,
    signals_collected: captured.signals_collected,
    time_management: captured.time_management,
    reasoning_trace: captured.reasoning_trace,
    generated_after_turn: candidateTurnIndex,
  };

  ss.planner_state = {
    conversation_hierarchy: captured.conversation_hierarchy,
    candidate_state: captured.candidate_state,
    signals_collected: captured.signals_collected,
    time_management: captured.time_management,
    reasoning_trace: captured.reasoning_trace,
  };

  const shouldCloseNow =
    captured.interview_done === true || captured.move === 'CLOSE';
  if (shouldCloseNow) {
    ss.pending_close = true;
    ss.interview_done = false;
  } else {
    ss.pending_close = false;
  }
  ss.raw_planner_outputs.push({
    turn_index: candidateTurnIndex,
    at: new Date(),
    output_json: captured,
  });
  if (ss.raw_planner_outputs.length > 120) ss.raw_planner_outputs = ss.raw_planner_outputs.slice(-120);

  ss.eval_history.push({
    turn_index: candidateTurnIndex,
    move: captured.move,
    focus: captured.focus,
    phase: captured.conversation_hierarchy?.phase?.current || 'requirements',
    trajectory: captured.signals_collected?.overall_trajectory || 'insufficient_data',
    confidence: captured.signals_collected?.confidence_level || 'low',
    elapsed_min: captured.time_management?.elapsed_min ?? Number(elapsed.toFixed(1)),
    remaining_min: captured.time_management?.remaining_min ?? Math.max(0, totalMin - elapsed),
    should_transition_soon: captured.time_management?.should_transition_soon === true,
    interview_done: shouldCloseNow,
    close_blocked_reason: closeBlockedReason,
    at: new Date(),
  });
  if (ss.eval_history.length > 120) ss.eval_history = ss.eval_history.slice(-120);
  ss.last_eval_at = new Date();
  return { interviewDone: shouldCloseNow, pendingClose: Boolean(ss.pending_close) };
}

export function warmPlannerPrefix({ config, interview }) {
  return Promise.resolve();
}

export { SCHEMA, MOVES, buildPrompt, normalizeResult, sectionWindowedTurns, formatTranscriptBlock };
