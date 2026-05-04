import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './interviewSystemPrompt.js';
import { loadInterviewConfig } from './interviewConfig.js';

/* --------------------------- Persona injection ----------------------- */

test('Role & Mission renders the persona injected from config.interviewer', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Role & Mission/);
  assert.match(prompt, new RegExp(`You are ${config.interviewer.name}`));
  assert.match(prompt, new RegExp(config.interviewer.title));
  assert.match(prompt, new RegExp(config.interviewer.company));
  if (config.interviewer.style_note) {
    assert.match(prompt, new RegExp(config.interviewer.style_note));
  }
});

test('Persona block is present and verbatim', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Persona/);
  assert.match(prompt, /warm but rigorous/);
  assert.match(prompt, /peer Slack DM/);
});

/* --------------------------- v3 prompt sections ---------------------- */

test('Difficulty Register is present with L1/L2/L3 entries', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Difficulty Register/);
  assert.match(prompt, /L1 — Baseline pressure/);
  assert.match(prompt, /L2 — Real pressure/);
  assert.match(prompt, /L3 — Staff-bar pressure/);
});

test('Hard Output Rules block is present and carries v4 emote + passive-surrender prohibitions', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Hard Output Rules/);
  assert.match(prompt, /3 sentences max per turn/);
  assert.match(prompt, /NO praise/);
  assert.match(prompt, /Math errors/);
  // FIX-9 emote prohibition.
  assert.match(prompt, /NO emotes or stage directions/);
  assert.match(prompt, /\*leans forward\*/);
  // FIX-7 passive surrender prohibition.
  assert.match(prompt, /NO passive surrender/);
  assert.match(prompt, /Where do you want to take it\?/);
  assert.match(prompt, /What would you like to cover next\?/);
  // FIX-7 (strict) — covers within-section choices, not just whole-interview direction.
  assert.match(prompt, /This applies BOTH to whole-interview direction.+AND to within-section choices/);
  assert.match(prompt, /YOU pick which one to answer \(silently drop the rest\)/);
  // FIX-7 (strict) — newly forbidden phrases that previously slipped through as "GOOD" examples.
  assert.match(prompt, /Pick whichever of those interests you more/);
  assert.match(prompt, /Pick whichever of those two interests you more/);
  assert.match(prompt, /Which would you like to focus on\?/);
  assert.match(prompt, /What's next on your list\?/);
  // FIX-8 diagram TWO RULES.
  assert.match(prompt, /Diagram sync — TWO rules in effect simultaneously/);
  assert.match(prompt, /Never claim INABILITY to see/);
  assert.match(prompt, /Never claim ABILITY to see something you haven't verified/);
});

test('Long Response Handling section (FIX-6) is present with example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Long Response Handling/);
  assert.match(prompt, /Pick EXACTLY ONE thing/);
  assert.match(prompt, /WRONG: "Got it\. How would you handle cache invalidation/);
  assert.match(prompt, /RIGHT: "You mentioned CDC for propagating invalidations/);
  // The "two-in-a-row ack" rule.
  assert.match(prompt, /NEVER start your reply with the same one-word ack \("Got it\.", "Fair\.", "Mhm\."\) two turns in a row/);
});

test('Four Anti-Patterns block is present and lists all four patterns', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Four Anti-Patterns/);
  assert.match(prompt, /Seeding/);
  assert.match(prompt, /Bundling/);
  assert.match(prompt, /Math correction/);
  assert.match(prompt, /Echoing/);
});

test('Bundling anti-pattern forbids "scope answer + section transition" combo', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  // The expanded Bundling clause.
  assert.match(prompt, /combining a scope answer with a section transition in the same reply/);
  assert.match(prompt, /auth is out — walk me through your storage design/);
  assert.match(prompt, /Section transitions belong only in HAND_OFF or WRAP_TOPIC moves/);
  // The new concrete WRONG/RIGHT example matching the T2 transcript regression.
  assert.match(prompt, /Example — candidate lists 4 requirements and asks "should auth and analytics be in scope\?"/);
  assert.match(prompt, /WRONG: "Auth is out of scope but include analytics\. Walk me through your storage design\."/);
  assert.match(prompt, /RIGHT: "Auth is out of scope\. Continue\."/);
});

/* --------------------------- Reference data ------------------------- */

test('Problem block renders title + brief from config.problem', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Problem/);
  assert.match(prompt, /URL Shortener/);
});

test('Scope, Scale Facts, Fault Scenarios, Raise-Stakes blocks are rendered from config', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Scope/);
  assert.match(prompt, /In scope/);
  assert.match(prompt, /Out of scope/);
  assert.match(prompt, /# Scale Facts/);
  assert.match(prompt, /share at most ONE per turn/i);
  assert.match(prompt, /# Fault Scenarios/);
  assert.match(prompt, /INJECT_FAULT/);
  assert.match(prompt, /# Raise-Stakes/);
  assert.match(prompt, /RAISE_STAKES/);
});

test('Section Plan renders all sections with budgets', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Section Plan/);
  for (const s of config.sections) {
    assert.match(
      prompt,
      new RegExp(`${(s.label || s.id).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')} \\(\\d+m\\)`),
      `expected section "${s.label}" rendered with budget`
    );
  }
  assert.match(prompt, /Planner controls all transitions/);
});

/* --------------------------- Channel mode ---------------------------- */

test('chat mode keeps written register', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /typing — written register/);
});

test('voice mode adds a spoken-register directive', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'audio' },
    sessionState: {},
  });
  assert.match(prompt, /spoken aloud via TTS/i);
});

/* --------------------------- Directive rendering --------------------- */

test('# Directive block ALWAYS renders, including when next_directive is absent', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Directive \(your move this turn\)/);
  assert.match(prompt, /no directive — opening turn; follow the Opening Protocol section above/);
});

test('# Directive block carries v3 fields: Move, Difficulty, Focus, Momentum, Bar trajectory, Time', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'GO_DEEPER',
        difficulty: 'L3',
        recommended_focus: 'their <500ms latency claim — push for percentile',
        momentum: 'hot',
        bar_trajectory: 'rising',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /# Directive \(your move this turn\)/);
  assert.match(prompt, /Move:\s+GO_DEEPER/);
  assert.match(prompt, /Difficulty:\s+L3/);
  assert.match(prompt, /Momentum:\s+hot/);
  assert.match(prompt, /Bar trajectory: rising/);
  assert.match(prompt, /Time: on_track/);
  assert.match(prompt, /push for percentile/);
});

test('# Directive renders ONLY the active move guidance line', () => {
  const config = loadInterviewConfig();
  const promptLetLead = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'LET_LEAD', difficulty: 'L1', recommended_focus: '' },
    },
  });
  assert.match(promptLetLead, /LET_LEAD: one low-key ack/);
  assert.doesNotMatch(promptLetLead, /HAND_OFF: warm but decisive transition/);
  assert.doesNotMatch(promptLetLead, /INJECT_FAULT: render the fault scenario/);

  const promptInjectFault = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'INJECT_FAULT', difficulty: 'L3', recommended_focus: 'their primary DB just went down...' },
    },
  });
  assert.match(promptInjectFault, /INJECT_FAULT: render the fault scenario/);
  assert.doesNotMatch(promptInjectFault, /LET_LEAD: one low-key ack/);
});

test('# Directive renders all 15 v4 moves in MOVE_GUIDANCE (incl. PIVOT_ANGLE)', () => {
  const config = loadInterviewConfig();
  for (const move of [
    'LET_LEAD', 'ANSWER_AND_RELEASE',
    'GO_DEEPER', 'CHALLENGE_ASSUMPTION', 'CHALLENGE_TRADEOFF', 'DRAW_NUMBERS',
    'INJECT_FAULT', 'RAISE_STAKES',
    'PIVOT_ANGLE', // v4 FIX-1
    'NARROW_SCOPE', 'PROVIDE_ANCHOR', 'SALVAGE_AND_MOVE',
    'HAND_OFF', 'WRAP_TOPIC', 'CLOSE',
  ]) {
    const prompt = buildSystemPrompt({
      config,
      interview: { interview_type: 'system_design', interview_mode: 'chat' },
      sessionState: { next_directive: { move, difficulty: 'L2' } },
    });
    assert.match(prompt, new RegExp(`${move}:`), `expected guidance for ${move}`);
  }
});

test('PIVOT_ANGLE move guidance carries a generic GOOD/BAD example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'PIVOT_ANGLE', difficulty: 'L2', recommended_focus: 'How are you generating the slug itself?' },
    },
  });
  assert.match(prompt, /Example shape — when pivoting after 3 probes on caching/);
  assert.match(prompt, /GOOD: "Okay — I've got the caching picture\. How are you generating the slug itself\?"/);
  assert.match(prompt, /BAD : "Right, so we covered/);
});

test('# Directive renders the answer_only line when ANSWER_AND_RELEASE', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'ANSWER_AND_RELEASE',
        difficulty: 'L1',
        recommended_focus: 'Custom slugs are in scope.',
        answer_only: true,
      },
    },
  });
  assert.match(prompt, /candidate asked a direct question/i);
  assert.match(prompt, /STOP/);
});

test('# Directive does NOT render answer_only line for non-ANSWER_AND_RELEASE moves', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'GO_DEEPER', difficulty: 'L2' },
    },
  });
  assert.doesNotMatch(prompt, /Do NOT append a follow-up probe/);
});

test('# Directive carries the focus-leak guard sentence with strict-FIX-7-compliant fallbacks', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'GO_DEEPER', difficulty: 'L2', recommended_focus: 'separation of read and write paths' },
    },
  });
  assert.match(prompt, /vocabulary the candidate has not used/);
  assert.match(prompt, /one-word interviewer-in-control ack/);
  // Replacement examples no longer contain the now-forbidden phrases.
  assert.match(prompt, /"Mhm\.", "Got it\.", "Continue\.", "Take me through it\."/);
  assert.match(prompt, /NEVER ask the candidate where to go next/);
});

test('# Directive carries the LIVE OVERRIDE clause for live scope/scale questions', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'LET_LEAD', difficulty: 'L1', recommended_focus: '' },
    },
  });
  // The clause must always render with the directive (regardless of move).
  assert.match(prompt, /LIVE OVERRIDE:/);
  assert.match(prompt, /direct question about scope/);
  assert.match(prompt, /direct question about scope.+or scale/s);
  assert.match(prompt, /treat as ANSWER_AND_RELEASE regardless of the move above/);
  // Pick ONE dimension, drop the rest silently — anti-bundling.
  assert.match(prompt, /Pick exactly ONE dimension they named/);
  assert.match(prompt, /Drop any other dimensions silently/);
  // No tacked-on transition allowed.
  assert.match(prompt, /Do NOT transition sections in the same reply/);
  assert.match(prompt, /walk me through your storage design.+forbidden as appendages here/);
});

test('# Directive carries the anti-advance guard sentence', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'HAND_OFF', difficulty: 'L2', recommended_focus: 'shall we move into HLD?' },
    },
  });
  assert.match(prompt, /Render the directive's focus EXACTLY/);
  assert.match(prompt, /never invent a transition on your own/);
});

/* --------------------------- Canvas ---------------------------------- */

test('Canvas section renders empty placeholder + TWO RULES (no inability claim, no fabricated ability)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Candidate's current diagram/);
  assert.match(prompt, /no diagram drawn yet/);
  assert.match(prompt, /TWO RULES/);
  // Rule (1): never claim inability.
  assert.match(prompt, /NEVER claim INABILITY to see/);
  assert.match(prompt, /can't see your design directly/);
  // Rule (2): never claim fabricated ability (FIX-8).
  assert.match(prompt, /NEVER claim ABILITY to see something that isn't in this block/);
  assert.match(prompt, /my view still hasn't updated — keep going from your description/);
});

test('Canvas section renders canvas_text when present, TWO RULES still apply', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: {
      interview_type: 'system_design',
      interview_mode: 'chat',
      canvas_text: 'Boxes: API Gateway, Cache, Metadata DB',
    },
    sessionState: {},
  });
  assert.match(prompt, /API Gateway, Cache, Metadata DB/);
  assert.doesNotMatch(prompt, /no diagram drawn yet/);
  assert.match(prompt, /TWO RULES still apply/);
});

/* --------------------------- v2 vocabulary check --------------------- */

test('Executor prompt does NOT carry v2 fields (rubric_updates, evidence_summary)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'GO_DEEPER', difficulty: 'L2', recommended_focus: 'their CDN choice' },
    },
  });
  assert.doesNotMatch(prompt, /rubric_updates/);
  assert.doesNotMatch(prompt, /evidence_summary/);
  assert.doesNotMatch(prompt, /coverage_evidence/);
  assert.doesNotMatch(prompt, /probe_level/);
  assert.doesNotMatch(prompt, /Strong-signal moves to listen for/);
  assert.doesNotMatch(prompt, /Common mistakes/);
  assert.doesNotMatch(prompt, /Pacing plan/);
});

/* --------------------------- Opening Protocol ----------------------- */

test('OPENING PROTOCOL section ALWAYS renders, regardless of opening_phase value', () => {
  const config = loadInterviewConfig();
  const promptAck = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: { opening_phase: 'awaiting_ack' },
  });
  const promptInProgress = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      opening_phase: 'in_progress',
      next_directive: { move: 'GO_DEEPER', difficulty: 'L2', recommended_focus: 'their cache choice' },
    },
  });
  const promptEmpty = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  for (const p of [promptAck, promptInProgress, promptEmpty]) {
    assert.match(p, /# Opening Protocol \(active on T1 only/);
  }
});

test('OPENING PROTOCOL embeds config.problem.opening_prompt verbatim as DATA', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Reference text — the curated problem statement \(DATA, not behavior\)/);
  assert.ok(
    prompt.includes(config.problem.opening_prompt.trim()),
    'opening_prompt should be embedded verbatim'
  );
});

test('OPENING PROTOCOL covers both Case A (ack) and Case B (substantive content)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Case A — they acked/);
  assert.match(prompt, /VERBATIM/);
  assert.match(prompt, /Case B — they have already begun framing/);
  assert.match(prompt, /DO NOT recite the reference text back/);
});

test('OPENING PROTOCOL Case B forbids tacking a section transition onto the opening reply', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  // Case B now offers two explicit branches: ANSWER_AND_RELEASE on a scope question OR ack-and-let-them-continue.
  assert.match(prompt, /\(a\) ANSWER_AND_RELEASE on ONE scope question they asked/);
  assert.match(prompt, /\(b\) ack the framing and let them continue \("Got it\. Continue\."\)/);
  // No tacked-on section transition in the opening turn.
  assert.match(prompt, /NEVER tack a section transition onto an opening-turn reply/);
  assert.match(prompt, /Forbidden appendages on T1: "walk me through your storage design"/);
  assert.match(prompt, /"how would you architect X"/);
  assert.match(prompt, /past requirements until the Planner emits HAND_OFF on a later turn/);
});

test('OPENING PROTOCOL tells the LLM to ignore the section when a Planner directive is present', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /If a Planner directive is present, IGNORE this entire section/);
});

/* --------------------------- Bundling / scope-confirm examples ------- */

test('ANSWER_AND_RELEASE move guidance carries a generic GOOD/BAD example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'ANSWER_AND_RELEASE', difficulty: 'L1', recommended_focus: 'X is in scope.' },
    },
  });
  assert.match(prompt, /Example shape — candidate asks "is X in scope, and what about Y\?"/);
  assert.match(prompt, /GOOD: "Yes, X is in. What about Y is your call."/);
  assert.match(prompt, /BAD : "X is in, Y is out, and Z too. Now walk me through the design."/);
});

test('HAND_OFF move guidance carries a generic GOOD/BAD example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'HAND_OFF', difficulty: 'L2', recommended_focus: 'shall we move into HLD?' },
    },
  });
  assert.match(prompt, /Example shape — when transitioning sections/);
  assert.match(prompt, /GOOD: "Anything else on this, or shall we move on\?"/);
  assert.match(prompt, /BAD : "<answer to scope question>\. Walk me through the high-level architecture."/);
  assert.match(prompt, /ONLY HAND_OFF and WRAP_TOPIC may include a section-transition phrase/);
});

test('Hard Output Rules carries the strict-FIX-7 scope-confirmation GOOD/BAD example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Example — candidate lists 4 requirements then asks about two more \(auth, analytics\)/);
  assert.match(prompt, /GOOD: "Auth is out of scope\. Continue\."/);
  assert.match(prompt, /BAD : "Yes to A, defer B\. Yes to C, defer D\. Walk me through the architecture\."/);
  // Strict FIX-7 — "Pick whichever ..." is now itself a BAD example, not a GOOD one.
  assert.match(prompt, /BAD : "Pick whichever of those two interests you more\."\s+\(passive surrender — the interviewer picks\)/);
});

/* --------------------------- Anti-echoing example ------------------- */

test('Four Anti-Patterns #4 (Echoing) carries a strict-FIX-7-compliant GOOD/BAD example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Example — candidate just listed several non-functional requirements/);
  assert.match(prompt, /GOOD: "Got it\. Continue\."/);
  assert.match(prompt, /BAD : "Fair — A, B, C, and D are all in scope\. Walk me through \.\.\."/);
});

test('# Directive block carries the ANTI-ECHO sentence', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: { move: 'GO_DEEPER', difficulty: 'L2', recommended_focus: 'their cache choice' },
    },
  });
  assert.match(prompt, /ANTI-ECHO: Do not repeat back the candidate's enumerated terms/);
  assert.match(prompt, /drop to a one-word ack/);
});

/* --------------------------- Token budget ---------------------------- */

test('Token budget: Executor prompt stays under 16000 chars on a hot turn (v4 + v4-followup discipline blocks)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: {
      interview_type: 'system_design',
      interview_mode: 'chat',
      session_started_at: new Date(Date.now() - 20 * 60 * 1000),
      canvas_text: 'Boxes: API Gateway, Cache, Metadata DB, ID Allocator, Redirect Service',
    },
    sessionState: {
      next_directive: {
        move: 'GO_DEEPER',
        difficulty: 'L3',
        recommended_focus: 'their CDN choice for hot keys',
        momentum: 'hot',
        bar_trajectory: 'rising',
        time_status: 'behind',
      },
    },
  });
  // v4 follow-up adds: LIVE OVERRIDE clause in DIRECTIVE block, tightened Opening
  // Case B with the no-tacked-transition rule, strict-FIX-7 wording covering
  // within-section choices + new forbidden phrases, expanded Bundling
  // anti-pattern with the T2 example. Net: roughly +2k chars vs v4 (the
  // LIVE OVERRIDE + Case B expansion are the largest contributors).
  assert.ok(prompt.length < 16000, `Executor prompt too long: ${prompt.length} chars`);
});
