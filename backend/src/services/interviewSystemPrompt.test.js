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

/* --------------------------- v5.1 hardened rules --------------------- */

test('Hard Output Rules: CORE RULE 1 — ONE TURN = ONE MOVE with bundling BAD example', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /CORE RULE 1 — ONE TURN = ONE MOVE/);
  // Concrete bundling BAD example matching the transcript failure.
  assert.match(prompt, /Now walk me through your high-level architecture/);
  // The "if it doesn't fit in three sentences, you ARE bundling" tie-in.
  assert.match(prompt, /you ARE bundling — cut a move/);
});

test('Hard Output Rules: CORE RULE 2 — EARN BEFORE YOU NAME with engage-freely framing', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /CORE RULE 2 — EARN BEFORE YOU NAME/);
  // Engage-freely framing — the rule is positively framed, not pure prohibition.
  assert.match(prompt, /engage HARD/);
  assert.match(prompt, /Once the candidate surfaces|Once the candidate has surfaced/);
  // Concrete once-earned GOOD example (Redis cache or partition by hash).
  assert.match(prompt, /Redis cache|partition the URL table by hash|partition by hash/);
  // Coverage broader than scale — both required breadth components and deep-dive topics.
  assert.match(prompt, /Required Breadth Components/);
  assert.match(prompt, /Deep-Dive Topics/);
  // Three carve-outs explicitly enumerated.
  assert.match(prompt, /INJECT_FAULT \/ RAISE_STAKES \/ INJECT_VARIANT/);
  assert.match(prompt, /Requirements Contract Closing/);
});

test('Hard Output Rules: parenthetical-aside ban with concrete patterns', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /NO parenthetical asides/);
  assert.match(prompt, /\*\(Note:/);
  assert.match(prompt, /\(Note:/);
  assert.match(prompt, /\*\(Observing:/);
  assert.match(prompt, /the Planner does not read your reply/);
});

test('Hard Output Rules: explicit markdown forbidden-list (bullets, bold, headers)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /NO bullets/);
  assert.match(prompt, /\*\*bold\*\*/);
  assert.match(prompt, /## headers/);
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

test('Six Anti-Patterns block is present (Seeding, Bundling, Math correction, Echoing, Meta-leaking, Capitulation)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /# Six Anti-Patterns/);
  assert.match(prompt, /Seeding/);
  assert.match(prompt, /Bundling/);
  assert.match(prompt, /Math correction/);
  assert.match(prompt, /Echoing/);
  assert.match(prompt, /5\. Meta-leaking/);
  assert.match(prompt, /\(Note: \.\.\.\)/);
  assert.match(prompt, /Directive was to/);
  assert.match(prompt, /period followed by a fresh question/);
  assert.match(prompt, /Now walk me through high-level architecture/);
  // 6th anti-pattern (Capitulation) added to fix the T7/T9 cascade where
  // the Executor self-advanced phases and fabricated a contract-closing
  // summary against an explicit LET_LEAD / CHALLENGE_ASSUMPTION directive.
  assert.match(prompt, /6\. Capitulation/);
  assert.match(prompt, /the directive wins/i);
  assert.match(prompt, /the conversation is wrong, not the directive/);
});

test('Requirements Contract Closing block is present ONLY when directive is HAND_OFF leaving requirements', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'HAND_OFF',
        difficulty: 'L2',
        recommended_section_focus_id: 'high_level_design',
        recommended_focus: 'okay, I think I\'ve got the picture — let\'s get into the design.',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /# Requirements Contract Closing/);
  assert.match(prompt, /In scope:/);
  assert.match(prompt, /Out of scope:/);
  assert.match(prompt, /NFRs:/);
  assert.match(prompt, /Is that a fair picture\?/);
});

test('Requirements Contract Closing block is OMITTED when directive is LET_LEAD (the T7 fabrication fix)', () => {
  // T7 trace: directive was LET_LEAD with empty focus and an empty contract.
  // Prior to this fix, the closing template was always present in the prompt
  // and the Executor reached for it under conversational pressure, fabricating
  // scope items the candidate had not agreed to. The block must NOT render.
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'LET_LEAD',
        difficulty: 'L2',
        recommended_section_focus_id: 'requirements',
        recommended_focus: '',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.doesNotMatch(prompt, /# Requirements Contract Closing/);
  assert.doesNotMatch(prompt, /Is that a fair picture\?/);
});

test('Requirements Contract Closing block is OMITTED for non-HAND_OFF moves (CHALLENGE_ASSUMPTION, NUDGE_BREADTH, GO_DEEPER, etc.)', () => {
  const config = loadInterviewConfig();
  for (const move of ['CHALLENGE_ASSUMPTION', 'NUDGE_BREADTH', 'GO_DEEPER', 'ANSWER_AND_RELEASE', 'INJECT_FAULT']) {
    const prompt = buildSystemPrompt({
      config,
      interview: { interview_type: 'system_design', interview_mode: 'chat' },
      sessionState: {
        next_directive: {
          move,
          difficulty: 'L2',
          recommended_section_focus_id: 'requirements',
          recommended_focus: 'irrelevant',
          momentum: 'warm',
          bar_trajectory: 'flat',
          time_status: 'on_track',
        },
      },
    });
    assert.doesNotMatch(prompt, /# Requirements Contract Closing/, `Closing block leaked into ${move} prompt`);
  }
});

test('Requirements Contract Closing block is OMITTED on HAND_OFF that stays IN requirements (defensive)', () => {
  // A HAND_OFF whose target section is still "requirements" is not a hand-off
  // OUT of requirements — it shouldn't trigger the closing template either.
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'HAND_OFF',
        difficulty: 'L2',
        recommended_section_focus_id: 'requirements',
        recommended_focus: 'noop',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.doesNotMatch(prompt, /# Requirements Contract Closing/);
});

test('Requirements Contract Closing block is OMITTED when next_directive is null (opening turn)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.doesNotMatch(prompt, /# Requirements Contract Closing/);
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

test('MOVE_GUIDANCE.ANSWER_AND_RELEASE carries the bundled answer+question BAD example (v5.1)', () => {
  assert.ok(MOVE_GUIDANCE.ANSWER_AND_RELEASE);
  // Worked BAD pattern matching the transcript: answer followed by new question.
  assert.match(MOVE_GUIDANCE.ANSWER_AND_RELEASE, /Now walk me through your high-level architecture/);
  // The next-question-comes-NEXT-turn reminder.
  assert.match(MOVE_GUIDANCE.ANSWER_AND_RELEASE, /Planner on the NEXT turn/);
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

/* --------------------------- Directive Supremacy (v5.2) -------------- */

test('Directive block carries DIRECTIVE SUPREMACY header with conversation-overrides-directive framing', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'CHALLENGE_ASSUMPTION',
        difficulty: 'L2',
        recommended_section_focus_id: 'requirements',
        recommended_focus: 'Before we get to architecture — what NFRs are you targeting?',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /READ LAST, OBEY FIRST/);
  assert.match(prompt, /DIRECTIVE SUPREMACY/);
  assert.match(prompt, /the directive overrides both/);
  assert.match(prompt, /you have failed the turn/);
});

test('Directive block carries explicit LET_LEAD per-move rule (no summary, no redirect, no phase close)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'LET_LEAD',
        difficulty: 'L2',
        recommended_section_focus_id: 'requirements',
        recommended_focus: '',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /Move=LET_LEAD: minimal natural ack only/);
  assert.match(prompt, /Do NOT summarize/);
  assert.match(prompt, /Do NOT redirect/);
  assert.match(prompt, /Do NOT close a phase/);
  assert.match(prompt, /letting the candidate drive on purpose/);
});

test('Directive block carries explicit ANSWER_AND_RELEASE per-move rule (one fact, no probe, no transition phrase)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'ANSWER_AND_RELEASE',
        difficulty: 'L1',
        recommended_section_focus_id: 'requirements',
        recommended_focus: 'About 500k redirects per second globally at peak.',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /Move=ANSWER_AND_RELEASE: give exactly the one fact in the Focus, then stop/);
  assert.match(prompt, /Do NOT add a transition phrase/);
});

test('Directive block carries NO UNAUTHORIZED SECTION ADVANCEMENT rule with the actual section name', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'CHALLENGE_ASSUMPTION',
        difficulty: 'L2',
        recommended_section_focus_id: 'requirements',
        recommended_focus: 'what NFRs are you targeting?',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /NO UNAUTHORIZED SECTION ADVANCEMENT/);
  // The candidate's section is named explicitly so the LLM can't claim it didn't know.
  assert.match(prompt, /Your section this turn is requirements/);
  assert.match(prompt, /you hold the line/);
  assert.match(prompt, /Section transitions belong exclusively to HAND_OFF directives/);
  // The Section: line in the metadata block carries the same id.
  assert.match(prompt, /Section:\s+requirements/);
});

test('Directive block carries NO PROACTIVE SUMMARIZATION rule (T7 fabrication fix)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {
      next_directive: {
        move: 'LET_LEAD',
        difficulty: 'L2',
        recommended_section_focus_id: 'requirements',
        recommended_focus: '',
        momentum: 'warm',
        bar_trajectory: 'flat',
        time_status: 'on_track',
      },
    },
  });
  assert.match(prompt, /NO PROACTIVE SUMMARIZATION/);
  assert.match(prompt, /You do NOT proactively summarize/);
  assert.match(prompt, /its absence means do not summarize/);
});

/* --------------------------- Opening Protocol ----------------------- */

test('Opening Protocol (T1 only): renders the reference text verbatim regardless of candidate input', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  assert.match(prompt, /Opening Protocol \(active on T1 only\)/);
  assert.match(prompt, /Reply with the reference text above VERBATIM\. Word-for-word\./);
});

test('Opening Protocol (T1 only): explicitly forbids the "Got it. Continue." rubber-stamp on a substantive first turn (Planner-first covers redirects from T2)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: {},
  });
  // The candidate jumping to HLD on their very first message no longer earns
  // a rubber-stamp ack — Planner-first will issue a redirect on T2.
  assert.match(prompt, /Got it\. Continue/);
  assert.match(prompt, /do NOT say|Do NOT say/);
  assert.match(prompt, /Planner will see their substantive content on the next turn/);
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

test('Sections appear in the correct v5.2 order (Directive renders LAST, after all reference data and canvas)', () => {
  const config = loadInterviewConfig();
  const prompt = buildSystemPrompt({
    config,
    interview: { interview_type: 'system_design', interview_mode: 'chat' },
    sessionState: { next_directive: { move: 'GO_DEEPER', difficulty: 'L2' } },
  });
  const idxRole = prompt.indexOf('# What You Are');
  const idxHumanFeel = prompt.indexOf('# The Human Feel');
  const idxHardRules = prompt.indexOf('# Hard Output Rules');
  const idxAnti = prompt.indexOf('# Six Anti-Patterns');
  const idxOpening = prompt.indexOf('# Opening Protocol');
  const idxSectionPlan = prompt.indexOf('# Section Plan');
  const idxCanvas = prompt.indexOf("# Candidate's current diagram");
  const idxDirective = prompt.indexOf('# Directive');

  assert.ok(idxRole >= 0);
  assert.ok(idxRole < idxHumanFeel);
  // Hard Output Rules + Anti-Patterns appear right after Human Feel, BEFORE
  // Opening Protocol — so the model has read the bundling and
  // earn-before-name rules before any move-rendering.
  assert.ok(idxHumanFeel < idxHardRules, 'Hard Output Rules must follow Human Feel');
  assert.ok(idxHardRules < idxAnti, 'Anti-Patterns must follow Hard Output Rules');
  assert.ok(idxAnti < idxOpening, 'Anti-Patterns must precede Opening Protocol');
  // v5.2: the Directive is now the LAST block in the prompt. Reference data
  // (Section Plan, Canvas, etc.) renders before the Directive so recency bias
  // works FOR the operative instruction, not against it. This is the fix for
  // the T9 failure where the buried-mid-prompt directive was overridden by
  // chat-history conversational momentum.
  assert.ok(idxOpening < idxSectionPlan, 'Opening Protocol must precede Section Plan');
  assert.ok(idxSectionPlan < idxCanvas, 'Section Plan must precede Canvas');
  assert.ok(idxCanvas < idxDirective, 'Canvas must precede Directive (Directive renders LAST)');
  // The Directive really must be the last block — nothing meaningful after it.
  assert.ok(idxDirective > 0, 'Directive must be present');
  const tailFromDirective = prompt.slice(idxDirective);
  assert.doesNotMatch(tailFromDirective, /# (Section Plan|Candidate's current diagram|Hard Output Rules|Six Anti-Patterns|Opening Protocol|Difficulty Register|Channel|Problem|Scope|Scale Facts|Fault Scenarios|Raise-Stakes Prompts|Variant Scenarios|Requirements Contract Closing)/);
});

test('Prompt under 19,000 characters with a complete v5 directive (token budget sanity)', () => {
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
  // v5.1: budget bumped from 18000 → 19000 to accommodate the two new core
  // rules (ONE TURN = ONE MOVE, EARN BEFORE NAME) with concrete BAD/GOOD
  // examples that materially improve interviewer behavior.
  assert.ok(
    prompt.length < 19000,
    `prompt length ${prompt.length} exceeds 19000 — investigate what got added`
  );
});
