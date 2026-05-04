import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, MOVE_GUIDANCE } from './interviewSystemPrompt.js';
import { loadInterviewConfig } from './interviewConfig.js';

/* --------------------------- Persona injection ----------------------- */

test('What You Are renders the persona injected from config.interviewer', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# What You Are/);
  assert.match(prompt, new RegExp(`You are ${config.interviewer.name}`));
  assert.match(prompt, new RegExp(config.interviewer.title));
  assert.match(prompt, new RegExp(config.interviewer.company));
  if (config.interviewer.style_note) {
    assert.match(prompt, new RegExp('Style note'));
  }
});

/* --------------------------- v5 prompt sections ---------------------- */

test('Human Feel block is present', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# The Human Feel — What This Actually Means/);
  assert.match(prompt, /Acknowledges specifically, not generically/);
});

test('Difficulty Register is present with L1/L2/L3 entries (v5 wording)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Difficulty Register/);
  assert.match(prompt, /L1 — Exploratory/);
  assert.match(prompt, /L2 — Rigorous/);
  assert.match(prompt, /L3 — Exacting/);
});

test('Hard Output Rules block carries v5 prohibitions (emote, passive surrender, scale numbers)', () => {
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
  assert.match(prompt, /NO emotes or stage directions/);
  assert.match(prompt, /\*leans forward\*/);
  assert.match(prompt, /NO passive surrender/);
  assert.match(prompt, /Diagram sync/);
  assert.match(prompt, /NO scale numbers unless asked/);
});

test('Conversational examples block is present', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# What "Conversational" Means in Practice/);
  assert.match(prompt, /Not conversational:/);
  assert.match(prompt, /Conversational:/);
});

test('Nudging vs. Challenging block is present', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Nudging vs\. Challenging/);
});

test('Four Anti-Patterns block is present (Seeding, Bundling, Math correction, Echoing)', () => {
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

test('Requirements Contract Closing block is present (the only proactive summary)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Requirements Contract Closing/);
  assert.match(prompt, /In scope:/);
  assert.match(prompt, /Out of scope:/);
  assert.match(prompt, /NFRs:/);
  assert.match(prompt, /Is that a fair picture\?/);
});

/* --------------------------- v5 reference data ---------------------- */

test('Variant Scenarios reference block is present when config.variant_scenarios is non-empty', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Variant Scenarios/);
  for (const v of config.variant_scenarios) {
    assert.match(prompt, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60)));
  }
});

test('Variant Scenarios reference block is omitted when config has no variant_scenarios', () => {
  const config = { ...loadInterviewConfig(), variant_scenarios: [] };
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.doesNotMatch(prompt, /# Variant Scenarios/);
});

test('Fault Scenarios + Raise-Stakes reference blocks present', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Fault Scenarios/);
  assert.match(prompt, /# Raise-Stakes Prompts/);
});

test('Section Plan lists 4 sections with budgets (no tradeoffs)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Section Plan/);
  assert.match(prompt, /Requirements Clarification/);
  assert.match(prompt, /High Level Design/);
  assert.match(prompt, /Deep Dive/);
  assert.match(prompt, /Reliability & Operations/);
  // tradeoffs section should not appear in any form.
  assert.doesNotMatch(prompt, /Tradeoffs/i);
});

/* --------------------------- MOVE_GUIDANCE -------------------------- */

test('MOVE_GUIDANCE includes v5 NEW moves NUDGE_BREADTH and INJECT_VARIANT', () => {
  assert.ok(MOVE_GUIDANCE.NUDGE_BREADTH, 'NUDGE_BREADTH guidance must exist');
  assert.match(MOVE_GUIDANCE.NUDGE_BREADTH, /Never name the missing component/);

  assert.ok(MOVE_GUIDANCE.INJECT_VARIANT, 'INJECT_VARIANT guidance must exist');
  assert.match(MOVE_GUIDANCE.INJECT_VARIANT, /variant/i);
});

test('MOVE_GUIDANCE covers all 17 v5 moves', () => {
  for (const m of [
    'LET_LEAD', 'ANSWER_AND_RELEASE',
    'NUDGE_BREADTH',
    'GO_DEEPER', 'CHALLENGE_ASSUMPTION', 'CHALLENGE_TRADEOFF',
    'DRAW_NUMBERS', 'INJECT_FAULT', 'RAISE_STAKES', 'INJECT_VARIANT',
    'PIVOT_ANGLE',
    'NARROW_SCOPE', 'PROVIDE_ANCHOR', 'SALVAGE_AND_MOVE',
    'HAND_OFF', 'WRAP_TOPIC', 'CLOSE',
  ]) {
    assert.ok(MOVE_GUIDANCE[m], `MOVE_GUIDANCE.${m} must exist`);
  }
});

/* --------------------------- Directive rendering -------------------- */

test('Directive block ships only the active move guidance line (token economy)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'NUDGE_BREADTH',
        difficulty: 'L2',
        recommended_focus: 'what else does this system need?',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
        response_pace: 'normal',
      },
    },
  });
  assert.match(prompt, /# Directive \(your move this turn\)/);
  assert.match(prompt, /Move:\s+NUDGE_BREADTH/);
  // Only the active move's guidance should be present in the Directive block.
  // The full MOVE_GUIDANCE map is NOT printed; check that an unrelated move's
  // distinctive guidance phrase (CLOSE's "no performance assessment out loud")
  // does not appear.
  assert.doesNotMatch(prompt, /no performance assessment out loud/);
});

test('Directive block carries response_pace line when the directive sets it', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'INJECT_VARIANT',
        difficulty: 'L3',
        recommended_focus: 'what if 90% of clicks are bots?',
        momentum: 'hot',
        bar_trajectory: 'rising',
        time_status: 'on_track',
        response_pace: 'suspiciously_fast',
      },
    },
  });
  assert.match(prompt, /Pace:\s+suspiciously_fast/);
});

test('Directive block placeholder when next_directive is null (opening turn)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /\(no directive — opening turn; follow the Opening Protocol section above\)/);
});

test('Directive block emits answer_only instruction when answer_only=true', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'ANSWER_AND_RELEASE',
        difficulty: 'L1',
        recommended_focus: 'About 500k redirects per second globally at peak.',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
        answer_only: true,
      },
    },
  });
  assert.match(prompt, /ANSWER_AND_RELEASE: give exactly the one fact and STOP/);
  assert.match(prompt, /Do NOT append a follow-up probe/);
});

/* --------------------------- Opening Protocol ----------------------- */

test('Opening Protocol Case A (procedural ack → render reference text verbatim)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Case A — they acked/);
  assert.match(prompt, /Reply with the reference text above VERBATIM\. Word-for-word\./);
});

test('Opening Protocol Case B (substantive opening → engage directly, no recite)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Case B — they have already begun framing the problem/);
  assert.match(prompt, /DO NOT recite the reference text back/);
  assert.match(prompt, /ANSWER_AND_RELEASE on ONE scope question/);
});

test('Opening Protocol embeds config.problem.opening_prompt verbatim as DATA', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /<<</);
  assert.match(prompt, />>>/);
  // Pull a stable phrase from the v5 url_shortener opening_prompt.
  assert.match(prompt, /design a URL shortener/);
});

/* --------------------------- Channel register ----------------------- */

test('Chat-mode register block: prose only, no bullets, 3-sentence cap', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Channel/);
  assert.match(prompt, /written register/);
  assert.match(prompt, /Prose only/);
});

test('Voice-mode register block: TTS hint + 3-sentence cap', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'voice' },
    sessionState: {},
  });
  assert.match(prompt, /# Channel/);
  assert.match(prompt, /spoken aloud via TTS/);
});

/* --------------------------- Canvas snapshot ----------------------- */

test('Canvas snapshot empty placeholder warns against fabrication', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Candidate's current diagram/);
  assert.match(prompt, /no diagram drawn yet/);
  assert.match(prompt, /Never claim INABILITY to see permanently/);
});

test('Canvas snapshot with content marks the diagram as the source of truth', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: {
      interview_type: 'system_design',
      interview_mode: 'chat',
      canvas_text: 'Candidate sketch: API Gateway → Service A → Postgres + Redis',
    },
    sessionState: {},
  });
  assert.match(prompt, /A diagram IS present above/);
  assert.match(prompt, /API Gateway/);
});

/* --------------------------- Section ordering / safety ------------- */

test('Sections appear in the correct order (persona before directive before reference data)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: { next_directive: { move: 'GO_DEEPER', difficulty: 'L2' } },
  });
  const idxRole = prompt.indexOf('# What You Are');
  const idxHumanFeel = prompt.indexOf('# The Human Feel');
  const idxOpening = prompt.indexOf('# Opening Protocol');
  const idxDirective = prompt.indexOf('# Directive');
  const idxContractClose = prompt.indexOf('# Requirements Contract Closing');
  const idxAnti = prompt.indexOf('# Four Anti-Patterns');
  const idxSectionPlan = prompt.indexOf('# Section Plan');
  const idxCanvas = prompt.indexOf("Candidate's current diagram");

  assert.ok(idxRole >= 0);
  assert.ok(idxRole < idxHumanFeel);
  assert.ok(idxHumanFeel < idxOpening);
  assert.ok(idxOpening < idxDirective);
  assert.ok(idxDirective < idxContractClose);
  assert.ok(idxContractClose < idxAnti);
  assert.ok(idxAnti < idxSectionPlan);
  assert.ok(idxSectionPlan < idxCanvas);
});

test('Prompt under 18,000 characters with a complete v5 directive (token budget sanity)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'NUDGE_BREADTH',
        difficulty: 'L2',
        recommended_focus: 'what else does this system need before we go deeper there?',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
        response_pace: 'normal',
      },
    },
  });
  assert.ok(
    prompt.length < 18000,
    `prompt length ${prompt.length} exceeds 18000 — investigate what got added`
  );
});
