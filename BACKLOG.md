# BACKLOG

Deferred discipline work for the interview engine. Things we know are real but consciously chose NOT to ship in the current pass. Each entry should name the symptom, the partial mitigation already in place, and the rough shape of the eventual fix.

---

## 1. LLM-paste detection on candidate replies

**Symptom.** Candidates paste full LLM responses into the chat — markdown headers (`## 1. Detection`), inline citations (`[1] [https://medium.com/...]`), sub-bullets, and giveaway phrases like *"Would you like to see a code snippet of how to implement the 'Singleflight' pattern in your chosen language?"*. The Planner reads these as substantive content and ratchets `momentum` to `hot`, escalating to `RAISE_STAKES` / `INJECT_FAULT` / new staff-bar questions on every turn — which the candidate then answers with another paste. The interviewer never tests whether the candidate actually understands what they pasted.

**Partial mitigation already shipped (v5).**
- The Executor's HARD_OUTPUT_RULES "Long responses" line forces the Executor to pick exactly ONE specific phrase from the candidate's text and probe only that. Indirectly forces the candidate to articulate one piece of the wall in their own words.
- The Planner's RESPONSE PACE CALIBRATION rule already classifies near-instant complex answers as `suspiciously_fast`. Two consecutive turns at `suspiciously_fast` triggers `INJECT_VARIANT` — a contract twist that tests reasoning, not recall.

**Eventual shape.**
- Cheap heuristic detector in [`backend/src/services/interviewEvalCapture.js`](backend/src/services/interviewEvalCapture.js) — scan `candidateMessage` for any of: `^#{1,6}\s` headers, `\*\*[^*]+\*\*` bold, `\[\d+\]\s*\(?https?://`, `^\s*[\*\-]\s` repeated bullet structure, the literal phrase "Would you like to" / "Here's a code snippet" / "Let me know if you want", or a contiguous block of >300 words with >3 markdown structural elements.
- On a hit, set `paste_signal = true` on the captured planner result and surface it in RUNTIME STATE next turn (e.g. `PASTE SIGNAL: true (3 markers detected)`).
- Planner policy: when `paste_signal` is true, downgrade `performance_assessment` to `unclear` for that turn (so it doesn't ratchet momentum) and bias the next move toward `INJECT_VARIANT` (test reasoning, not recall) or a verbal-articulation push: *"Drop the level — in your own words, in 2 sentences, how does request coalescing actually plug into the service you drew?"*.

**Why deferred.** v5's pace-driven `INJECT_VARIANT` already addresses the strongest pasting tell (suspiciously fast complex answers). Adding the structural-marker detector is meaningful additional code; we want to see how often the symptom recurs after v5 ships before committing to the heuristic.

---

## 2. Multi-problem support

The engine ships exactly one problem (`url_shortener.json`). Adding a second problem means dropping another JSON in `backend/src/interview-config/` and adding a selector. Out of scope for v5. The v5 prompts are already problem-agnostic — the only work needed is config plumbing + a selector at session start.

---

## 3. Planner-side priority for live scope questions buried in driving content

**Symptom.** When the candidate's message contains BOTH substantive design content AND a direct scope question (e.g. *"Following could be the requirements: ... How about these, should these be in scope? User authentication and account management. Analytics on link clicks."*), the Planner can be biased toward `driving → LET_LEAD` and miss the scope question buried at the end of the message. The directive emitted next turn then fails to address the live scope question.

**Partial mitigation already shipped (v5).**
- The Planner's `SIGNAL_CLASSIFICATION` block defines `asked_question` and the `DECISION_ALGORITHM` STEP 8 maps it to `ANSWER_AND_RELEASE`. The Planner reads the latest candidate message in full (not just a truncated view) so detection is in scope of the prompt.
- The Executor's MOVE_GUIDANCE.ANSWER_AND_RELEASE rule explicitly forbids bundling — "give the one fact they asked for. Exactly. Stop."

**Eventual shape (v5+ candidate, gated on telemetry).**
- Sharpen `SIGNAL_CLASSIFICATION` in [`backend/src/services/interviewEvalCapture.js`](backend/src/services/interviewEvalCapture.js): when `candidateMessage` contains BOTH driving-style content AND a direct scope-question pattern (e.g. "should ... be in scope?", "is X in scope?", "how about Y, should that be supported?"), classify as `asked_question` and emit `ANSWER_AND_RELEASE` with `recommended_focus` pinned to the FIRST scope dimension named.
- Cheap detector: regex over `candidateMessage` for `\bshould\s+(these|that|.{0,30})\s+be\s+in\s+scope\b`, `\bis\s+\w+\s+in\s+scope\b`, `\bhow\s+about\s+\w+\s*[,?]\s*(should|is)\b`. If matched AND the message also has substantive content (>30 words, multiple sentences), set `priority_signal = 'asked_question'` and surface in RUNTIME STATE so the Planner is guaranteed to see it.
- Optional: add a hard JS substrate guard that mirrors the prompt rule — if regex matches and the Planner emits `LET_LEAD`, force `move = 'ANSWER_AND_RELEASE'` and audit it on `eval_history`.

**Why deferred.** v5 trusts the Planner prompt. If telemetry shows the Planner mis-classifying these turns as `driving` when they should be `asked_question`, this is the cleanest fix.

---

## 4. Substrate backstops for v5 prompt-only rules (paused)

**Status.** v5 deliberately keeps only the **45-minute CLOSE floor** as a substrate backstop. The other discipline rules (thread-depth cap, breadth-vs-depth discipline, exit-gate-before-handoff, scale-fact injection scan, "I don't know" → never-CLOSE) are prompt-only.

**Why deferred.** v5 trusts the Planner prompt. If telemetry shows Planner drift on any of these rules, reintroduce them as JS substrate guards in `applyEvalToSessionState` (the natural pattern is `*_blocked_reason` rows on `eval_history` mirroring the `close_blocked_reason` field already present).

---

## 5. Executor-reply post-stream observability validator (paused)

**Status.** v5 dropped the v3/v4 `validateExecutorReply` function entirely. The Executor's HARD_OUTPUT_RULES + ANTI_PATTERNS + MOVE_GUIDANCE blocks are the upstream defense.

**Why deferred.** v5 trusts the prompt. If telemetry shows Executor drift on emotes (`*leans forward*`), passive surrender ("Where do you want to take it?"), fabricated diagram confirmation, or compound questions, reintroduce a regex-based validator that flags onto `eval_history[].validator_flags` for observability without modifying the candidate-visible reply (which has already streamed).

---

## 6. Stale mock-LLM schema branch corrupts v5 Planner directives on upstream failure

**Symptom.** When the Planner's eval-tier OpenRouter call fails in a local dev environment (e.g. transient `deepseek/deepseek-chat` flake, rate limit, content moderation), [`backend/src/services/llmInvoke.js`](backend/src/services/llmInvoke.js) silently falls back to `mockInvokeLLM`. The mock's schema-detection table in [`backend/src/services/mockLlm.js`](backend/src/services/mockLlm.js) still keys on **v3/v4 eval keys** (`section_progress` + `rubric_updates`) that no longer exist in the v5 Planner schema, so the v5 schema falls through every branch and lands on the plain-text path, which returns the literal string `"[Mock interviewer] Walk me through how you would frame the scope before sketching components."`. That string flows into [`captureTurnEval`](backend/src/services/interviewEvalCapture.js), where every validator (`result?.move`, `result?.requirements_contract`, etc.) reads `undefined` from a string and falls back to the hardcoded defaults: `move=LET_LEAD`, `requirements_contract=null`, empty `breadth_coverage`, no probes, no flags, `performance_assessment=unclear`, `verdict_trajectory=insufficient_data`. The trace UI then shows the raw `[Mock interviewer]...` string in `__trace.output_json` because the catch-block path (which annotates `__trace.error`) was never taken — a successful "mock-success" return looks visually identical to a real directive that just decided to do nothing. If the upstream flakes more than once per session, the contract never locks and breadth coverage never accumulates.

**Partial mitigation already shipped.**
- The catch-block in `captureTurnEval` ([interviewEvalCapture.js lines 1168-1204](backend/src/services/interviewEvalCapture.js)) already constructs a structurally-valid v5 noop directive with `__trace.error` set — but only when `invokeLLM` actually *throws*. In dev, `invokeLLM` swallows the throw and returns the mock string instead, so this branch is bypassed.
- `logUpstreamFallback` in `llmInvoke.js` writes a loud `═══` banner to backend stdout when fallback engages, so the failure is visible to anyone watching the server logs.
- In production (`config.isLocalLike === false`), `invokeLLM` re-throws upstream errors instead of falling back, which routes through the proper noop. This is a dev-only corruption.

**Eventual shape.**
- Update `mockInvokeLLM` in [`backend/src/services/mockLlm.js`](backend/src/services/mockLlm.js) to detect the v5 Planner schema by checking for the keys actually used today (e.g. `keys.includes('move') && keys.includes('recommended_focus') && keys.includes('requirements_contract')`) and return a structurally-valid v5 noop directive matching the shape of the catch-block noop in `captureTurnEval` (move=LET_LEAD, all enum fields at safe defaults, empty arrays, `notes` prefixed with `"[mock fallback]"` so it's visible in the trace).
- Annotate the captured directive's `__trace` with an explicit `is_mock_fallback: true` flag (and propagate through `applyEvalToSessionState` into `eval_history[]` so per-session telemetry can count fallbacks). This requires either a side-channel from `mockInvokeLLM` to `captureTurnEval` (e.g. wrap the return in `{ __mock: true, ... }`) or a new field in `llmInvoke.js`'s return shape.
- Optional dev-loudness: env flag `INTERVIEW_FAIL_ON_MOCK=1` (or similar) that turns mock fallback into a hard error in dev too, making interview-engine flakes impossible to miss while debugging.
- Same fix should also remove the dead `section_progress + rubric_updates` branch (it's misleading and silently breaks anyone reading it as a reference for the current schema).
- Adjacent issue worth fixing in the same pass: `mockStreamLLM` returns a hardcoded `"Got it — let me push on that..."` reply that ignores the directive entirely. If the conversational tier ever falls back, the candidate sees `[Mock interviewer] Got it...` mid-interview. Make the streaming mock at least directive-aware (read `messages[0].content` for the rendered Directive block and echo a minimal ack).

**Why deferred.** Pure dev concern — production re-throws and routes cleanly through `captureTurnEval`'s catch path with proper `__trace.error` annotation. The bug only bites local development, and only when the eval-tier model flakes. The v5.2 Capitulation rules in the Executor mean a degraded LET_LEAD directive at least produces safe Executor behavior (minimal ack, no fabricated content) rather than cascading into incoherent output. Visibility is the real gap, not correctness.
