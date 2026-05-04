# BRAIN.md — Interview Engine v3

The orchestrated interview engine for a single problem (URL shortener), built on a Planner / Executor split with adaptive difficulty.

This document is the canonical map of where logic lives. Read it before changing prompts, the substrate state shape, or the debrief pipeline.

---

## 1. Architecture summary

```
            ┌──────────────────────┐
            │ interview-config/    │   single source of truth:
            │   url_shortener.json │   problem, sections, signals,
            └──────────┬───────────┘   leveling, scope, scale_facts,
                       │               fault_scenarios, raise_stakes_prompts,
                       │               interviewer persona
                       ▼
        ┌──────────────────────────────┐
        │ interviewSessionService.js   │  start session → snapshot config
        │   buildInitialSessionState   │  onto interview.interview_config
        └────────┬─────────────────────┘
                 │
   per turn ◀────┤
                 │
                 ▼
        ┌──────────────────────────────┐
        │ interviewConverse.js         │  pure pass-through to Executor LLM:
        │   streamInterviewerReply     │   no short-circuits, no classifiers.
        │   generateOpeningLine        │   The system prompt (OPENING PROTOCOL
        │                              │   section) tells the Executor how to
        │                              │   handle ack-vs-substance on T1.
        │                              │
        │ interviewConfig.js           │   buildProblemHandoff() returns
        │   buildProblemHandoff        │   config.problem.opening_prompt
        │                              │   as DATA for the system prompt.
        └────────┬─────────────────────┘
                 │
                 │  (Executor system prompt + history + candidate msg)
                 ▼
        ┌──────────────────────────────┐
        │ interviewSystemPrompt.js     │  builds the EXECUTOR system prompt
        │   buildSystemPrompt          │  (persona + 13 moves + difficulty
        │   MOVE_GUIDANCE              │   register + reference data + the
        │                              │   active directive only)
        └────────┬─────────────────────┘
                 │
                 │  streaming reply
                 ▼
        ┌──────────────────────────────┐
        │ interviewEvalCapture.js      │  PLANNER (background, post-stream)
        │   buildPrompt                │  inputs: full config, runtime state,
        │   captureTurnEval            │  transcript window, current focus
        │   applyEvalToSessionState    │  outputs: JSON directive (move,
        │   validateExecutorReply      │  difficulty, momentum, bar_trajectory,
        │   focusLooksLikeRubricLeak   │  time_status, focus, probes, flags,
        │                              │  interview_done)
        └────────┬─────────────────────┘
                 │
                 │  persists into interview.session_state
                 ▼
        ┌──────────────────────────────┐
        │ interviewCompleteService.js  │  on /complete:
        │   buildV3DebriefPrompt       │  reads flags_by_section + leveling
        │   generateStructuredDebrief  │  + transcript → structured debrief
        │   applyDebriefVerdictGuards  │  (deterministic verdict caps)
        └──────────────────────────────┘
```

Two LLMs per turn — Executor (streaming, fast tier) and Planner (background, eval tier). All problem-specific content lives in JSON; both LLM prompts are problem-agnostic.

### Single-problem mode

The engine ships exactly one problem: `interview-config/url_shortener.json`. Adding a second problem means dropping another JSON in that directory and adding a selector — out of scope for this work.

---

## 2. Per-turn data flow

```mermaid
sequenceDiagram
  participant C as Candidate
  participant API as POST /turn
  participant Stream as streamInterviewerReply
  participant ExecLLM as Executor LLM
  participant Plan as captureTurnEval
  participant PlanLLM as Planner LLM
  participant DB as interview.session_state

  C->>API: candidate_message
  API->>DB: appendCandidateTurn (writes user turn)
  API->>Stream: candidateMessage + interview + config
  Stream->>ExecLLM: system prompt + history + msg
  ExecLLM-->>Stream: tokens
  Stream-->>API: tokens streamed back to client
  API->>DB: appendInterviewerTurn (advances opening_phase if awaiting_ack)
  API-->>C: SSE done
  par background eval
    API->>Plan: candidateMessage + interviewerReply + config
    Plan->>PlanLLM: builds v3 prompt (config + runtime + transcript)
    PlanLLM-->>Plan: JSON directive
    Plan->>DB: applyEvalToSessionState (FIX-4 CLOSE-gate guard,
            then persist new directive, flags, probes,
            section_minutes_used, eval_history)
  end
```

The directive Planner emits this turn becomes the directive Executor reads next turn. There is one turn of latency by design — it lets the Executor stream immediately.

### Opening protocol (no short-circuits)

T0 is the deterministic intro line ("Hi, I'm Alex...") generated by `generateOpeningLine` and written into `conversation_turns` at session start. From T1 onward the Executor LLM handles every turn. The OPENING PROTOCOL section of the Executor's system prompt:

- Always renders (no JS branch on `opening_phase`).
- Embeds `config.problem.opening_prompt` verbatim as DATA inside a `<<<...>>>` reference block.
- Tells the Executor: when the candidate's message is a procedural ack, render that reference block verbatim; when the candidate has already begun framing the problem, engage with their content directly without reciting.
- Tells the Executor to ignore the entire section once a Planner directive is present (i.e. from T2 onward).

The substrate just advances `opening_phase: awaiting_ack → in_progress` on the first interviewer reply. No content classification anywhere in JS.

---

## 3. Config schema (`backend/src/interview-config/url_shortener.json`)

Top-level keys:

| Field | Used by | Purpose |
| --- | --- | --- |
| `interview_type`, `target_level`, `total_minutes` | Planner, debrief, opening | Interview metadata. |
| `interviewer` | Executor (persona injection), opening line, ProblemPanel | `{ name, title, company, style_note }`. |
| `problem` | Executor reference, OPENING PROTOCOL (system prompt DATA), ProblemPanel, debrief metadata | `{ title, brief, opening_prompt }`. `opening_prompt` is embedded verbatim inside the Executor's OPENING PROTOCOL section; the LLM decides whether to render it (candidate acked) or engage with substance instead. |
| `scale_facts[]` | Executor reference (ANSWER_AND_RELEASE) | `{ label, value, share_only_if_asked }`. The Executor shares one fact at a time when the candidate asks. |
| `scope.{in_scope, out_of_scope}` | Executor reference | What's in / out. The Executor pushes back if the candidate goes out of scope. |
| `sections[]` | Planner (FOCUS RUBRIC + per-section budget + EXIT GATES), debrief (per-section evidence + leveling), Executor (section plan listing) | Each section: `{ id, label, budget_minutes, goal, objectives, good_signals[], weak_signals[], faang_bar, signals[{id, description}], exit_gate{require_any[signal_id], description}, leveling{one_down, target, one_up} }`. The Planner's flags are tagged with `signal_id` from this list. The `exit_gate.require_any` list is the set of signal_ids — at least one must be GREEN before the Planner is allowed to HAND_OFF (FIX-2). |
| `fault_scenarios[]` | Executor (rendering), Planner (move selection) | Strings. The Planner picks one when emitting `INJECT_FAULT`; the Executor renders it grounded in what the candidate has said. |
| `raise_stakes_prompts[]` | Executor (rendering), Planner (move selection) | Strings. The Planner picks one when emitting `RAISE_STAKES`. |

A config edit doesn't retroactively change interview rows: at session start the full config is snapshotted onto `interview.interview_config`.

---

## 4. Substrate state (`interview.session_state`)

```js
{
  opening_phase: 'awaiting_ack' | 'in_progress',
  turn_count: number,                       // interviewer turn counter (HARD_TURN_CAP=60)
  session_wall_start_ms: number,            // ms timestamp at startSession
  session_ended_at_ms: number | null,       // set by recordSessionEndMetadata
  last_turn_ts: number,                     // ms timestamp of previous turn

  // Audit trail of every Planner emission.
  eval_history: [{
    turn_index, move, difficulty, momentum, bar_trajectory, time_status,
    recommended_section_focus_id, performance_assessment, candidate_signal,
    current_subtopic, consecutive_probes_on_subtopic,                // v4 FIX-1
    consumed_probe_id, probe_observations_added, flags_added_count,
    leak_guard_triggered, reply_leak_triggered, validator_flags,
    close_blocked_reason,                                            // v4 FIX-4 (substrate guard)
    interview_elapsed_fraction, interview_done, notes, at,
  }],

  // Planner's questions to come back to.
  probe_queue: {
    [section_id]: [{
      id, observation, probe, difficulty, added_at_turn,
      consumed, consumed_at_turn,
    }],
  },

  // Bar judgment per section. Drives the debrief.
  flags_by_section: {
    [section_id]: [{ type: 'green' | 'red', signal_id, note, at_turn }],
  },

  // Advisory time budgeting. Updated each turn from the prior focus section.
  section_minutes_used: { [section_id]: number },

  // Latest performance read per section (skips 'unclear' turns).
  performance_by_section: {
    [section_id]: 'above_target' | 'at_target' | 'below_target',
  },

  // Last directive applied. Read by the Executor next turn.
  next_directive: {
    move, difficulty, recommended_focus, recommended_section_focus_id,
    consumed_probe_id, momentum, bar_trajectory, time_status, answer_only,
    current_subtopic, consecutive_probes_on_subtopic,                // v4 FIX-1
    generated_after_turn,
  },

  interview_done: boolean,

  // Local-only when INTERVIEW_DEBUG_TRACE=1.
  debug_trace: [{ turn_index, ts, candidate_message, executor, planner }],
}
```

### Fields explicitly removed from v2

`signals.{strong, weak}`, `live_evaluation`, `current_section_index`, `section_started_at`, `skipped_signals_by_section`, `interrupt_count_by_section`, `consecutive_*` counters, `section_nudge_count`, `rubric_updates`, `coverage_evidence`. None are read by v3 code.

---

## 5. Planner prompt (interviewEvalCapture.js → buildPrompt)

Block order (matters — the Planner reads top-down):

1. **Role block** — Planner identity, three-decision framing (clock → momentum → move).
2. **=== INTERVIEW CONFIG ===** — full config JSON injected (problem, scope, scale_facts, fault_scenarios, raise_stakes_prompts, interview_type, target_level, total_minutes).
3. **=== RUNTIME STATE ===** —
   - `WALL CLOCK` (elapsed / total, %)
   - `REMAINING` minutes
   - `SECTION BUDGETS` (per-section bucketed `on_track` / `behind` / `critical`; thresholds `<0.75` / `0.75–1.0` / `≥1.0`)
   - `CURRENT SECTION` (from prior directive's `recommended_section_focus_id`)
   - `CURRENT DIFFICULTY` (from prior directive)
   - **`CURRENT SUBTOPIC`** (v4 FIX-1 — from prior directive's `current_subtopic`; the rabbit-hole detector reads this)
   - **`CONSECUTIVE PROBES ON IT`** (v4 FIX-1 — from prior directive's `consecutive_probes_on_subtopic`; HARD CAP 3, at >=3 the Planner MUST emit `PIVOT_ANGLE` / `HAND_OFF` / `WRAP_TOPIC`)
   - `MOMENTUM` (last 3 substantive `performance_assessment` values)
   - `BAR TRAJECTORY` (prior)
   - `SECTION SCOREBOARD` (g/r counts + open probe count + last_touch turn)
   - **`SECTION EXIT GATES`** (v4 FIX-2 — per section: `gate=[signal_ids]` + `passed | NOT_PASSED` + `greens: [collected]`. `HAND_OFF` is invalid unless `passed` OR section over budget.)
   - **`SECTIONS UNTOUCHED`** (v4 FIX-4 — list of section ids with no flags / probes / `eval_history` entries; `CLOSE` is invalid while this list is non-empty AND wall clock has > 3 minutes left)
   - `PROBE QUEUE` (across sections, top 3 most recent unconsumed)
   - `ACTIVE FLAGS` (recent 4 per section)
   - `INTERVIEW PLAN` (id + budget + goal per section)
   - `FOCUS RUBRIC` (focus section only — goal, objectives, good_signals, weak_signals, faang_bar, signal ids, leveling triplet)
   - `TRANSCRIPT (last 12)`
   - `CANVAS` (when present)
   - `LATEST INTERVIEWER TURN` / `LATEST CANDIDATE MESSAGE`
4. **MOVE CATALOG** — **15 moves** (v4 added `PIVOT_ANGLE`), grouped (Listening 2, Probing 6, Lateral 1, Difficulty-down 3, Transition 3 incl. CLOSE). `CLOSE` carries the FIX-4 gate inline; `HAND_OFF` carries the FIX-2 exit-gate constraint inline.
5. **DIFFICULTY LEVELS** — L1/L2/L3 + difficulty assignment rule.
6. **ADAPTIVE DIFFICULTY SYSTEM** — momentum calculation table, momentum → interview shape.
7. **TIME MANAGEMENT SYSTEM** — per-section budget thresholds, total budget compression rules, hard 40% cap per section, compression priority.
8. **BAR TRAJECTORY SYSTEM** — `rising` / `flat` / `falling` triggers and their plan implications.
9. **CANDIDATE SIGNAL CLASSIFICATION** — `driving` / `asked_question` / `block_complete` / `stuck` / `procedural` + tie-break rule. `stuck` (incl. "I don't know") now defaults to `PIVOT_ANGLE` / `SALVAGE_AND_MOVE`. Procedural also covers META-QUESTIONS about the interview ("are you stuck?", "is the interview over?") — these map to `LET_LEAD`, NEVER `CLOSE` / `WRAP_TOPIC`.
10. **THREAD DEPTH RULE (v4 FIX-1)** — at `consecutive_probes_on_subtopic >= 3` the Planner MUST emit `PIVOT_ANGLE` (lateral move within section) or `HAND_OFF` / `WRAP_TOPIC`. Same-subtopic counter is Planner-emitted, substrate-persisted, and visible in RUNTIME STATE the next turn.
11. **EXIT GATES (v4 FIX-2)** — `HAND_OFF` is invalid unless at least one signal in the section's `exit_gate.require_any` list is GREEN, OR the section is over budget (in which case `WRAP_TOPIC` with red `section_incomplete` flag).
12. **SCALE-FACT INJECTION CHECK (v4 FIX-3)** — pre-flight scan of `recommended_focus` for any number from `config.scale_facts`. If a number appears AND the candidate didn't ask, the Planner must rewrite the question without the number OR convert the move to `DRAW_NUMBERS`.
13. **CLOSE GATE (v4 FIX-4)** — `CLOSE` / `interview_done=true` is valid ONLY when (1) every section has a flag or was `WRAP_TOPIC`'d, AND (2) wall clock has < 3 minutes left OR every section is at-or-over budget. Otherwise → `HAND_OFF` to highest-priority untouched section. Priority order: `deep_dive > operations > tradeoffs > high_level_design > requirements`.
14. **"I DON'T KNOW" HANDLING (v4 FIX-5)** — explicit no-shortcut: `stuck` never collapses to `CLOSE` and never re-probes the same subtopic. Ladder: `PIVOT_ANGLE` (if other angles exist) → `SALVAGE_AND_MOVE` → `HAND_OFF` to next untouched section.
15. **DECISION ALGORITHM** — 10-step ordered procedure: time check → signal classify → momentum → **thread depth check (v4)** → **scale-fact injection check (v4)** → difficulty → move → **close gate check (v4)** → focus write → flags/probes/trajectory. The `asked_question → ANSWER_AND_RELEASE` row is tightened to spell out: `recommended_focus = exactly ONE fact, ONE dimension, never bundle, never append a transition phrase`. The HAND_OFF GUARD now requires EXIT GATE passed AND one of (block_complete | critical | behind+gate-passed | thread-depth >=3 with no other angle).
16. **HARD PROHIBITIONS** — `recommended_focus` must never: contain a scale-fact number the candidate didn't ask for (FIX-3), name unmentioned components, bundle, restate (echo), correct math, or contain a section-transition phrase UNLESS move ∈ `{HAND_OFF, WRAP_TOPIC}`. Plus: never CLOSE with untouched sections + time > 3m (FIX-4); never re-probe same subtopic after stuck (FIX-5); never >3 consecutive probes on same subtopic (FIX-1); never HAND_OFF a zero-green-on-gate section while budget allows a probe (FIX-2); never CLOSE on a meta-question.

### Output schema (JSON)

```js
{
  move: enum (13 moves),
  difficulty: 'L1' | 'L2' | 'L3',
  recommended_section_focus_id: string,         // routes flags/probes/time
  recommended_focus: string,                    // candidate-facing question
  consumed_probe_id: string,
  probe_observations: [{
    observation, probe, section_id, difficulty   // probe = pre-formed question text
  }],
  flags: [{
    type: 'green' | 'red',
    section_id,
    signal_id,                                  // from config.sections[].signals[]
    note,
  }],
  momentum: 'hot' | 'warm' | 'cold',
  bar_trajectory: 'rising' | 'flat' | 'falling',
  performance_assessment: 'above_target' | 'at_target' | 'below_target' | 'unclear',
  time_status: 'on_track' | 'behind' | 'critical',
  candidate_signal: 'driving' | 'asked_question' | 'block_complete' | 'stuck' | 'procedural',
  interview_done: boolean,
  notes: string,
}
```

### Persistence (applyEvalToSessionState)

Per turn, mutates `session_state`:

1. Resolve focus section: planner's `recommended_section_focus_id` → fallback to a flag/probe `section_id` → fallback to prior focus → fallback to first section.
2. **Time tracking**: `(now - last_turn_ts) / 60000` is added to `section_minutes_used[priorFocusId]`. Set `last_turn_ts = now`.
3. **Performance**: write `performance_by_section[focusId] = performance_assessment` if not `unclear`.
4. **Leak guard**: scan `recommended_focus` against `config.sections[].good_signals + faang_bar`. On a hit, blank the focus (move stays — that's the Planner's call).
5. **Reply leak (observability only)**: scan the streamed Executor reply against the same rubric; record on eval_history but no UX impact.
6. **Probes**: append `probe_observations` into `probe_queue[section_id]`. Cap at 12 unconsumed per section.
7. **Consume**: if `consumed_probe_id` matches an open queue item, mark consumed and (when focus is empty) mirror `item.probe` into `recommended_focus`.
8. **Flags**: append into `flags_by_section[section_id]`. Cap at 24 per section.
9. **FIX-4 CLOSE-gate guard (substrate backstop)**: if `move == 'CLOSE'` or `interview_done == true`, recompute untouched sections (after this turn's flags/probes are persisted). If untouched sections exist AND wall clock has > 3 minutes left AND not every section is at-or-over budget → downgrade `move` to `HAND_OFF`, blank `recommended_focus`, set `recommended_section_focus_id` to the highest-priority untouched section (`deep_dive > operations > tradeoffs > high_level_design > requirements`), reset subtopic counter, and record `eval_history[].close_blocked_reason`. The Planner is told to enforce this itself; the substrate is the safety net.
10. **Directive**: persist `next_directive` for the next Executor turn (incl. derived `answer_only = (move === 'ANSWER_AND_RELEASE')`, `current_subtopic`, and `consecutive_probes_on_subtopic`).
11. **Termination**: `interview_done = true` if Planner emitted true OR move is `CLOSE` AND the FIX-4 gate did not block.
12. **Audit**: push a row onto `eval_history` (capped at 80) including `current_subtopic`, `consecutive_probes_on_subtopic`, and `close_blocked_reason`.

---

## 6. Executor prompt (interviewSystemPrompt.js → buildSystemPrompt)

Block order:

1. **Role & Mission** — `You are {interviewer.name}, {title} at {company}. ...` Style note appended if present.
2. **Persona** — voice, register, anti-cheerleader.
3. **Opening Protocol** — always rendered. Embeds `config.problem.opening_prompt` verbatim as DATA. Defines Case A (ack → render verbatim) and Case B (substance → engage directly). Case B (v4-followup) explicitly offers two branches: ANSWER_AND_RELEASE on ONE scope question OR ack-and-let-them-continue (`"Got it. Continue."`); and **NEVER tack a section transition** (`"walk me through your storage design"`, `"how would you architect X"`, `"how does this handle Y at scale"`) onto an opening-turn reply. The interviewer does NOT advance past requirements until the Planner emits `HAND_OFF` on a later turn. Tells the Executor to ignore this entire section once a Planner directive is present. The LLM decides whether the section applies by reading the conversation history + the Directive block contents — no JS branch.
4. **Directive** — always rendered. The Planner's last emission as `Move / Difficulty / Focus / Momentum / Bar trajectory / Time` plus the **active move's MOVE_GUIDANCE row only** (token-efficient — saves ~200 tokens vs shipping all 14 rows). Includes the leak-guard sentence (with strict-FIX-7-compliant fallbacks `"Mhm." / "Got it." / "Continue." / "Take me through it."` — the previous fallback `"Where do you want to take it?"` was removed because FIX-7 lists it as forbidden), the anti-advance sentence, the **ANTI-ECHO** sentence (don't repeat back enumerated terms; drop to a one-word ack instead), and the **LIVE OVERRIDE** clause: if the candidate's latest message contains a direct scope or scale question (`"is X in scope?"`, `"what's the QPS?"`), treat as `ANSWER_AND_RELEASE` regardless of the directive's move — pick exactly ONE dimension, answer in one short clause, drop the rest silently, no follow-up probe, no section transition appended. This is the substrate-level safety net for stale directives that don't reflect the live message (the Planner's directive is one turn behind by design — see §2). When `next_directive` is null, the body is a literal placeholder line `(no directive — opening turn; follow the Opening Protocol section above)` so the LLM knows the OPENING PROTOCOL is active.
5. **Difficulty Register** — L1/L2/L3 delivery shifts.
6. **Hard Output Rules** — prose only, 3-sentence cap, one question per turn, no praise, math-error handling, diagram sync (TWO RULES — never claim inability AND never claim ability without verification, v4 FIX-8). Adds explicit **emote / stage-direction prohibition** (`*leans forward*`, `*pauses*`, etc., v4 FIX-9) and **passive-surrender prohibition** (v4 FIX-7, sharpened in v4-followup to cover BOTH whole-interview direction AND within-section choices; forbidden phrases now include `"Where do you want to take it?"`, `"What would you like to cover next?"`, `"Pick whichever of those interests you more"`, `"Which would you like to focus on?"`, `"What's next on your list?"` — when the candidate asks a multi-part scope question, the interviewer picks which one to answer and silently drops the rest). Carries a generic GOOD/BAD example pair for scope confirmations: `GOOD: "Auth is out of scope. Continue."` (interviewer picks one, drops the other silently); `BAD: "Pick whichever of those two interests you more."` is now itself a BAD example.
7. **Long Response Handling (v4 FIX-6)** — when the candidate writes >150 words, pick EXACTLY ONE specific phrase and probe only that. Forbids the "Got it. <new topic>" formula. Includes the "no two consecutive turns starting with the same one-word ack" rule. Carries a WRONG/RIGHT example anchored on a >400-word caching essay.
8. **Four Anti-Patterns** — Seeding, Bundling, Math correction, Echoing. Bundling (v4-followup expansion) now also forbids combining a scope answer with a section transition in the same reply (`"auth is out — walk me through your storage design"`); section transitions belong only in HAND_OFF or WRAP_TOPIC. Echoing's GOOD example was rewritten to strict-FIX-7-compliant `"Got it. Continue."` (the previous example used `"Where do you want to take it?"` which is now forbidden). A second WRONG/RIGHT example pair anchored on the T2 regression transcript is appended to the block.
9. **Channel** — chat (typing/written) vs voice (TTS-spoken).
10. **Problem** — `config.problem.title + brief`.
11. **Scope** — `config.scope.{in_scope, out_of_scope}`.
12. **Scale Facts** — `config.scale_facts[]` (one per turn, only when asked).
13. **Fault Scenarios** — `config.fault_scenarios[]` (used only on `INJECT_FAULT`).
14. **Raise-Stakes** — `config.raise_stakes_prompts[]` (used only on `RAISE_STAKES`).
15. **Section Plan** — `config.sections[]` listing with `(Nm)` budgets. Reminds the Executor: **the Planner controls all transitions**.
16. **Canvas snapshot** — Excalidraw `canvas_text` if any, otherwise placeholder. Carries the v4 FIX-8 TWO RULES (never claim inability; never fabricate ability) with explicit forbidden phrases for both directions.

### MOVE_GUIDANCE map (15 entries — v4 added PIVOT_ANGLE)

`LET_LEAD` (one of "Mhm.", "Okay.", "Fair.", "Go on.", "Right.", "Continue." — the Executor LLM emits these directly; there is no deterministic ack pool in JS), `ANSWER_AND_RELEASE` (carries a GOOD/BAD example pair: one fact, no transition), `GO_DEEPER`, `CHALLENGE_ASSUMPTION`, `CHALLENGE_TRADEOFF`, `DRAW_NUMBERS`, `INJECT_FAULT` (render `config.fault_scenarios[i]` matter-of-factly anchored on what the candidate has described), `RAISE_STAKES` (render `config.raise_stakes_prompts[i]` collegially), **`PIVOT_ANGLE`** (v4 FIX-1 — acknowledge in one short clause that you've covered that area, then move to the new angle in ONE sentence; carries a GOOD/BAD example pair), `NARROW_SCOPE`, `PROVIDE_ANCHOR`, `SALVAGE_AND_MOVE`, `HAND_OFF` (carries a GOOD/BAD example pair: ONLY HAND_OFF and WRAP_TOPIC may include a section-transition phrase), `WRAP_TOPIC`, `CLOSE`.

---

## 7. Adaptive difficulty mechanics

The Planner emits `difficulty: L1 | L2 | L3` every turn. The Executor's Difficulty Register translates that into delivery pressure (collegial / specifics-pushing / staff-bar).

Difficulty is selected by **momentum**:

- `cold` → step DOWN one level (floor L1)
- `warm` → hold
- `hot` → step UP one level if last 2 substantive turns were at-or-above target (cap L3)

Momentum itself is computed by the Planner from the last 3 substantive `performance_assessment` values in `eval_history`. The Planner sees the last-3 list in the prompt's `MOMENTUM` line, so the JS substrate doesn't compute the bucket — the Planner does.

Bar trajectory (`rising`/`flat`/`falling`) is the cross-section view: how performance is trending across already-touched sections. It modulates the **remaining** plan: `rising` → skip foundational L1 probes and use freed time for L3 raises; `falling` → breadth over depth, one clean answer per section.

---

## 8. Time management mechanics

Two clocks, advisory only — the Planner decides what to do with them.

### Per-section budget (`section_minutes_used` substrate)

- Updated every turn: `delta = (now - last_turn_ts) / 60000` is added to the **prior** focus section (the section we were just on, before any transition this turn).
- Bucketed for the Planner prompt's `SECTION BUDGETS` block:
  - `< 0.75` → `on_track`
  - `0.75–1.0` → `behind`
  - `≥ 1.0` → `critical`
- The Planner's `time_status` field reflects the focus section's bucket.

### Total interview wall clock

Computed in the Planner prompt from `interview.session_started_at` vs. `config.total_minutes`. When `<50%` budget remains for remaining sections, the Planner is told to compress (cut extra probes in early sections first).

### Hard rule

No single section may consume `>40%` of total interview time. The Planner is told this in the `TIME MANAGEMENT SYSTEM` block; the JS does not enforce. (The hard `HARD_TURN_CAP=60` interviewer turns is the JS safety net.)

---

## 9. Probe queue

A queue of "things worth coming back to" the Planner builds as the interview progresses.

Per item: `{ id, observation, probe, difficulty, added_at_turn, consumed, consumed_at_turn }`. The key v3 change is `probe` — a pre-formed candidate-facing question, not just an `observation`. When the Planner consumes a queue item, the JS substrate mirrors `item.probe` (not `item.observation`) into `recommended_focus`, so the Executor renders the actual question.

Probes are routed by `section_id` so HAND_OFF can carry a probe targeting a future section.

Caps: 12 unconsumed per section, 2 new probes per turn, 1 consumption per turn.

---

## 10. Failure-mode triage

| Symptom | Most likely cause | Where to look |
| --- | --- | --- |
| Executor names a topic the candidate didn't raise | Planner wrote rubric vocabulary into `recommended_focus` and the leak guard didn't catch it | `eval_history[].leak_guard_triggered`; tighten `LEAK_GUARD_STOPWORDS` or extend `collectRubricStringsFromConfig` |
| Same probe asked twice | Planner missed the queue's `consumed` flag | Inspect `probe_queue[section]` for items with `consumed=false` long after they should have been |
| Stuck in one section | Planner not emitting `HAND_OFF` despite `time_status=critical` | `eval_history[].time_status` + `section_minutes_used`; confirm `SECTION BUDGETS` block in the prompt is rendering correctly |
| **Rabbit-holed in one sub-topic for 4+ turns** (v4 FIX-1) | Planner ignored `consecutive_probes_on_subtopic >= 3` rule | `eval_history[].current_subtopic` + `consecutive_probes_on_subtopic`. Confirm the THREAD DEPTH RULE block + RUNTIME STATE counter are rendering. If the Planner keeps failing this, add a JS backstop in `applyEvalToSessionState` that forces `PIVOT_ANGLE` at depth >= 4. |
| **Section exited without quantification** (v4 FIX-2) | Planner emitted HAND_OFF before `exit_gate.require_any` had any green | Inspect SECTION EXIT GATES block in the planner prompt for the section + `flags_by_section[id]`. Confirm `exit_gate` is defined in the section's config. |
| **Interviewer seeded a scale fact** (v4 FIX-3 — e.g. "How does your design handle 500,000 redirects/sec?") | Planner wrote a number from `scale_facts` into `recommended_focus` without the candidate asking | Inspect the rendered `recommended_focus`; confirm SCALE-FACT INJECTION CHECK block fires in the planner prompt. Could add a JS post-scan as a backstop. |
| **CLOSE fired with sections untouched** (v4 FIX-4) | Planner ignored the CLOSE GATE rule; substrate FIX-4 backstop should catch it | `eval_history[].close_blocked_reason`. If `null` and `move=CLOSE` happened with untouched sections, the backstop didn't fire — check `listUntouchedSections` against the actual flag/probe state at time of guard. |
| **"I don't know" → CLOSE / repeated same-subtopic probe** (v4 FIX-5) | Planner skipped the stuck ladder | `eval_history[]` — was the prior `candidate_signal=stuck` and the next `move=CLOSE`? If so, sharpen the I-DON'T-KNOW HANDLING block. |
| **Executor confirmed seeing diagram that wasn't there** (v4 FIX-8) | Executor fabricated "Yes, I can see it now" | Check `interview.canvas_text` at time of reply — if empty, the executor lied. Strengthen the canvas section's TWO RULES wording. |
| **Executor used an emote (`*leans forward*`)** (v4 FIX-9) | Executor ignored the explicit emote prohibition | Strengthen HARD_OUTPUT_RULES emote line; consider adding a JS post-scan validator that strips `\*[^*]+\*` from streamed replies. |
| **Executor said "Where do you want to take it?"** (v4 FIX-7) | Executor ignored the passive-surrender prohibition | Inspect HARD_OUTPUT_RULES "NO passive surrender" block; consider adding a `validateExecutorReply` flag for the forbidden-phrase list. |
| **Executor wrote "Got it." then asked about a brand-new topic on a long candidate response** (v4 FIX-6) | Executor ignored the Long Response Handling section | Confirm the LONG_RESPONSE_HANDLING block is rendering; tighten the example pair if needed. |
| LET_LEAD ack instead of an expected probe | Previous directive carried `move=LET_LEAD`; the Executor LLM rendered the strict ack per `MOVE_GUIDANCE.LET_LEAD` | Check `eval_history[]` last entry — was the latest directive really LET_LEAD? Tighten the Planner's STEP 7 / decision rules if it should have probed |
| Opening reply ignores candidate's substantive first turn | Executor LLM mis-classified Case A/B in the OPENING PROTOCOL section | Inspect the executor trace (`debug_trace[].executor`); if the candidate clearly gave substance and the LLM still recited the verbatim problem statement, sharpen the Case B language in `formatOpeningProtocol` |
| Reply bundles scope answers + a transition phrase | Either the Planner emitted bundled `recommended_focus` OR the Executor ignored the ANSWER_AND_RELEASE strictness | `eval_history[].notes` and the Planner's raw output JSON; check the HAND_OFF GUARD wasn't bypassed |
| **Bundled scope answer + section pivot** (v4-followup T2 regression — e.g. "Auth is out, include analytics. Walk me through your storage design.") | Stale Planner directive (LET_LEAD from prior procedural turn) + missing executor-side override for live scope questions; pre-fix the canonical GOOD example used a now-forbidden phrase, breaking the safe fallback | LIVE OVERRIDE clause in `formatDirective` (always renders, regardless of move); strict-FIX-7-compliant Bundling expansion with the T2 example in `ANTI_PATTERNS`; tightened OPENING PROTOCOL Case B that forbids tacking transitions onto opening-turn replies. If it still happens, sharpen the LIVE OVERRIDE wording or add a `validateExecutorReply` flag for "scope answer + transition phrase in same reply". |
| **Executor used a now-forbidden positive example phrase** (v4-followup audit) | A canonical GOOD example in HARD_OUTPUT_RULES, ANTI_PATTERNS, or the DIRECTIVE block contains a phrase FIX-7 added to the forbidden list | Audit positive examples after every FIX-7 expansion; the model freezes when the same prompt says a phrase is both GOOD and FORBIDDEN. The audit applies to: HARD_OUTPUT_RULES scope-confirmation example, ANTI_PATTERNS Echoing example, DIRECTIVE leak-guard fallback. |
| Interview ends too early | Planner emitted `interview_done=true` or `move=CLOSE`; FIX-4 substrate guard should have caught it but didn't | `eval_history[]` last row; check `close_blocked_reason`; or HARD_TURN_CAP hit (60 interviewer turns) |
| Debrief says "Incomplete — Cannot Assess" | Total session under 15 minutes OR section coverage <40% | `recordSessionEndMetadata` → `applyDebriefVerdictGuards` |
| Frontend doesn't show interviewer name | `interview.interview_config.interviewer` missing — config not snapshotted | Confirm `startInterviewSession` ran and persisted `interview_config` |

Enable `INTERVIEW_DEBUG_TRACE=1` for a per-turn timeline under `session_state.debug_trace[]` (Planner prompt + output, Executor prompt + history + reply). Surfaced via `GET /interviews/:clientId/debug-trace` and `/interview/:id/debug` in the frontend.

---

## 11. Tuning points

When you want to change interviewer behavior, prefer config edits over prompt edits.

| What you want to tune | Where to change it |
| --- | --- |
| Interviewer's name / title / company / style | `interview-config/url_shortener.json` → `interviewer` |
| Problem statement, opening line | `interview-config/url_shortener.json` → `problem` |
| What "good" / "weak" looks like in a section | `interview-config/url_shortener.json` → `sections[i].{good_signals, weak_signals, faang_bar}` |
| Per-level expectations (L4 / L5 / L6) | `interview-config/url_shortener.json` → `sections[i].leveling` |
| Section EXIT GATE (which signals must be green before HAND_OFF, FIX-2) | `interview-config/url_shortener.json` → `sections[i].exit_gate.require_any` |
| Section time budget | `interview-config/url_shortener.json` → `sections[i].budget_minutes` |
| What faults the Planner can inject | `interview-config/url_shortener.json` → `fault_scenarios[]` |
| Staff-bar pushes | `interview-config/url_shortener.json` → `raise_stakes_prompts[]` |
| Difficulty register wording (how L3 sounds vs L1) | `interviewSystemPrompt.js` → `DIFFICULTY_REGISTER` |
| Per-move rendering rules (incl. GOOD/BAD examples for ANSWER_AND_RELEASE / HAND_OFF) | `interviewSystemPrompt.js` → `MOVE_GUIDANCE` |
| Opening protocol Case A / Case B language | `interviewSystemPrompt.js` → `formatOpeningProtocol` |
| Anti-echo / anti-bundle examples (generic GOOD/BAD pairs) | `interviewSystemPrompt.js` → `HARD_OUTPUT_RULES`, `ANTI_PATTERNS` |
| HAND_OFF GUARD conditions, transition-phrase prohibition | `interviewEvalCapture.js` → `DECISION_ALGORITHM`, `HARD_PROHIBITIONS` |
| Thread depth cap (rabbit-hole prevention, FIX-1) | `interviewEvalCapture.js` → `THREAD_DEPTH_RULE` (soft 3, hard via PIVOT_ANGLE prompt rule) |
| Exit-gate semantics (FIX-2) | `interviewEvalCapture.js` → `EXIT_GATES_RULE` + `buildSectionExitGatesBlock` |
| Scale-fact injection scan (FIX-3) | `interviewEvalCapture.js` → `SCALE_FACT_INJECTION_RULE` (prompt-only; could add JS post-scan) |
| CLOSE gate (untouched-section / wall-clock floor, FIX-4) | `interviewEvalCapture.js` → `CLOSE_GATE_RULE` (prompt) + `applyEvalToSessionState` step 9 (JS backstop) |
| "I don't know" ladder (FIX-5) | `interviewEvalCapture.js` → `CLOSE_GATE_RULE` "I DON'T KNOW HANDLING" sub-block + `SIGNAL_CLASSIFICATION` |
| Long-response one-thing-only rule (FIX-6) | `interviewSystemPrompt.js` → `LONG_RESPONSE_HANDLING` |
| Passive-surrender forbidden phrases (FIX-7, including v4-followup within-section coverage) | `interviewSystemPrompt.js` → `HARD_OUTPUT_RULES` "NO passive surrender" line |
| LIVE OVERRIDE for live scope/scale questions (v4-followup safety net for stale directives) | `interviewSystemPrompt.js` → `formatDirective` "LIVE OVERRIDE:" clause |
| Opening-turn no-section-pivot rule (v4-followup) | `interviewSystemPrompt.js` → `formatOpeningProtocol` Case B "NEVER tack a section transition" block |
| Bundling anti-pattern (incl. "scope answer + section transition" combo, v4-followup) | `interviewSystemPrompt.js` → `ANTI_PATTERNS` Bundling line + the appended WRONG/RIGHT example |
| Diagram TWO RULES (no false ability claim, FIX-8) | `interviewSystemPrompt.js` → `formatCanvasSnapshot` + `HARD_OUTPUT_RULES` "Diagram sync" line |
| Emote / stage-direction prohibition (FIX-9) | `interviewSystemPrompt.js` → `HARD_OUTPUT_RULES` "NO emotes" line |
| PIVOT_ANGLE rendering (FIX-1 executor side) | `interviewSystemPrompt.js` → `MOVE_GUIDANCE.PIVOT_ANGLE` |
| Untouched-section priority order (FIX-4 redirect target) | `interviewEvalCapture.js` → `UNTOUCHED_PRIORITY` array |
| Momentum thresholds, time bucketing rules, decision algorithm | `interviewEvalCapture.js` → static blocks (`MOMENTUM_SYSTEM`, `TIME_MANAGEMENT`, `DECISION_ALGORITHM`, `HARD_PROHIBITIONS`) |
| Leak-guard sensitivity | `interviewEvalCapture.js` → `LEAK_GUARD_STOPWORDS`, `leakGuardStem`, `focusLooksLikeRubricLeak` thresholds |
| Verdict caps | `interviewCompleteService.js` → `applyDebriefVerdictGuards` |
| LET_LEAD ack vocabulary | `interviewSystemPrompt.js` → `MOVE_GUIDANCE.LET_LEAD` (the Executor LLM emits these directly — no JS pool) |
| Hard turn safety cap | `interviewSessionService.js` → `HARD_TURN_CAP` |

### Prompt budget reality check

- Planner prompt fills out at ~12–16k characters with a hot session (v4 added five new policy blocks + RUNTIME STATE counters; +~2k chars vs v3) — still well under the eval tier's context window.
- Executor prompt stays under 16k characters per turn (tested) — v4 added the LONG_RESPONSE_HANDLING block, PIVOT_ANGLE move guidance, the expanded TWO RULES canvas section, and the emote / passive-surrender lines in HARD_OUTPUT_RULES; v4-followup added the LIVE OVERRIDE clause in the DIRECTIVE block, the tightened OPENING PROTOCOL Case B (no opening-turn section pivots), the strict-FIX-7 within-section wording with new forbidden phrases, and the expanded Bundling anti-pattern with the T2 regression example. The active-move-only MOVE_GUIDANCE rendering still keeps this within budget.

---

## 12. What the JS substrate does NOT do

Things the substrate explicitly does not own (Planner LLM owns these):

- Section transitions (no `current_section_index` advancement).
- Coverage gates — the Planner decides when to wrap.
- Move overrides — the Planner's `move` is trusted; the JS only validates the enum.
- Performance scoring — the Planner emits `performance_assessment`; the JS just writes it.
- Difficulty bumping — the Planner emits `difficulty`; the JS does not climb-the-ladder on its own.

The JS substrate's job is: load config, route flags/probes by `section_id`, account for time per section, persist directives for the next turn, leak-guard the focus, and run the verdict caps in the debrief.

---

## 13. Debrief pipeline

`finalizeOrchestratedInterview` (called from `POST /interviews/:id/session/complete`):

1. `recordSessionEndMetadata` — records elapsed time, planned time, section coverage map (derived from `flags_by_section` + `performance_by_section` + `section_minutes_used` + `eval_history.recommended_section_focus_id`).
2. `extractHistorySignals` — separate LLM extraction for the cross-session signal snapshot (used for future personalization). Same as v2.
3. `generateStructuredDebrief` (v3 version) →
   - `buildV3DebriefPrompt(config, sessionState, interview)` — packs per-section flag evidence, leveling triplets, momentum trajectory, and the full transcript.
   - LLM call with `SD_DEBRIEF_SCHEMA` (verdict, verdict_reason, overall_score, section_scores nested with signal rows, top_moments, faang_bar_assessment, next_session_focus).
   - `normalizeSdStructuredDebrief` — coerces `not_reached` sections to a stable empty shape.
   - `applyDebriefVerdictGuards` — deterministic caps: <15min → Incomplete; section coverage <40% → Incomplete; <60% → cap at No Hire; score-band rules; `not_reached` ⇒ no Strong Hire.
4. Save `interview.debrief`. Derive `interview.overall_score` (0–100) from the rubric fraction for the dashboard.

---

## 14. Out of scope (for v3 cutover)

- Multi-problem support — out of scope; reintroduce by adding configs and a selector.
- Migrating in-flight rows from the v2 `execution_plan` shape — they may render the legacy debrief path or fail gracefully (verdict: Incomplete). Old rows still display via the legacy fallbacks in `Report.jsx` and `interviewReport.js`.
- Voice / canvas / SSE transports — wire format unchanged; only payload field names changed (`execution_plan` → `interview_config`).
- UI persona switching — would require `config.interviewer` to be overridable per-row.
