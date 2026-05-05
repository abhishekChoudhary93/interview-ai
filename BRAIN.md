# BRAIN.md — Interview Engine v5

The orchestrated interview engine for a single problem (URL shortener), built on a Planner / Executor split. The Planner is the "mind of an experienced FAANG interviewer" — it decides what happens next from a JSON directive. The Executor is the voice the candidate hears — it renders the directive in 1–3 sentences in persona.

This document is the canonical map of where logic lives. Read it before changing prompts, the substrate state shape, or the debrief pipeline.

---

## 1. Architecture summary

```
            ┌──────────────────────┐
            │ interview-config/    │   single source of truth:
            │   url_shortener.json │   problem, sections, signals, leveling,
            └──────────┬───────────┘   scope, scale_facts, fault_scenarios,
                       │               raise_stakes_prompts, variant_scenarios,
                       │               required_breadth_components,
                       │               deep_dive_topics, interviewer persona
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
        │   generateOpeningLine        │   T0 is now LLM-generated: ONE warm
        │   warmExecutorPrefix         │   intro+problem message in persona.
        │                              │   warmExecutorPrefix preheats the
        │                              │   DeepSeek context cache at session
        │                              │   start (fire-and-forget).
        │                              │
        │ interviewConfig.js           │   buildProblemHandoff() returns
        │   buildProblemHandoff        │   config.problem.opening_prompt
        │                              │   as DATA for the opening LLM call.
        └────────┬─────────────────────┘
                 │
                 │  (Executor system prompt + history (last 60 msgs)
                 │   + candidate msg)
                 ▼
        ┌──────────────────────────────┐
        │ interviewSystemPrompt.js     │  builds the EXECUTOR system prompt
        │   buildSystemPrompt          │  (persona + Human Feel + Move
        │   MOVE_GUIDANCE              │   Rendering Reference + Difficulty
        │                              │   Register + Hard Output Rules +
        │                              │   Anti-Patterns + Reference Data
        │                              │   + the active directive only)
        └────────┬─────────────────────┘
                 │
                 │  streaming reply
                 ▼
        ┌──────────────────────────────┐
        │ interviewEvalCapture.js      │  PLANNER (background, post-stream)
        │   buildPrompt                │  inputs: full config, runtime state
        │   captureTurnEval            │   (incl. requirements_contract,
        │   applyEvalToSessionState    │   breadth_coverage, response_pace,
        │   warmPlannerPrefix          │   verdict_trajectory), 12-turn
        │                              │   transcript window
        │                              │  substrate guards (post-LLM,
        │                              │   pre-persist):
        │                              │    quit-signal → CLOSE
        │                              │    thread-depth>=4 → PIVOT_ANGLE
        │                              │    seeding-leak → rewrite focus
        │                              │  outputs: JSON directive (move,
        │                              │   difficulty, focus, contract,
        │                              │   breadth, pace, verdict, momentum,
        │                              │   bar_trajectory, time_status,
        │                              │   probes, flags, interview_done)
        └────────┬─────────────────────┘
                 │
                 │  persists into interview.session_state
                 ▼
        ┌──────────────────────────────┐
        │ interviewCompleteService.js  │  on /complete:
        │   buildV5DebriefPrompt       │  reads contract + breadth_coverage
        │   generateStructuredDebrief  │  + flags_by_section + leveling +
        │   applyDebriefVerdictGuards  │  verdict_trajectory + transcript →
        │                              │  structured debrief (deterministic
        │                              │  verdict caps still apply)
        └──────────────────────────────┘
```

Two LLMs per turn — Executor (streaming, fast tier) and Planner (background, eval tier). All problem-specific content lives in JSON; both LLM prompts are problem-agnostic.

### Single-problem mode

The engine ships exactly one problem: `interview-config/url_shortener.json`. Adding a second problem means dropping another JSON in that directory and adding a selector — out of scope for this work.

### Models and cache pin

All four tiers (Executor, Planner, Opening, Debrief) run on `deepseek/deepseek-chat` (DeepSeek-V3) per `.env.local`. DeepSeek-V3 is the known-good baseline for Planner flag-emission and the seeding-leak / earn-before-name discipline; gpt-4.1-mini regressed on both. `OPENROUTER_PROVIDERS=DeepSeek` pins routing to DeepSeek's official infra (`provider.order=[DeepSeek], allow_fallbacks=false`) — required for native context caching. Without the pin, OpenRouter may route to third-party hosters (Fireworks/Together/Novita/DeepInfra) that do not implement the cache.

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
  Stream->>ExecLLM: system prompt + last 60 turns + msg
  ExecLLM-->>Stream: tokens
  Stream-->>API: tokens streamed back to client
  API->>DB: appendInterviewerTurn (advances opening_phase if awaiting_ack)
  API-->>C: SSE done
  par background eval
    API->>Plan: candidateMessage + interviewerReply + config
    Plan->>PlanLLM: builds v5 prompt (config + runtime state +
            12-turn transcript + contract + breadth + pace +
            verdict_trajectory)
    PlanLLM-->>Plan: JSON directive
    Plan->>DB: applyEvalToSessionState
            ("45-min CLOSE floor" guard, then persist contract/breadth/pace,
             new directive, flags, probes, section_minutes_used,
             eval_history)
  end
```

The directive Planner emits this turn becomes the directive Executor reads next turn. There is one turn of latency by design — it lets the Executor stream immediately.

### Opening (LLM-generated, single message)

T0 is one LLM-generated message in persona, combining the Alex intro + problem statement in 2-3 sentences. `generateOpeningLine` calls the LLM with a small dedicated system prompt that bakes in `config.interviewer` persona and embeds `config.problem.opening_prompt` as DATA. The fallback path (no API key, parser failure) synthesizes the same message deterministically from the same inputs so the session can still start in offline / test environments.

This replaces the prior two-message handshake (deterministic intro on T0 + a verbatim problem render on T2 via an OPENING PROTOCOL block in the Executor system prompt). The OPENING PROTOCOL block is gone; the Executor system prompt no longer references it.

Right after T0 is written, `startInterviewSession` fires `warmExecutorPrefix` and `warmPlannerPrefix` as fire-and-forget promises. Both helpers send a tiny request against the byte-stable system prefix of their respective tier (Executor system prompt with empty session_state; Planner system block from `buildPrompt`) so DeepSeek's native context cache is warm before the candidate's first turn lands.

The substrate just advances `opening_phase: awaiting_ack → in_progress` on the first interviewer reply (T1 — a minimal ack of the candidate's first message). No content classification anywhere in JS.

---

## 3. Conversation history flow

Both LLMs see history; they see it differently because their jobs are different.

**Executor** (the streaming voice — needs conversational continuity):

- Receives the full `conversation_turns` (last 60 messages — bumped from 40 in v5) as proper `assistant`/`user` chat-completion messages, plus the system prompt and the new candidate message.
- 60 ≈ 30 candidate + 30 interviewer turns, which covers a full 50-min session. A smaller window risks the Executor dropping the requirements-phase turns by the time it's in operations and contradicting the locked contract.

**Planner** (JSON-mode brain — needs recent context plus structured memory):

- Receives the **last 12 turns** as flat transcript inside its single prompt (matches v5 `RUNTIME STATE` template), plus the most recent interviewer reply and candidate message called out separately.
- The 12-turn window is small on purpose. The Planner's long-term memory comes from substrate, not from re-reading the whole transcript:
  - `requirements_contract` (persisted once locked, immutable) — Phase 1 decisions carry forward.
  - `breadth_coverage.components_mentioned` (snapshot, updated each turn) — what's been raised.
  - `flags_by_section[]` (capped 24/section) — bar evidence already filed.
  - `eval_history[]` (capped 80) — momentum / verdict_trajectory / pace history per turn.
  - `next_directive.consecutive_probes_on_subtopic` — rabbit-hole counter.

A turn-30 Planner doesn't re-derive that the contract was locked on turn 6 — it reads `requirements_contract.locked_at_turn`. This is the architectural choice that makes a 12-turn transcript window viable across a 50-min interview.

---

## 4. Config schema (`backend/src/interview-config/url_shortener.json`)

Top-level keys:

| Field | Used by | Purpose |
| --- | --- | --- |
| `interview_type`, `target_level`, `total_minutes` | Planner, debrief, opening | Interview metadata. |
| `interviewer` | Executor (persona injection), opening line, ProblemPanel | `{ name, title, company, style_note }`. |
| `problem` | Opening LLM call (DATA), Executor reference, ProblemPanel, debrief metadata | `{ title, brief, opening_prompt }`. `opening_prompt` is embedded as DATA in the opening LLM call (and the deterministic fallback) — the candidate sees it once, in persona, on T0. |
| `scale_facts[]` | Executor reference (ANSWER_AND_RELEASE) | `{ label, value, share_only_if_asked }`. The Executor shares one fact at a time when the candidate asks. |
| `scope.{in_scope, out_of_scope}` | Executor reference | What's in / out. The Executor pushes back if the candidate goes out of scope. |
| `required_breadth_components[]` (v5 NEW) | Planner (RUNTIME STATE → BREADTH COVERAGE; drives `NUDGE_BREADTH`) | Flat list of the components a senior candidate must cover in HLD. The Planner emits `breadth_coverage.components_missing = required - mentioned` each turn. |
| `sections[]` | Planner (FOCUS RUBRIC + per-section budget + EXIT GATES), debrief (per-section evidence + leveling), Executor (section plan listing) | 4 sections in v5: `requirements`, `high_level_design`, `deep_dive`, `operations`. Each: `{ id, label, budget_minutes, goal, objectives, good_signals[], weak_signals[], faang_bar, signals[{id,description}], exit_gate{require_any[signal_id], description}, leveling{one_down,target,one_up} }`. The `deep_dive` section additionally carries `deep_dive_topics[]` (v5 NEW) — `[{id,label,description,what_good_looks_like}]` for the differentiated topics. |
| `fault_scenarios[]` | Executor (rendering), Planner (move selection) | Strings. The Planner picks one when emitting `INJECT_FAULT`; the Executor renders it grounded in what the candidate has said. |
| `raise_stakes_prompts[]` | Executor (rendering), Planner (move selection) | Strings. Planner picks one when emitting `RAISE_STAKES`. |
| `variant_scenarios[]` (v5 NEW) | Executor (rendering), Planner (move selection) | Strings. Planner picks one when emitting `INJECT_VARIANT` (used when momentum=hot or response_pace=suspiciously_fast — twist a contract requirement to test genuine reasoning). |

A config edit doesn't retroactively change interview rows: at session start the full config is snapshotted onto `interview.interview_config`.

---

## 5. Substrate state (`interview.session_state`)

```js
{
  opening_phase: 'awaiting_ack' | 'in_progress',
  turn_count: number,                       // interviewer turn counter (HARD_TURN_CAP=60)
  session_wall_start_ms: number,            // ms timestamp at startSession
  session_ended_at_ms: number | null,       // set by recordSessionEndMetadata
  last_turn_ts: number,                     // ms timestamp of previous turn

  // v5 NEW: locked once Planner emits requirements_contract.locked=true.
  // Substrate refuses to overwrite after that — first lock wins.
  requirements_contract: null | {
    locked: true,
    functional: string[],
    non_functional: string[],
    in_scope: string[],
    out_of_scope: string[],
    locked_at_turn: number,
  },

  // v5 NEW: snapshot, overwritten each turn from the Planner emission.
  breadth_coverage: {
    components_mentioned: string[],
    components_missing:   string[],
  },

  // v5 NEW: latest pace classification + how many consecutive turns at it.
  response_pace: 'fast' | 'normal' | 'slow' | 'suspiciously_fast' | null,
  pace_turns_tracked: number,

  // v5 NEW: cross-section verdict picture, updated every substantive turn.
  verdict_trajectory: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire' | 'insufficient_data',

  // Audit trail of every Planner emission (capped at 80).
  eval_history: [{
    turn_index, move, difficulty, momentum, bar_trajectory, verdict_trajectory,
    time_status, response_pace, pace_turns_tracked,
    recommended_section_focus_id, performance_assessment, candidate_signal,
    current_subtopic, consecutive_probes_on_subtopic,
    requirements_contract_locked_at_turn, contract_locked_this_turn,
    breadth_components_missing_count,
    consumed_probe_id, probe_observations_added, flags_added_count,
    close_blocked_reason,                          // 'wall_clock_below_45m' | 'untouched_sections' | null
    interview_elapsed_fraction, interview_done, notes, at,
  }],

  // Planner's questions to come back to.
  probe_queue: {
    [section_id]: [{
      id, observation, probe, probe_type,          // probe_type = 'breadth' | 'depth' (v5 NEW)
      difficulty, added_at_turn, consumed, consumed_at_turn,
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
    consumed_probe_id, momentum, bar_trajectory, verdict_trajectory, time_status,
    response_pace, answer_only,
    current_subtopic, consecutive_probes_on_subtopic,
    generated_after_turn,
  },

  interview_done: boolean,

  // Local-only when INTERVIEW_DEBUG_TRACE=1.
  debug_trace: [{ turn_index, ts, candidate_message, executor, planner }],
}
```

### Fields explicitly removed from earlier versions

`signals.{strong, weak}`, `live_evaluation`, `current_section_index`, `section_started_at`, `skipped_signals_by_section`, `interrupt_count_by_section`, `consecutive_*` counters, `section_nudge_count`, `rubric_updates`, `coverage_evidence` — none read by v5.

The v4 `validateExecutorReply` post-stream observability validator and the leak-guard helpers (`focusLooksLikeRubricLeak`, `LEAK_GUARD_STOPWORDS`, `collectRubricStringsFromConfig`) are gone — v5's prompts handle vocabulary discipline upstream through the Move Catalog (`Never name the missing component`, `anchor on what they actually said`, `no scale numbers unless asked`).

---

## 6. Planner prompt (`interviewEvalCapture.js → buildPrompt`)

Block order (matters — the Planner reads top-down, v5 PART 1):

1. **What You Are** — "the mind of an experienced FAANG interviewer".
2. **The Interviewer's Job, In Plain Terms** — 5 numbered rules (guard the time, stay in the back seat, breadth first then depth, scale to the candidate, never wrap before 45 minutes).
3. **Output Schema** — the candidate-facing JSON skeleton, embedded verbatim alongside the JSON-mode `response_schema`.
4. **The Interview Phases** — Phase 0 intro (2–3 min) / Phase 1 requirements (locks contract) / Phase 2 HLD (longest, breadth-mandatory) / Phase 3 deep dive (uses `deep_dive_topics`) / Phase 4 wrap (last 5 min, never before 45m).
5. **The Requirements Contract** — immutable once locked.
6. **Adaptive Difficulty System** — momentum table + difficulty assignment + L1/L2/L3 in practice + momentum→shape.
7. **Response Pace Calibration** — `fast | normal | slow | suspiciously_fast`. `suspiciously_fast` 2+ turns → `INJECT_VARIANT`. `slow` 2+ turns → `NARROW_SCOPE`.
8. **Move Catalog** — 17 moves: 2 listening, 7 probing (incl. `INJECT_VARIANT`), 1 lateral-breadth (`NUDGE_BREADTH`), 1 lateral-thread (`PIVOT_ANGLE`), 3 difficulty-down, 3 transition.
9. **Thread Depth Rule** — at `consecutive_probes_on_subtopic >= 3`, must `PIVOT_ANGLE` / `HAND_OFF` / `WRAP_TOPIC`.
10. **Breadth vs. Depth Discipline** — never 3+ consecutive depth probes while `components_missing` is non-empty.
11. **Section Exit Gates** — gate must pass before `HAND_OFF`; requirements special case requires at least one NFR.
12. **The 45-Minute Rule** — `CLOSE` only valid when wall clock >= 45 m; if sections finish early, deeper / fault / breadth / `INJECT_VARIANT`.
13. **Verdict Framework** — `strong_hire | hire | no_hire | strong_no_hire | insufficient_data`. Updated every substantive turn.
14. **Candidate Signal Classification** — `driving / asked_question / block_complete / stuck / missing_breadth / rabbit_holing / procedural` (v5 adds `missing_breadth` and `rabbit_holing`).
15. **Decision Algorithm** — STEP 1..11 verbatim.
16. **Hard Rules Summary** — Time / Breadth / Thread depth / Scale facts / "I don't know" / Closing.

Then the **Runtime State** block (v5 §"Runtime State (injected per turn)" template, populated from substrate):

- `INTERVIEW CONFIG` (full JSON injection — includes `required_breadth_components`, `variant_scenarios`, `fault_scenarios`, `raise_stakes_prompts`, etc.).
- `WALL CLOCK`, `REMAINING`, `45-MIN GATE: open|PASSED`.
- `SECTION BUDGETS` (per-section bucketed `on_track` / `behind` / `critical`).
- `CURRENT SECTION` / `CURRENT DIFFICULTY` / `CURRENT SUBTOPIC` / `CONSECUTIVE PROBES ON IT`.
- `REQUIREMENTS CONTRACT` (locked / functional / NFR / in / out, from substrate).
- `BREADTH COVERAGE` (required / mentioned / missing, from substrate).
- `RESPONSE PACE` (latest pace + consecutive turns count).
- `MOMENTUM (last 3)` / `BAR TRAJECTORY` / `VERDICT TRAJECTORY`.
- `SECTION SCOREBOARD` (g/r counts + open probe count + last_touch turn).
- `SECTION EXIT GATES` (per-section `gate=[ids]` + `passed | NOT_PASSED` + collected greens).
- `SECTIONS UNTOUCHED` (list of section ids with no flags / probes / `eval_history` entries).
- `PROBE QUEUE` (top 3 unconsumed across sections).
- `ACTIVE FLAGS` (recent 4 per section).
- `INTERVIEW PLAN` (id + budget + goal per section).
- `FOCUS RUBRIC` (focus section only — goal, objectives, good_signals, weak_signals, faang_bar, signal ids, leveling triplet, deep_dive_topics if present).
- `TRANSCRIPT (last 12)` / `CANVAS` / `LATEST INTERVIEWER TURN` / `LATEST CANDIDATE MESSAGE`.

### Output schema (JSON)

```js
{
  move: enum (17 moves),
  difficulty: 'L1' | 'L2' | 'L3',
  recommended_section_focus_id: string,
  recommended_focus: string,                      // candidate-facing question
  consumed_probe_id: string,
  current_subtopic: string,
  consecutive_probes_on_subtopic: integer,

  requirements_contract: {                        // v5 NEW
    locked: boolean,
    functional: string[],
    non_functional: string[],
    in_scope: string[],
    out_of_scope: string[],
    locked_at_turn: integer | null,
  },
  breadth_coverage: {                             // v5 NEW
    components_mentioned: string[],
    components_missing:   string[],
  },
  response_pace: 'fast' | 'normal' | 'slow' | 'suspiciously_fast',  // v5 NEW
  pace_turns_tracked: integer,

  probe_observations: [{
    id: string,                                   // v5 NEW
    observation: string,
    probe: string,
    section_id: string,
    difficulty: 'L1' | 'L2' | 'L3',
    probe_type: 'breadth' | 'depth',              // v5 NEW
  }],
  flags: [{ type: 'green' | 'red', section_id, signal_id, note }],

  momentum: 'hot' | 'warm' | 'cold',
  bar_trajectory: 'rising' | 'flat' | 'falling',
  performance_assessment: 'above_target' | 'at_target' | 'below_target' | 'unclear',
  verdict_trajectory: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire' | 'insufficient_data', // v5 NEW
  time_status: 'on_track' | 'behind' | 'critical',
  candidate_signal: 'driving' | 'asked_question' | 'block_complete' | 'stuck' | 'missing_breadth' | 'rabbit_holing' | 'procedural',
  interview_done: boolean,
  notes: string,
}
```

### Persistence (`applyEvalToSessionState`)

Per turn, mutates `session_state`:

1. Resolve focus section: planner's `recommended_section_focus_id` → fallback to a flag/probe `section_id` → fallback to prior focus → fallback to first section.
2. **Time tracking**: `(now - last_turn_ts) / 60000` is added to `section_minutes_used[priorFocusId]`. Set `last_turn_ts = now`.
3. **Performance**: write `performance_by_section[focusId] = performance_assessment` if not `unclear`.
4. **Requirements contract**: if substrate `.requirements_contract.locked === true`, refuse to overwrite (immutable). Otherwise, store the captured snapshot. If the captured value sets `locked=true`, fill `locked_at_turn` from candidate turn index when missing.
5. **Breadth coverage**: overwrite `session_state.breadth_coverage` with the latest snapshot.
6. **Response pace + verdict_trajectory**: persist directly.
7. **Probes**: append `probe_observations` (with `probe_type`) into `probe_queue[section_id]`. Cap at 12 unconsumed per section.
8. **Consume**: if `consumed_probe_id` matches an open queue item, mark consumed and (when focus is empty) mirror `item.probe` into `recommended_focus`.
9. **Flags**: append into `flags_by_section[section_id]`. Cap at 24 per section.
10. **45-minute CLOSE floor (substrate backstop)**: if `move == 'CLOSE'` or `interview_done == true`, recompute untouched sections (after this turn's flags / probes are persisted). If wall clock < 45 min OR (untouched sections exist AND not all sections at-or-over budget) → downgrade `move` to `HAND_OFF`, blank `recommended_focus`, set `recommended_section_focus_id` to the highest-priority untouched section (`deep_dive > operations > high_level_design > requirements`), reset subtopic counter, and record `eval_history[].close_blocked_reason`. The Planner is told to enforce this itself; the substrate is the safety net.
11. **Directive**: persist `next_directive` for the next Executor turn (incl. derived `answer_only = (move === 'ANSWER_AND_RELEASE')`, `current_subtopic`, `consecutive_probes_on_subtopic`, `verdict_trajectory`, `response_pace`).
12. **Termination**: `interview_done = true` if Planner emitted true OR move is `CLOSE` AND the 45-min gate did not block.
13. **Audit**: push a row onto `eval_history` (capped at 80) including `requirements_contract_locked_at_turn`, `contract_locked_this_turn`, `breadth_components_missing_count`, `verdict_trajectory`, `response_pace`, and `close_blocked_reason`.

---

## 7. Executor prompt (`interviewSystemPrompt.js → buildSystemPrompt`)

Block order (v5.2 — Directive renders LAST, Contract Closing is conditional):

1. **What You Are** — `You are {interviewer.name}, {title} at {company}. ...` Style note appended if present.
2. **The Human Feel — What This Actually Means** — what a real interviewer does.
3. **Hard Output Rules** — prose only, 3-sentence cap, one question per turn, no praise, no "interesting question", no emotes, no passive surrender, no scale numbers unless asked, math-error handling, diagram sync, long-response handling. Plus CORE RULE 1 (ONE TURN = ONE MOVE) and CORE RULE 2 (EARN BEFORE YOU NAME).
4. **Six Anti-Patterns** — Seeding, Bundling, Math correction, Echoing, Meta-leaking, **Capitulation** (v5.2 NEW — following the candidate's lead when the directive says hold). Capitulation is the named failure mode behind the T7 fabricated-contract / T9 self-advance cascade — the candidate sounds ready for the next phase but the directive isn't HAND_OFF, and the executor caves.
5. **Requirements Contract Closing** (CONDITIONAL) — only injected when `sessionState.next_directive.move === 'HAND_OFF'` AND `recommended_section_focus_id !== 'requirements'`. On every other turn the closing template is OMITTED from the prompt entirely. This is the fix for the T7 trace where, under a `LET_LEAD` directive with an empty contract, the Executor reached for the closing template and fabricated scope items the candidate had not agreed to. The LLM cannot reach for a template that isn't in the prompt. Gated by `shouldIncludeContractClosingBlock(sessionState)` in `interviewSystemPrompt.js`. Template body when present: `"Okay, let me make sure I've got the scope right. You're building [...]. In scope: [...]. Out of scope: [...]. NFRs: [...]. Is that a fair picture?"`.
6. **Difficulty Register** — L1 Exploratory / L2 Rigorous / L3 Exacting.
7. **What "Conversational" Means in Practice** — the v5 example pairs.
8. **Nudging vs. Challenging** — when to use which energy.
9. **Channel** — chat (typing/written) vs voice (TTS-spoken).
10. **Problem** — `config.problem.title + brief`.
11. **Scope** — `config.scope.{in_scope, out_of_scope}`.
12. **Scale Facts** — `config.scale_facts[]` (one per turn, only when asked).
13. **Fault Scenarios** — `config.fault_scenarios[]` (used only on `INJECT_FAULT`).
14. **Raise-Stakes** — `config.raise_stakes_prompts[]` (used only on `RAISE_STAKES`).
15. **Variant Scenarios** — `config.variant_scenarios[]` (used only on `INJECT_VARIANT`).
16. **Section Plan** — `config.sections[]` listing with `(Nm)` budgets. Reminds the Executor: **the Planner controls all transitions**.
17. **Candidate's current diagram** — Excalidraw `canvas_text` if any, otherwise placeholder. Tells the LLM to never claim to see what's not in the block.
18. **Directive** (now LAST) — always rendered, but at the END of the prompt rather than mid-prompt. Recency bias works FOR the operative instruction rather than against it. Carries:
   - **DIRECTIVE SUPREMACY** header — the candidate's most recent message and the Executor's own prior reply may pull toward a different topic; the directive overrides both.
   - Per-move enforcement: `LET_LEAD` → minimal ack only, no summary / redirect / phase close; `ANSWER_AND_RELEASE` → one fact, no transition phrase, no follow-up probe; any other move → render the Focus.
   - **NO UNAUTHORIZED SECTION ADVANCEMENT** — the explicit `recommended_section_focus_id` is named in the directive body. Section transitions belong exclusively to HAND_OFF directives.
   - **NO PROACTIVE SUMMARIZATION** — explicitly cross-references the Contract Closing block's conditional presence. "Its absence means do not summarize."
   - The Planner's last emission as `Move / Difficulty / Section / Focus / Momentum / Bar trajectory / Time / Pace` plus the **active move's `MOVE_GUIDANCE` row only** (token-efficient — ships only the relevant row).
   - When `next_directive` is null (opening turn — T1's minimal ack of the candidate's first message), the body is a literal placeholder telling the LLM to "Acknowledge the candidate minimally, in persona, in 1 sentence. Do NOT introduce new content, do NOT advance sections, do NOT re-deliver the problem statement."

Note: a previous **Opening Protocol** block was removed when T0 became a single LLM-generated combined intro+problem message via `generateOpeningLine`. There is no longer a two-step handoff (deterministic intro on T0 + verbatim problem on T2); the OPENING PROTOCOL block, the `<<<...>>>` reference embed, and the Case A / Case B logic are all gone.

### MOVE_GUIDANCE map (17 entries)

`LET_LEAD`, `ANSWER_AND_RELEASE`, `NUDGE_BREADTH` (v5 NEW — never name the missing component), `GO_DEEPER`, `CHALLENGE_ASSUMPTION`, `CHALLENGE_TRADEOFF`, `DRAW_NUMBERS`, `INJECT_FAULT` (render `config.fault_scenarios[i]` matter-of-factly), `RAISE_STAKES` (render `config.raise_stakes_prompts[i]`), `INJECT_VARIANT` (v5 NEW — render `config.variant_scenarios[i]` as a real product change, not a gotcha), `PIVOT_ANGLE`, `NARROW_SCOPE`, `PROVIDE_ANCHOR`, `SALVAGE_AND_MOVE`, `HAND_OFF`, `WRAP_TOPIC`, `CLOSE`.

---

## 8. Adaptive difficulty + Pace + Breadth/Depth + 45-min rule

### Difficulty
The Planner emits `difficulty: L1 | L2 | L3` every turn. The Executor's Difficulty Register translates that into delivery pressure (Exploratory / Rigorous / Exacting).

Difficulty is selected by **momentum**:
- `cold` → step DOWN one level (floor L1)
- `warm` → hold
- `hot` (2+ consecutive at/above target) → step UP one level (cap L3)

Momentum is computed by the Planner from the last 3 substantive `performance_assessment` values in `eval_history`. JS does not compute the bucket — the Planner does.

### Pace (v5 NEW)
`response_pace` calibration:
- `suspiciously_fast` 2+ consecutive complex turns → `INJECT_VARIANT` (twist a contract requirement to test reasoning, not recall).
- `slow` 2+ consecutive turns → `NARROW_SCOPE` (give them a smaller surface to attack).

### Breadth vs. Depth (v5 NEW)
`probe_observations[].probe_type` is `breadth` or `depth`. Breadth probes (used when `components_missing` is non-empty) are higher priority. Never run 3+ consecutive depth probes while there's uncovered breadth.

### 45-min CLOSE floor (v5)
`CLOSE` is invalid before wall clock 45 min. If sections finish early, the Planner is told to: deeper on highest-signal section → fault scenario → breadth question → `INJECT_VARIANT`. The substrate enforces this with the JS backstop in `applyEvalToSessionState` — any premature CLOSE downgrades to `HAND_OFF` to the highest-priority untouched section.

---

## 9. Time management mechanics

Two clocks, advisory only — the Planner decides what to do with them; the substrate only enforces the 45-min CLOSE floor.

### Per-section budget (`section_minutes_used` substrate)

- Updated every turn: `delta = (now - last_turn_ts) / 60000` added to the **prior** focus section.
- Bucketed for the Planner prompt's `SECTION BUDGETS` block:
  - `< 0.75` → `on_track`
  - `0.75–1.0` → `behind`
  - `≥ 1.0` → `critical`

### Total interview wall clock

Computed in the Planner prompt from `interview.session_started_at` vs. `config.total_minutes`. The 45-MIN GATE line tells the Planner whether `CLOSE` is even legal yet.

### Hard rules

- No single section may consume `>40%` of total interview time (Planner-enforced via prompt).
- `CLOSE` before 45 min is forbidden (substrate-enforced backstop).
- `HARD_TURN_CAP=60` interviewer turns is the JS final safety net.

---

## 10. Probe queue

A queue of "things worth coming back to" the Planner builds as the interview progresses.

Per item: `{ id, observation, probe, probe_type, difficulty, added_at_turn, consumed, consumed_at_turn }`. The `probe` is a pre-formed candidate-facing question; when the Planner consumes a queue item, the JS substrate mirrors `item.probe` into `recommended_focus`. The `probe_type` (`breadth` | `depth`) lets the Planner distinguish coverage probes from depth probes when reading the queue.

Probes are routed by `section_id` so HAND_OFF can carry a probe targeting a future section.

Caps: 12 unconsumed per section, 2 new probes per turn, 1 consumption per turn.

---

## 11. Failure-mode triage

| Symptom | Most likely cause | Where to look |
| --- | --- | --- |
| Executor names a topic the candidate didn't raise | Planner wrote rubric vocabulary into `recommended_focus` (no JS leak guard in v5) | Inspect the rendered `recommended_focus` vs the candidate's transcript. If recurring, sharpen `MOVE_CATALOG` "Never name a component the candidate hasn't mentioned" line, or reintroduce a substrate scan. |
| Same probe asked twice | Planner missed the queue's `consumed` flag | Inspect `probe_queue[section]` for items with `consumed=false` long after they should have been |
| Stuck in one section | Planner not emitting `HAND_OFF` despite `time_status=critical` | `eval_history[].time_status` + `section_minutes_used`; confirm `SECTION BUDGETS` block in the prompt is rendering correctly |
| Rabbit-holed in one sub-topic for 4+ turns | Planner ignored `consecutive_probes_on_subtopic >= 3` rule; substrate backstop should catch at >=4 | `eval_history[].current_subtopic` + `consecutive_probes_on_subtopic` + `thread_depth_guard_fired`. Confirm the THREAD DEPTH RULE block + RUNTIME STATE counter render. The substrate's `enforceThreadDepthCap` should fire at depth >=4. |
| Breadth never gets covered | Planner not emitting `NUDGE_BREADTH` despite `components_missing` non-empty | Inspect BREADTH COVERAGE block + `breadth_coverage.components_missing`. Confirm the BREADTH VS DEPTH DISCIPLINE block renders. |
| Section exited without quantification | Planner emitted HAND_OFF before `exit_gate.require_any` had any green | Inspect SECTION EXIT GATES block in the planner prompt for the section + `flags_by_section[id]`. Confirm `exit_gate` is defined in the section's config. |
| Interviewer seeded a scale fact / breadth component / deep-dive topic | Planner wrote unearned config vocabulary into `recommended_focus`; substrate leak guard should rewrite | Inspect the rendered `recommended_focus`; confirm STEP 6 EARN-BEFORE-NAME fires. The substrate's `enforceSeedingLeakGuard` rewrites to NUDGE_BREADTH / DRAW_NUMBERS / GO_DEEPER and stamps `eval_history[].leak_guard_fired="<kind>:<token>"`. If the leak got through anyway, the token isn't in `buildLeakPhrases` — extend the synonym list. |
| Contract gets re-locked / overwritten mid-interview | Planner emitted a fresh contract on a later turn | Substrate refuses overwrite once `locked=true` — check `eval_history[].contract_locked_this_turn` should fire exactly once. If it fires twice, the substrate guard isn't holding. |
| CLOSE fired with sections untouched OR before 45 min | Planner ignored the 45-MIN RULE / CLOSE GATE; substrate backstop should catch it | `eval_history[].close_blocked_reason`. Values: `wall_clock_below_45m` / `untouched_sections` / `null`. If `null` and `move=CLOSE` happened with the symptom, the backstop didn't fire — check `listUntouchedSections` + the wall-clock math in `applyEvalToSessionState`. |
| "I don't know" → CLOSE / repeated same-subtopic probe | Planner skipped the stuck ladder | `eval_history[]` — was the prior `candidate_signal=stuck` and the next `move=CLOSE`? Sharpen `SIGNAL_CLASSIFICATION` and the "I don't know" line in `HARD_RULES_SUMMARY`. |
| Candidate said "let's end the interview" → another probe | Planner ignored block_complete; substrate quit-signal guard should catch it | `eval_history[].quit_guard_fired`. The regex matches `let'?s end|let'?s stop|i (quit|am done|'?m done)|end the interview`. If the candidate's wording isn't matched, extend `QUIT_SIGNAL_REGEX` in `interviewEvalCapture.js`. |
| Zero flags emitted on substantive turn | Planner is silently dropping bar judgment | Logs: `[planner] zero flags on substantive turn N`. Sharpen STEP 12 FLAG EMISSION clause in the Planner prompt. |
| Executor used an emote (`*leans forward*`) | Executor ignored the explicit emote prohibition | Strengthen `HARD_OUTPUT_RULES` "NO emotes" line; consider a JS post-scan validator that strips `\*[^*]+\*` from streamed replies. |
| Executor said "Where do you want to take it?" | Executor ignored the "NO passive surrender" line | Inspect `HARD_OUTPUT_RULES`; consider a JS validator flag for the forbidden phrases. |
| Executor wrote "Got it." then asked about a brand-new topic on a long candidate response | Executor ignored the long-response rule in HARD_OUTPUT_RULES | Confirm the long-response rule renders; tighten if needed. |
| LET_LEAD ack instead of an expected probe | Previous directive carried `move=LET_LEAD` | Check `eval_history[]` last entry — was the latest directive really LET_LEAD? Tighten the Planner's STEP 7 / decision rules if it should have probed |
| Opening message feels robotic / scripted | LLM opening fell back to deterministic synthesis (no API key, parser failure) OR the prompt is over-specified | Inspect the T0 conversation_turn; if it matches the deterministic fallback shape verbatim, the LLM call failed — check `[opening] LLM opening generation failed` log. Otherwise sharpen `buildOpeningSystemPrompt` in `interviewConverse.js`. |
| Reply bundles a scope answer + a transition phrase | Executor ignored the ANSWER_AND_RELEASE strictness | `eval_history[].notes` and the Planner's raw output JSON; check the HAND_OFF GUARD wasn't bypassed |
| Executor fabricates a Requirements Contract summary under LET_LEAD or other non-HAND_OFF directive | Conditional Contract Closing block leaked into the prompt OR the LLM ignored the conditional | First check `shouldIncludeContractClosingBlock(sessionState)` returned the right value. Inspect `eval_history[]` — was the active directive really LET_LEAD when the closing summary fired? If the block was correctly absent and the executor still summarized, sharpen ANTI_PATTERN #6 (Capitulation) and the DIRECTIVE block's "NO PROACTIVE SUMMARIZATION" line. Cascade prevention: a fabricated contract on turn N pollutes the executor's own chat history and biases turn N+1 toward an unauthorized HLD self-advance. |
| Executor self-advances sections (e.g. moves into HLD when directive said CHALLENGE_ASSUMPTION on requirements) | Executor ignored the DIRECTIVE SUPREMACY / NO UNAUTHORIZED SECTION ADVANCEMENT block | Inspect the rendered Directive block — is `Section: <id>` present and correct? Is the recommended_section_focus_id flowing through to the prompt? If the directive body is correct and the LLM still self-advanced, this is Capitulation (anti-pattern #6) — sharpen the section-advancement rule in `formatDirective`. |
| Interview ends too early | Planner emitted `interview_done=true` or `move=CLOSE`; 45-min substrate backstop should have caught it | `eval_history[]` last row; check `close_blocked_reason`; or HARD_TURN_CAP hit (60 interviewer turns) |
| Debrief says "Incomplete — Cannot Assess" | Total session under 15 minutes OR section coverage <40% | `recordSessionEndMetadata` → `applyDebriefVerdictGuards` |
| Frontend doesn't show interviewer name | `interview.interview_config.interviewer` missing — config not snapshotted | Confirm `startInterviewSession` ran and persisted `interview_config` |

Enable `INTERVIEW_DEBUG_TRACE=1` for a per-turn timeline under `session_state.debug_trace[]` (Planner prompt + output, Executor prompt + history + reply). Surfaced via `GET /interviews/:clientId/debug-trace` and `/interview/:id/debug` in the frontend.

---

## 12. Tuning points

When you want to change interviewer behavior, prefer config edits over prompt edits.

| What you want to tune | Where to change it |
| --- | --- |
| Interviewer's name / title / company / style | `interview-config/url_shortener.json` → `interviewer` |
| Problem statement, opening line | `interview-config/url_shortener.json` → `problem` |
| What "good" / "weak" looks like in a section | `interview-config/url_shortener.json` → `sections[i].{good_signals, weak_signals, faang_bar}` |
| Per-level expectations (L4 / L5 / L6) | `interview-config/url_shortener.json` → `sections[i].leveling` |
| Section exit gate (which signals must be green before HAND_OFF) | `interview-config/url_shortener.json` → `sections[i].exit_gate.require_any` |
| Section time budget | `interview-config/url_shortener.json` → `sections[i].budget_minutes` |
| Required breadth components for HLD | `interview-config/url_shortener.json` → `required_breadth_components[]` |
| Deep-dive topics (the things that make THIS problem interesting) | `interview-config/url_shortener.json` → `sections[deep_dive].deep_dive_topics[]` |
| What faults the Planner can inject | `interview-config/url_shortener.json` → `fault_scenarios[]` |
| Staff-bar pushes | `interview-config/url_shortener.json` → `raise_stakes_prompts[]` |
| Variant scenarios (used by INJECT_VARIANT) | `interview-config/url_shortener.json` → `variant_scenarios[]` |
| Difficulty register wording (how L3 sounds vs L1) | `interviewSystemPrompt.js` → `DIFFICULTY_REGISTER` |
| Per-move rendering rules | `interviewSystemPrompt.js` → `MOVE_GUIDANCE` |
| Opening message persona / style | `interviewConverse.js` → `buildOpeningSystemPrompt` (LLM path) and `deterministicOpening` (offline fallback) |
| Anti-pattern lines | `interviewSystemPrompt.js` → `HARD_OUTPUT_RULES`, `ANTI_PATTERNS` (Capitulation is anti-pattern #6) |
| Conditional Requirements Contract Closing block (gate: HAND_OFF leaving requirements) | `interviewSystemPrompt.js` → `shouldIncludeContractClosingBlock` |
| Directive Supremacy / NO UNAUTHORIZED SECTION ADVANCEMENT / NO PROACTIVE SUMMARIZATION rules (executor side) | `interviewSystemPrompt.js` → `formatDirective` |
| HAND_OFF GUARD conditions, transition-phrase prohibition | `interviewEvalCapture.js` → `DECISION_ALGORITHM` |
| Thread depth cap (rabbit-hole prevention) | `interviewEvalCapture.js` → `THREAD_DEPTH_RULE` (soft 3, hard via PIVOT_ANGLE prompt rule) |
| Breadth-vs-depth discipline | `interviewEvalCapture.js` → `BREADTH_VS_DEPTH_BLOCK` |
| Exit-gate semantics | `interviewEvalCapture.js` → `EXIT_GATES_RULE` + `buildSectionExitGatesBlock` |
| 45-minute floor (the hard rule) | `interviewEvalCapture.js` → `FORTY_FIVE_MIN_RULE` (prompt) + `applyEvalToSessionState` 45-min CLOSE-floor backstop (JS) |
| Quit-signal regex (which phrases trigger CLOSE) | `interviewEvalCapture.js` → `QUIT_SIGNAL_REGEX` |
| Thread-depth backstop hard cap | `interviewEvalCapture.js` → `enforceThreadDepthCap` (currently `>= 4`) |
| Seeding-leak vocabulary (synonyms / scale-number patterns) | `interviewEvalCapture.js` → `buildLeakPhrases` |
| Opening line LLM behavior (intro+problem in one message) | `interviewConverse.js` → `buildOpeningSystemPrompt` + `generateOpeningLine` (LLM) and `deterministicOpening` (offline fallback) |
| LLM cache warmup (DeepSeek context cache) | `interviewConverse.js` → `warmExecutorPrefix`, `interviewEvalCapture.js` → `warmPlannerPrefix`. Provider pin: `OPENROUTER_PROVIDERS=DeepSeek` in `.env.local`. |
| "I don't know" ladder | `interviewEvalCapture.js` → `HARD_RULES_SUMMARY` "I don't know" sub-block + `SIGNAL_CLASSIFICATION` |
| Verdict framework wording | `interviewEvalCapture.js` → `VERDICT_FRAMEWORK` |
| Long-response one-thing-only rule | `interviewSystemPrompt.js` → `HARD_OUTPUT_RULES` "Long responses" line |
| Diagram TWO RULES (no false ability claim) | `interviewSystemPrompt.js` → `formatCanvasSnapshot` + `HARD_OUTPUT_RULES` "Diagram sync" line |
| Emote / passive-surrender prohibition | `interviewSystemPrompt.js` → `HARD_OUTPUT_RULES` |
| PIVOT_ANGLE / NUDGE_BREADTH / INJECT_VARIANT rendering (executor side) | `interviewSystemPrompt.js` → `MOVE_GUIDANCE.{PIVOT_ANGLE, NUDGE_BREADTH, INJECT_VARIANT}` |
| Untouched-section priority order (CLOSE-floor redirect target) | `interviewEvalCapture.js` → `UNTOUCHED_PRIORITY` array (`deep_dive > operations > high_level_design > requirements`) |
| Momentum thresholds, time bucketing rules, decision algorithm | `interviewEvalCapture.js` → static blocks (`ADAPTIVE_DIFFICULTY_BLOCK`, `DECISION_ALGORITHM`, `HARD_RULES_SUMMARY`) |
| Verdict caps (debrief side) | `interviewCompleteService.js` → `applyDebriefVerdictGuards` |
| LET_LEAD ack vocabulary | `interviewSystemPrompt.js` → `MOVE_GUIDANCE.LET_LEAD` (the Executor LLM emits these directly — no JS pool) |
| Hard turn safety cap | `interviewSessionService.js` → `HARD_TURN_CAP` |
| Executor history window cap | `interviewConverse.js` → `windowedHistory` default (`60` in v5) |
| Planner transcript window cap | `interviewEvalCapture.js` → `sectionWindowedTurns` default (`12` in v5) |

### Prompt budget reality check

- Planner prompt fills out at ~14–18k characters with a hot session (v5 added Phases / Contract / Pace / Breadth-vs-Depth / 45-min / Verdict Framework / Hard Rules blocks). Still well under the eval tier's context window.
- Executor prompt stays under 16k characters per turn (tested) — v5 added the Human Feel block, Requirements Contract Closing, Conversational examples, Nudging vs Challenging, and the `INJECT_VARIANT` / `NUDGE_BREADTH` MOVE_GUIDANCE entries. The active-move-only MOVE_GUIDANCE rendering keeps this within budget.

---

## 13. What the JS substrate does NOT do

Things the substrate explicitly does not own (Planner LLM owns these):

- Section transitions (no `current_section_index` advancement).
- Coverage gates — the Planner decides when to wrap.
- Performance scoring — the Planner emits `performance_assessment`; the JS just writes it.
- Difficulty bumping — the Planner emits `difficulty`; the JS does not climb-the-ladder on its own.
- Executor reply post-scan (was the v4 `validateExecutorReply` validator) — v5 trusts the Executor's HARD_OUTPUT_RULES + ANTI_PATTERNS upstream. If telemetry shows Executor drift on emotes / passive surrender / fabricated diagram confirmation, reintroduce a regex validator.

### What the substrate DOES do (move overrides)

The Planner's `move` is generally trusted, but four overrides are now wired in `applyEvalToSessionState`. They run in this order, before the next directive is persisted:

1. **Quit-signal guard** (`enforceQuitSignal`). Tight regex on the candidate's message — `let'?s end|let'?s stop|i (quit|am done|'?m done)|end the interview|...`. On match, force `move='CLOSE'`, `candidate_signal='block_complete'`, `interview_done=true`, blank focus, reset subtopic counter. Carve-out: already CLOSE/SALVAGE_AND_MOVE/HAND_OFF/WRAP_TOPIC. Logged as `eval_history[].quit_guard_fired=true`.
2. **Thread-depth backstop** (`enforceThreadDepthCap`). At `consecutive_probes_on_subtopic >= 4`, force `move='PIVOT_ANGLE'`, blank focus, reset counter. Carve-out: already PIVOT_ANGLE/HAND_OFF/WRAP_TOPIC/CLOSE. Logged as `eval_history[].thread_depth_guard_fired=true`.
3. **Seeding-leak guard** (`enforceSeedingLeakGuard`). Scan `recommended_focus` for unearned config vocabulary (missing `required_breadth_components`, `deep_dive_topics` labels, `signals[].id`, scale-fact numbers). When found AND not present in candidate transcript, rewrite to OPEN form (NUDGE_BREADTH for breadth leak, DRAW_NUMBERS for scale leak, GO_DEEPER for topic/signal leak). Carve-out: ANSWER_AND_RELEASE / INJECT_FAULT / RAISE_STAKES / INJECT_VARIANT / HAND_OFF leaving requirements. Logged as `eval_history[].leak_guard_fired="<kind>:<token>"`.
4. **45-minute CLOSE floor** (existing). `move=CLOSE` or `interview_done=true` with wall-clock <45m or untouched sections → downgrade to HAND_OFF to highest-priority untouched section.

These three are the substrate guards BRAIN.md previously called out as "removed in v5; reintroduce when telemetry shows drift". The 2026-05-05 URL-shortener trace was that telemetry — multiple seeding leaks (`"slug generation, caching, or expiry"`), 4+ probes on the same scope subtopic, candidate said "Let's end the interview" → another scope probe.

### Observability

Beyond the guards, the substrate also logs warnings on:
- Zero `flags` emitted on a substantive turn (candidate_signal in driving / missing_breadth / rabbit_holing / block_complete / stuck) when the focus rubric defines signals — surfaces Planner flag-emission drift.

The JS substrate's job is: load config, route flags / probes by `section_id`, account for time per section, persist directives + contract + breadth + pace + verdict_trajectory for the next turn, run the four substrate guards (quit / thread-depth / leak / 45-min CLOSE floor), and run the verdict caps in the debrief.

---

## 14. Debrief pipeline

`finalizeOrchestratedInterview` (called from `POST /interviews/:id/session/complete`):

1. `recordSessionEndMetadata` — records elapsed time, planned time, section coverage map (derived from `flags_by_section` + `performance_by_section` + `section_minutes_used` + `eval_history.recommended_section_focus_id`).
2. `extractHistorySignals` — separate LLM extraction for the cross-session signal snapshot (used for future personalization).
3. `generateStructuredDebrief` (v5 version) →
   - `buildV5DebriefPrompt(config, sessionState, interview)` — packs the locked `requirements_contract`, the final `breadth_coverage` snapshot, the Planner's last `verdict_trajectory` (as a hint), per-section flag evidence, leveling triplets, momentum trajectory, and the full transcript.
   - LLM call with `SD_DEBRIEF_SCHEMA` (verdict, verdict_reason, overall_score, section_scores nested with signal rows, top_moments, faang_bar_assessment, next_session_focus).
   - `normalizeSdStructuredDebrief` — coerces `not_reached` sections to a stable empty shape.
   - `applyDebriefVerdictGuards` — deterministic caps: <15 min → Incomplete; section coverage <40% → Incomplete; <60% → cap at No Hire; score-band rules; `not_reached` ⇒ no Strong Hire.
4. Save `interview.debrief`. Derive `interview.overall_score` (0–100) from the rubric fraction for the dashboard.

---

## 15. Out of scope (for v5 cutover)

- Multi-problem support — out of scope; reintroduce by adding configs and a selector.
- Migrating in-flight pre-v5 interview rows — they may render the legacy debrief path or fail gracefully (verdict: Incomplete). Old rows still display via the legacy fallbacks in `Report.jsx` and `interviewReport.js`.
- Voice / canvas / SSE transports — wire format unchanged; only payload field names changed (`requirements_contract`, `breadth_coverage`, `response_pace`, `verdict_trajectory` are additive on `session_state`).
- UI persona switching — would require `config.interviewer` to be overridable per-row.
- LLM-paste detection on candidate replies — see [BACKLOG.md](BACKLOG.md).
- Substrate backstops for thread-depth / exit-gate / scale-fact / stuck-never-CLOSE — v5 keeps only the 45-min CLOSE floor in JS. The other discipline rules are prompt-only. If telemetry shows Planner drift, reintroduce them as v5 backstops.
