# BACKLOG

Deferred discipline work for the interview engine. Things we know are real but consciously chose NOT to ship in the current pass. Each entry should name the symptom, the partial mitigation already in place, and the rough shape of the eventual fix.

---

## 1. LLM-paste detection on candidate replies

**Symptom.** Candidates paste full LLM responses into the chat — markdown headers (`## 1. Detection`), inline citations (`[1] [https://medium.com/...]`), sub-bullets, and giveaway phrases like *"Would you like to see a code snippet of how to implement the 'Singleflight' pattern in your chosen language?"*. The current Planner reads these as substantive content and ratchets `momentum` to `hot`, escalating to `RAISE_STAKES` / `INJECT_FAULT` / new staff-bar questions on every turn — which the candidate then answers with another paste. The interviewer never tests whether the candidate actually understands what they pasted.

**Partial mitigation already shipped (v4 FIX-6 — Long Response Handling).** When the Executor sees a >150-word reply it must pick exactly ONE specific phrase from the candidate's text and probe only that. This indirectly forces the candidate to articulate one piece of the wall in their own words. It does NOT explicitly flag paste behaviour, and a determined paster can still give a verbose verbal-sounding answer that gets rewarded as `at_target`.

**Eventual shape (v5 candidate).**
- Cheap heuristic detector in [`backend/src/services/interviewEvalCapture.js`](backend/src/services/interviewEvalCapture.js) — scan `candidateMessage` for any of: `^#{1,6}\s` headers, `\*\*[^*]+\*\*` bold, `\[\d+\]\s*\(?https?://`, `^\s*[\*\-]\s` repeated bullet structure, the literal phrase "Would you like to" / "Here's a code snippet" / "Let me know if you want", or a contiguous block of >300 words with >3 markdown structural elements.
- On a hit, set `paste_signal = true` on the captured planner result and surface it in RUNTIME STATE next turn (e.g. `PASTE SIGNAL: true (3 markers detected)`).
- Planner policy: when `paste_signal` is true, downgrade `performance_assessment` to `unclear` for that turn (so it doesn't ratchet momentum) and bias the next move toward `NARROW_SCOPE` or a verbal-articulation push: *"Drop the level — in your own words, in 2 sentences, how does request coalescing actually plug into the service you drew?"*.
- Optional executor-side: a 6th anti-pattern that names the specific candidate-facing redirect to use when `paste_signal=true` arrives in the directive.

**Why deferred.** v4 FIX-6 already mitigates the worst behaviour at the executor layer. Adding the detector-and-policy loop is meaningful additional code; we want to see how often the symptom recurs after FIX-6 ships before committing to the heuristic.

---

## 2. JS substrate backstops for FIX-1, FIX-2, FIX-3, FIX-5

**Symptom.** The current substrate only enforces FIX-4 (CLOSE gate) in JS. The other four v4 discipline rules — thread-depth cap, exit-gate-before-handoff, scale-fact injection scan, stuck-never-CLOSE — are prompt-only. If the Planner LLM ignores the prompt, the directive ships.

**Partial mitigation.** All four rules are stated in the Planner prompt (the new `THREAD_DEPTH_RULE`, `EXIT_GATES_RULE`, `SCALE_FACT_INJECTION_RULE`, `CLOSE_GATE_RULE` blocks). RUNTIME STATE renders the data the Planner needs to evaluate them (`CURRENT SUBTOPIC` + `CONSECUTIVE PROBES ON IT`, `SECTION EXIT GATES`, `SECTIONS UNTOUCHED`). The Planner is told these are HARD rules.

**Eventual shape (v5 candidate, gated on telemetry).**
- Add JS guards in `applyEvalToSessionState` that mirror the prompt rules:
  - **FIX-1 backstop.** If `consecutive_probes_on_subtopic >= 4` and the directive's `current_subtopic` matches the prior, force `move = 'PIVOT_ANGLE'` and reset the counter.
  - **FIX-2 backstop.** If `move === 'HAND_OFF'`, recompute the focus section's exit-gate intersection. If zero greens AND the section is not over budget, downgrade to `GO_DEEPER` (or pull the highest-priority queued probe).
  - **FIX-3 backstop.** Post-scan `recommended_focus` for any number that appears in `config.scale_facts` AND was not in `candidateMessage`. If detected, blank the focus and append a `eval_history[].scale_fact_leak: <number>` audit row.
  - **FIX-5 backstop.** If the prior `eval_history` entry has `candidate_signal === 'stuck'` and the new `move === 'CLOSE'`, downgrade to `PIVOT_ANGLE` (or `SALVAGE_AND_MOVE` if no other angles).
- Each backstop writes a `*_blocked_reason` field on `eval_history` for observability.

**Why deferred.** Substrate enforcement is the strongest guarantee but also the most expensive to debug when wrong. We want a session or two of telemetry on whether the Planner actually obeys the new prompt rules before adding belt-and-suspenders JS.

---

## 3. Validator extensions for v4 executor anti-patterns

**Symptom.** `validateExecutorReply` in [`backend/src/services/interviewEvalCapture.js`](backend/src/services/interviewEvalCapture.js) catches HAND_OFF-with-multi-probe, WRAP_TOPIC-with-probe, and verbatim echoing. It does NOT catch the new v4 forbidden patterns:
- emotes (`*leans forward*`, `*pauses*`)
- passive-surrender phrases (`Where do you want to take it?`, `What would you like to cover next?`)
- fabricated diagram confirmation (`Yes, I can see it now` when `canvas_text` is empty)
- the "Got it. <new topic>" formula on long candidate responses

**Partial mitigation.** All four are in the Executor prompt as hard prohibitions or rules.

**Eventual shape.** Extend `validateExecutorReply` with regex-based detectors for each forbidden phrase / pattern. Push `executor_emote`, `executor_passive_surrender`, `executor_fabricated_canvas`, `executor_short_ack_repeat` flags into `validatorResult.flags`. These already get persisted on `eval_history[].validator_flags` for observability without modifying the candidate-visible reply (which has already streamed).

**Why deferred.** The reply has already been shown to the candidate by the time the validator runs, so this is observability-only. Worth doing soon but not urgent.

---

## 4. Multi-problem support

The engine ships exactly one problem (`url_shortener.json`). Adding a second problem means dropping another JSON in `backend/src/interview-config/` and adding a selector. Out of scope for v4.

---

## 5. Planner-side priority for live scope questions buried in driving content

**Symptom.** When the candidate's message contains BOTH substantive design content AND a direct scope question (e.g. *"Following could be the requirements: ... How about these, should these be in scope? User authentication and account management. Analytics on link clicks."*), the Planner can be biased toward `driving → LET_LEAD` and miss the scope question buried at the end of the message. The directive emitted next turn then fails to address the live scope question, leaving the Executor to either (a) fire the LIVE OVERRIDE and answer one dimension, or (b) freelance into the bundling pattern (the v4-followup T2 regression).

**Partial mitigation already shipped (v4-followup LIVE OVERRIDE).** The Executor's DIRECTIVE block now carries an always-on LIVE OVERRIDE clause: if the candidate's latest message contains a direct scope or scale question, the Executor treats it as `ANSWER_AND_RELEASE` regardless of the Planner-emitted move. This is a substrate-level safety net for the stale-directive problem (the directive is one turn behind by design — see BRAIN.md §2). It catches the visible bad behaviour without requiring the Planner to be perfect.

**Eventual shape (v5 candidate, gated on telemetry).**
- Sharpen `SIGNAL_CLASSIFICATION` in [`backend/src/services/interviewEvalCapture.js`](backend/src/services/interviewEvalCapture.js): when `candidateMessage` contains BOTH driving-style content AND a direct scope-question pattern (e.g. "should ... be in scope?", "is X in scope?", "how about Y, should that be supported?"), classify as `asked_question` and emit `ANSWER_AND_RELEASE` with `recommended_focus` pinned to the FIRST scope dimension named.
- Cheap detector: regex over `candidateMessage` for `\bshould\s+(these|that|.{0,30})\s+be\s+in\s+scope\b`, `\bis\s+\w+\s+in\s+scope\b`, `\bhow\s+about\s+\w+\s*[,?]\s*(should|is)\b`. If matched AND the message also has substantive content (>30 words, multiple sentences), set `priority_signal = 'asked_question'` and surface in RUNTIME STATE.
- Optional: add `force_move = 'ANSWER_AND_RELEASE'` to the planner output schema so the Planner can explicitly acknowledge the override even when emitting a different `move` for telemetry purposes.

**Why deferred.** The LIVE OVERRIDE in the executor catches the visible bad behaviour without requiring planner-side changes. This is the planner-side complement: cleaner data, better evaluation traces, and the Planner stays authoritative on signal classification. Worth doing if telemetry shows the Executor is firing LIVE OVERRIDE frequently — that means the Planner is mis-classifying these turns as `driving` when they should be `asked_question`.
