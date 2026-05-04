import { InterviewSignalSnapshot } from '../models/InterviewSignalSnapshot.js';
import { invokeLLM } from './llmInvoke.js';
import { recordSessionEndMetadata } from './interviewDebriefContext.js';

/**
 * v5 debrief generator.
 *
 * The Planner has already done the per-turn judgment work — green/red flags
 * tagged with section_id and signal_id, momentum, bar trajectory, verdict
 * trajectory, breadth coverage, and the locked requirements contract. The
 * debrief LLM's job is purely synthesis: read those flags, the contract,
 * the per-section leveling descriptions, the breadth coverage snapshot,
 * and the transcript — then write a structured report.
 *
 * No coverage gates beyond the (well-tested) `applyDebriefVerdictGuards`.
 */

/* --------------------------- Live state ------------------------------ */

function liveStateOf(interview) {
  if (interview?.session_state && Object.keys(interview.session_state).length > 0) {
    return interview.session_state;
  }
  return interview?.orchestrator_state || {};
}

function getInterviewConfig(interview) {
  return interview?.interview_config || interview?.execution_plan || {};
}

/**
 * Compact level label used in debrief prompts.
 */
function deriveCandidateLevel(interview) {
  const track = String(interview?.role_track || 'ic').toLowerCase();
  const level = String(interview?.experience_level || '').toLowerCase();
  const yoe = String(interview?.years_experience_band || '').toLowerCase();
  if (track === 'sdm') return 'SDM';
  if (level === 'lead' || level === 'staff' || yoe === '8_12' || yoe === '12_plus') return 'IC_STAFF';
  return 'IC_MID';
}

/* --------------------------- Schemas (UI contract) ------------------- */

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    section_scores: { type: 'object' },
    topic_signals: {
      type: 'object',
      properties: {
        weak: { type: 'array', items: { type: 'string' } },
        strong: { type: 'array', items: { type: 'string' } },
        never_tested: { type: 'array', items: { type: 'string' } },
      },
    },
    notable_quotes: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
};

const SD_SIGNAL_ROW = {
  type: 'object',
  properties: {
    signal: { type: 'string' },
    score: { type: 'number' },
    evidence: { type: 'string' },
    what_it_means: { type: 'string' },
  },
};

const SD_SECTION_ENTRY_NESTED = {
  type: 'object',
  properties: {
    weighted_score: { type: 'string' },
    status: { type: 'string' },
    signals: { type: 'array', items: SD_SIGNAL_ROW },
  },
};

const SD_TOP_MOMENT = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    moment: { type: 'string' },
    why_it_matters: { type: 'string' },
  },
};

const SD_FOCUS_ITEM = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    reason: { type: 'string' },
  },
};

const SD_DEBRIEF_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    verdict_reason: { type: 'string' },
    overall_score: { type: 'string' },
    completion_note: { type: 'string' },
    section_scores: { type: 'object', additionalProperties: SD_SECTION_ENTRY_NESTED },
    top_moments: { type: 'array', items: SD_TOP_MOMENT },
    faang_bar_assessment: { type: 'string' },
    next_session_focus: { type: 'array', items: SD_FOCUS_ITEM },
  },
};

const VALID_VERDICTS = new Set([
  'Strong Hire',
  'Hire',
  'No Hire',
  'Strong No Hire',
  'Incomplete — Cannot Assess',
]);

/* --------------------------- Helpers --------------------------------- */

function transcriptCompactIc(interview) {
  const turns = interview.conversation_turns || [];
  if (turns.length) {
    return turns.map((t) => `${t.role === 'interviewer' ? 'I' : 'C'}: ${t.content}`).join('\n');
  }
  return (interview.questions || [])
    .map((q, i) => `Q${i + 1}: ${q.question}\nC: ${q.answer}`)
    .join('\n');
}

/**
 * Parse numeric score from debrief overall_score string like "3.25/4.0".
 * @param {unknown} debriefOrString
 */
export function parseOverallScoreFraction(debriefOrString) {
  const s =
    typeof debriefOrString === 'string'
      ? debriefOrString
      : typeof debriefOrString === 'object' && debriefOrString != null
        ? String(debriefOrString.overall_score || '')
        : '';
  const m = s.match(/^([\d.]+)\s*\/\s*4/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function formatLevelingForSection(section) {
  const lev = section?.leveling || {};
  const parts = [];
  if (lev.one_down?.description) {
    parts.push(`one_down (${lev.one_down.label || 'one_down'}): ${lev.one_down.description}`);
  }
  if (lev.target?.description) {
    parts.push(`target ★ (${lev.target.label || 'target'}): ${lev.target.description}`);
  }
  if (lev.one_up?.description) {
    parts.push(`one_up (${lev.one_up.label || 'one_up'}): ${lev.one_up.description}`);
  }
  return parts.join('\n      ');
}

function buildPerSectionEvidenceBlock(config, sessionState) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  const flagsBySection = sessionState?.flags_by_section || {};
  const performanceBySection = sessionState?.performance_by_section || {};
  const sectionMinutesUsed = sessionState?.section_minutes_used || {};
  const probeQueue = sessionState?.probe_queue || {};
  const evalHistory = Array.isArray(sessionState?.eval_history) ? sessionState.eval_history : [];
  const breadthMissing = Array.isArray(sessionState?.breadth_coverage?.components_missing)
    ? sessionState.breadth_coverage.components_missing
    : [];

  const everTouched = new Set();
  for (const e of evalHistory) {
    if (e?.recommended_section_focus_id) everTouched.add(e.recommended_section_focus_id);
  }

  const lines = [];
  for (const sec of sections) {
    const id = sec.id;
    const flags = Array.isArray(flagsBySection[id]) ? flagsBySection[id] : [];
    const greens = flags.filter((f) => f.type === 'green');
    const reds = flags.filter((f) => f.type === 'red');
    const minutesUsed = Number(sectionMinutesUsed[id] || 0).toFixed(1);
    const budget = Number(sec.budget_minutes) || 0;
    const perf = performanceBySection[id] || 'unclear';
    const queue = Array.isArray(probeQueue[id]) ? probeQueue[id] : [];
    const openProbes = queue.filter((p) => !p.consumed);

    let status = 'not_reached';
    if (flags.length > 0 || perf !== 'unclear') status = 'completed';
    else if (everTouched.has(id) || Number(minutesUsed) > 0.5) status = 'partial';

    lines.push(`SECTION ${id} — "${sec.label || id}"  [${status}]`);
    lines.push(`  budget: ${budget}m   used: ${minutesUsed}m   live performance: ${perf}`);
    if (id === 'high_level_design' && breadthMissing.length > 0) {
      lines.push(`  BREADTH GAPS (components never raised): ${breadthMissing.join(', ')}`);
    }
    if (sec.faang_bar) lines.push(`  FAANG bar: ${sec.faang_bar}`);
    const lev = formatLevelingForSection(sec);
    if (lev) lines.push(`  Leveling:\n      ${lev}`);
    lines.push(`  GREEN flags (${greens.length}):`);
    for (const f of greens) lines.push(`    - [${f.signal_id}] ${f.note}`);
    lines.push(`  RED flags (${reds.length}):`);
    for (const f of reds) lines.push(`    - [${f.signal_id}] ${f.note}`);
    if (openProbes.length > 0) {
      lines.push(`  UNCONSUMED probes (${openProbes.length}) — areas the Planner queued but never reached:`);
      for (const p of openProbes.slice(0, 3)) {
        lines.push(`    - ${String(p.observation || p.probe || '').slice(0, 120)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildContractBlock(sessionState) {
  const c = sessionState?.requirements_contract;
  if (!c || !c.locked) {
    return 'REQUIREMENTS CONTRACT: not locked during the session (red signal — candidate did not converge on a contract).';
  }
  const lines = [
    `REQUIREMENTS CONTRACT (locked at turn ${c.locked_at_turn ?? '?'}):`,
    `  Functional:     ${(c.functional || []).join('; ') || '(none)'}`,
    `  Non-functional: ${(c.non_functional || []).join('; ') || '(none)'}`,
    `  In scope:       ${(c.in_scope || []).join('; ') || '(none)'}`,
    `  Out of scope:   ${(c.out_of_scope || []).join('; ') || '(none)'}`,
  ];
  return lines.join('\n');
}

function buildBreadthSummaryBlock(config, sessionState) {
  const required = Array.isArray(config?.required_breadth_components)
    ? config.required_breadth_components
    : [];
  if (required.length === 0) return '';
  const mentioned = Array.isArray(sessionState?.breadth_coverage?.components_mentioned)
    ? sessionState.breadth_coverage.components_mentioned
    : [];
  const missing = Array.isArray(sessionState?.breadth_coverage?.components_missing)
    ? sessionState.breadth_coverage.components_missing
    : required.filter((c) => !mentioned.includes(c));
  return [
    `BREADTH COVERAGE (final):`,
    `  Required (${required.length}): ${required.join(', ')}`,
    `  Mentioned (${mentioned.length}): ${mentioned.join(', ') || '(none)'}`,
    `  Missing (${missing.length}): ${missing.join(', ') || '(full coverage)'}`,
  ].join('\n');
}

function buildMomentumTrajectoryBlock(sessionState) {
  const evalHistory = Array.isArray(sessionState?.eval_history) ? sessionState.eval_history : [];
  if (evalHistory.length === 0) return '(no eval history captured)';
  const compact = evalHistory.map((e) => {
    const t = e?.turn_index ?? '?';
    const sec = e?.recommended_section_focus_id || '?';
    const perf = e?.performance_assessment || 'unclear';
    const mov = e?.move || '?';
    const dif = e?.difficulty || 'L?';
    const mom = e?.momentum || '?';
    return `  t${t} [${sec}] ${perf} (${mom}/${dif}) → ${mov}`;
  });
  return compact.slice(-30).join('\n');
}

/* --------------------------- v5 debrief prompt ----------------------- */

export function buildV5DebriefPrompt(config, sessionState, interview) {
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  const totalSections = sections.length || 1;

  const startedAt =
    sessionState?.session_wall_start_ms ??
    (interview.session_started_at ? new Date(interview.session_started_at).getTime() : Date.now());
  const endedAt =
    sessionState?.session_ended_at_ms != null && Number.isFinite(sessionState.session_ended_at_ms)
      ? sessionState.session_ended_at_ms
      : Date.now();
  const totalMinutes = ((endedAt - startedAt) / 60000).toFixed(1);
  const expectedMinutes = config?.total_minutes ?? 60;
  const completionPct = Math.round((parseFloat(totalMinutes) / Math.max(1, expectedMinutes)) * 100);

  const flagsBySection = sessionState?.flags_by_section || {};
  const performanceBySection = sessionState?.performance_by_section || {};
  const evalHistory = Array.isArray(sessionState?.eval_history) ? sessionState.eval_history : [];
  const everTouched = new Set();
  for (const e of evalHistory) {
    if (e?.recommended_section_focus_id) everTouched.add(e.recommended_section_focus_id);
  }
  const sectionsWithEvidence = sections.filter((s) => {
    const f = Array.isArray(flagsBySection[s.id]) ? flagsBySection[s.id] : [];
    return f.length > 0 || !!performanceBySection[s.id];
  }).length;
  const sectionsTouched = sections.filter((s) => everTouched.has(s.id)).length;
  const sectionsAttempted = Math.max(sectionsWithEvidence, sectionsTouched);

  const transcript = transcriptCompactIc(interview);
  const candidateLevel = deriveCandidateLevel(interview);
  const targetLevel = config?.target_level || 'SR_SDE';
  const problemTitle = config?.problem?.title || 'System design';
  const problemBrief = String(config?.problem?.brief || '').replace(/"/g, '\\"').slice(0, 600);

  const evidenceBlock = buildPerSectionEvidenceBlock(config, sessionState);
  const momentumBlock = buildMomentumTrajectoryBlock(sessionState);
  const contractBlock = buildContractBlock(sessionState);
  const breadthSummary = buildBreadthSummaryBlock(config, sessionState);
  const finalVerdictTraj = String(sessionState?.verdict_trajectory || 'insufficient_data');

  return `Generate an interview debrief report. Return JSON only.

METADATA:
candidate_level=${candidateLevel}
target_level=${targetLevel}
problem="${String(problemTitle).replace(/"/g, '\\"')}"
${problemBrief ? `problem_brief="${problemBrief}"` : ''}
duration=${totalMinutes}min (planned ${expectedMinutes}min)
completion=${completionPct}%
sections_with_evidence=${sectionsAttempted}/${totalSections}
final_verdict_trajectory=${finalVerdictTraj}  (Planner's running call; use as a hint, still apply the VERDICT RULES below)

${contractBlock}

${breadthSummary}

PER-SECTION EVIDENCE — flags emitted by the live Planner during the interview, plus the bar definitions for context:

${evidenceBlock}

LIVE TRAJECTORY — what the Planner observed turn-by-turn (use only for narrative; do not double-count flags):
${momentumBlock}

FULL TRANSCRIPT:
${transcript}

INSTRUCTIONS:
1. For each section: weighted_score reflects the green/red flag balance against the target_level bar. 4.0 = at_target+ across all signals. 3.0 = at_target with one weak signal. 2.0 = below_target. 1.0 = no signal captured. Include status: completed | partial | not_reached.
2. For each section's signals[] in section_scores: pull the signal_id from the flags above; quote the note as evidence; map the score using target_level: green flag = 3-4, red flag = 1-2, no flag = null.
3. top_moments[]: 2-4 strongest moments and 1-3 clearest gaps from the flags + transcript. Each must reference a specific moment, not generic praise.
4. faang_bar_assessment: 3-4 sentences on whether the candidate cleared the target_level bar. Reference both moments and gaps.
5. next_session_focus: per-area items derived from red flags and unconsumed probes.

VERDICT RULES (non-negotiable):
- completion < 40% OR duration < 15min  → verdict = "Incomplete — Cannot Assess"
- completion 40-60% AND not all sections at score 4 → verdict capped at "No Hire"
- weighted overall < 2.0 → "Strong No Hire"
- weighted overall 2.0-2.7 → "No Hire"
- weighted overall 2.8-3.4 AND completion >= 80% → "Hire"
- weighted overall >= 3.5 AND completion >= 80% → eligible for "Strong Hire"

Return:
{
  "verdict": "...",
  "verdict_reason": "2 sentences. Reference both score and one specific moment.",
  "overall_score": "x.x/4.0",
  "completion_note": "${sectionsAttempted} of ${totalSections} sections in ${totalMinutes} min.",
  "section_scores": {
    "[section_id]": {
      "weighted_score": "x.x/4.0",
      "status": "completed|partial|not_reached",
      "signals": [
        {
          "signal": "human-readable signal name",
          "score": 1-4 or null,
          "evidence": "quote the flag note or a transcript moment",
          "what_it_means": "one line of bar context from the leveling block"
        }
      ]
    }
  },
  "top_moments": [
    { "type": "strength|gap", "moment": "what they said or did", "why_it_matters": "..." }
  ],
  "faang_bar_assessment": "3-4 sentences on bar fit. Reference actual moments.",
  "next_session_focus": [
    { "area": "...", "reason": "why — reference transcript or red flag" }
  ]
}`;
}

/* --------------------------- Output normalization ------------------- */

/**
 * Normalize the LLM debrief output. Handles missing/malformed fields,
 * forces `not_reached` sections to a stable empty shape.
 */
export function normalizeSdStructuredDebrief(raw, sectionIds = [], coverageMap = []) {
  if (!raw || typeof raw !== 'object') return null;
  let verdict = String(raw.verdict || '').trim() || 'Hire';
  if (!VALID_VERDICTS.has(verdict)) verdict = 'Hire';
  const verdict_reason =
    typeof raw.verdict_reason === 'string' && raw.verdict_reason.trim()
      ? raw.verdict_reason.trim()
      : '';

  const completion_note =
    typeof raw.completion_note === 'string' && raw.completion_note.trim()
      ? raw.completion_note.trim()
      : '';

  const overall_score = typeof raw.overall_score === 'string' ? raw.overall_score.trim() : '';

  const statusById = {};
  for (const row of coverageMap) {
    if (row && row.id) statusById[String(row.id)] = String(row.status || '').trim() || 'partial';
  }

  const rawSs = raw.section_scores && typeof raw.section_scores === 'object' ? raw.section_scores : {};
  const ids =
    Array.isArray(sectionIds) && sectionIds.length
      ? sectionIds
      : [...new Set([...Object.keys(rawSs), ...Object.keys(statusById)])].filter(Boolean);

  const section_scores = {};
  for (const id of ids) {
    const forced = statusById[id];
    const v = rawSs[id];
    if (forced === 'not_reached') {
      section_scores[id] = {
        weighted_score: '—/4.0',
        status: 'not_reached',
        signals: [],
      };
      continue;
    }
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const stRaw = String(v.status || forced || 'completed').trim() || 'completed';
      const st = ['completed', 'partial', 'not_reached'].includes(stRaw) ? stRaw : forced || 'partial';
      if (st === 'not_reached') {
        section_scores[id] = {
          weighted_score: String(v.weighted_score || '—/4.0'),
          status: 'not_reached',
          signals: [],
        };
        continue;
      }
      const signals = Array.isArray(v.signals)
        ? v.signals
            .map((row) => {
              if (!row || typeof row !== 'object') return null;
              const sc = row.score;
              let score = null;
              if (sc !== null && sc !== undefined && sc !== 'null') {
                const n = Math.round(Number(sc));
                score = Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : null;
              }
              return {
                signal: String(row.signal || '').trim(),
                score,
                evidence: String(row.evidence || '').trim(),
                what_it_means: String(row.what_it_means || '').trim(),
              };
            })
            .filter(Boolean)
        : [];
      section_scores[id] = {
        weighted_score: String(v.weighted_score || '—/4.0'),
        status: st,
        signals,
      };
    } else if (forced !== 'not_reached') {
      section_scores[id] = {
        weighted_score: '—/4.0',
        status: forced || 'partial',
        signals: [],
      };
    }
  }

  const top_moments = Array.isArray(raw.top_moments)
    ? raw.top_moments
        .map((m) => {
          if (!m || typeof m !== 'object') return null;
          return {
            type: String(m.type || '').trim(),
            moment: String(m.moment || '').trim(),
            why_it_matters: String(m.why_it_matters || '').trim(),
          };
        })
        .filter(Boolean)
    : [];

  const next_session_focus = Array.isArray(raw.next_session_focus)
    ? raw.next_session_focus
        .map((x) => ({
          area: String(x?.area || '').trim(),
          reason: String(x?.reason || '').trim(),
        }))
        .filter((x) => x.area || x.reason)
    : [];

  const strengths = top_moments
    .filter((m) => String(m.type).toLowerCase() === 'strength')
    .map((m) => ({ point: m.moment || '—', evidence: m.why_it_matters || '—' }));
  const improvements = top_moments
    .filter((m) => String(m.type).toLowerCase() === 'gap')
    .map((m) => ({ point: m.moment || '—', evidence: m.why_it_matters || '—' }));

  return {
    verdict,
    verdict_reason,
    overall_score,
    completion_note,
    section_scores,
    top_moments,
    faang_bar_assessment: String(raw.faang_bar_assessment || '').trim(),
    next_session_focus,
    strengths: strengths.length ? strengths : [{ point: '—', evidence: '—' }],
    improvements: improvements.length ? improvements : [{ point: '—', evidence: '—' }],
    debrief_kind: 'system_design_rubric',
  };
}

/* --------------------------- Verdict guards --------------------------- */

/**
 * Deterministic caps so short / low-coverage sessions cannot surface
 * Hire/Strong Hire from model drift.
 */
export function applyDebriefVerdictGuards(debrief, interview, coverageOverride) {
  if (!debrief || typeof debrief !== 'object') return debrief;

  const ls = liveStateOf(interview);
  const coverageMap =
    Array.isArray(coverageOverride) && coverageOverride.length
      ? coverageOverride
      : Array.isArray(ls.debrief_section_coverage_map)
        ? ls.debrief_section_coverage_map
        : [];

  const min = typeof ls.debrief_elapsed_minutes === 'number' ? ls.debrief_elapsed_minutes : null;
  const secPct =
    typeof ls.debrief_section_progress_pct === 'number' ? ls.debrief_section_progress_pct : null;
  const hasNotReached = coverageMap.some((r) => r && r.status === 'not_reached');
  const scoreNum = parseOverallScoreFraction(debrief);

  for (const row of coverageMap) {
    if (
      row &&
      row.status === 'not_reached' &&
      row.id &&
      debrief.section_scores &&
      debrief.section_scores[row.id]
    ) {
      debrief.section_scores[row.id] = {
        weighted_score: '—/4.0',
        status: 'not_reached',
        signals: [],
      };
    }
  }

  let verdict = debrief.verdict;
  const before = verdict;
  const reason0 = typeof debrief.verdict_reason === 'string' ? debrief.verdict_reason : '';

  if (min != null && min < 15) {
    verdict = 'Incomplete — Cannot Assess';
  } else if (secPct != null && secPct < 40) {
    verdict = 'Incomplete — Cannot Assess';
  } else if (secPct != null && secPct >= 40 && secPct < 60) {
    if (verdict === 'Strong Hire' || verdict === 'Hire') verdict = 'No Hire';
  } else if (scoreNum != null && verdict !== 'Incomplete — Cannot Assess') {
    if (scoreNum < 2.0) verdict = 'Strong No Hire';
    else if (scoreNum <= 2.7) verdict = 'No Hire';
    else if (
      secPct != null &&
      secPct >= 80 &&
      scoreNum >= 2.8 &&
      scoreNum <= 3.4 &&
      verdict === 'Strong Hire'
    ) {
      verdict = 'Hire';
    }
  }

  if (hasNotReached && verdict === 'Strong Hire') verdict = 'Hire';

  if (verdict !== before) {
    debrief.verdict = verdict;
    const note =
      verdict === 'Incomplete — Cannot Assess'
        ? '[Verdict capped: duration/coverage vs planned interview.]'
        : '[Verdict adjusted for v3 debrief rules.]';
    debrief.verdict_reason = [reason0.trim(), note].filter(Boolean).join(' ');
  }

  return debrief;
}

/* --------------------------- Main entry ------------------------------ */

async function generateV5StructuredDebrief(interview) {
  const config = getInterviewConfig(interview);
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  const sectionIds = sections.map((s) => s.id).filter(Boolean);
  const ls = liveStateOf(interview);

  // Coverage from the substrate (already computed by recordSessionEndMetadata,
  // but recompute here in case finalize was called without it).
  const flagsBySection = ls?.flags_by_section || {};
  const performanceBySection = ls?.performance_by_section || {};
  const sectionMinutesUsed = ls?.section_minutes_used || {};
  const evalHistory = Array.isArray(ls?.eval_history) ? ls.eval_history : [];
  const everTouched = new Set();
  for (const e of evalHistory) {
    if (e?.recommended_section_focus_id) everTouched.add(e.recommended_section_focus_id);
  }
  const sectionCoverageMap = sections.map((s) => {
    const id = s.id;
    const hasFlags = Array.isArray(flagsBySection[id]) && flagsBySection[id].length > 0;
    const hasPerf = !!performanceBySection[id];
    const hasTime = (sectionMinutesUsed[id] || 0) > 0.5;
    const touched = everTouched.has(id);
    let status = 'not_reached';
    if (hasFlags || hasPerf) status = 'completed';
    else if (touched || hasTime) status = 'partial';
    return { id, name: s.label || s.name || id, status };
  });

  const prompt = buildV5DebriefPrompt(config, ls, interview);

  const raw = await invokeLLM({
    prompt,
    response_json_schema: SD_DEBRIEF_SCHEMA,
    modelTier: 'extraction',
  });
  const normalized = normalizeSdStructuredDebrief(raw, sectionIds, sectionCoverageMap);
  return applyDebriefVerdictGuards(normalized, interview, sectionCoverageMap);
}

export async function generateStructuredDebrief(interview) {
  return generateV5StructuredDebrief(interview);
}

export async function extractHistorySignals(interview) {
  const turns = Array.isArray(interview.conversation_turns) ? interview.conversation_turns : [];
  const transcript = turns.length
    ? turns.map((t) => `${t.role === 'interviewer' ? 'I' : 'C'}: ${t.content}`).join('\n')
    : (interview.questions || [])
        .map((q, i) => `Q${i + 1}: ${q.question}\nA: ${q.answer}`)
        .join('\n\n');

  const prompt = `From this interview transcript, produce structured signals for the candidate's profile (used to personalize a future session).

TRANSCRIPT:
${transcript}

Return JSON with section_scores (object mapping section id to 0-1 score if inferable), topic_signals { weak, strong, never_tested }, notable_quotes (short strings), recommendation (strong_hire | hire | no_hire | neutral).`;

  return invokeLLM({
    prompt,
    response_json_schema: EXTRACTION_SCHEMA,
    modelTier: 'extraction',
  });
}

/**
 * Mark interview completed, write summary + signal snapshot.
 * @param {import('mongoose').Document} interview
 */
export async function finalizeOrchestratedInterview(interview) {
  if (interview.status === 'completed') {
    return interview;
  }

  const ls = liveStateOf(interview);
  const config = getInterviewConfig(interview);
  if (config && Object.keys(config).length > 0 && ls && !ls.session_ended_at_ms) {
    recordSessionEndMetadata(interview, { source: 'finalize_fallback' });
  }

  const startedMs = interview.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : Date.now();
  const endedMs =
    ls?.session_ended_at_ms != null && Number.isFinite(ls.session_ended_at_ms)
      ? ls.session_ended_at_ms
      : Date.now();
  const duration_seconds = Math.round(Math.max(0, endedMs - startedMs) / 1000);

  const needsDebrief = Boolean(config?.problem || config?.primary_question);

  const [extracted, debrief] = await Promise.all([
    extractHistorySignals(interview),
    needsDebrief ? generateStructuredDebrief(interview) : Promise.resolve(null),
  ]);

  await InterviewSignalSnapshot.create({
    userId: interview.userId,
    interviewClientId: interview.clientId,
    completedAt: new Date(),
    template_id: interview.template_id,
    section_scores: extracted?.section_scores || {},
    topic_signals: {
      weak: extracted?.topic_signals?.weak || [],
      strong: extracted?.topic_signals?.strong || [],
      never_tested: extracted?.topic_signals?.never_tested || [],
    },
    notable_quotes: extracted?.notable_quotes || [],
    recommendation: extracted?.recommendation || 'neutral',
  });

  interview.status = 'completed';
  interview.duration_seconds = duration_seconds;

  if (debrief && typeof debrief === 'object') {
    interview.debrief = debrief;
    const rubricFraction = parseOverallScoreFraction(debrief);
    if (rubricFraction != null) {
      interview.overall_score = Math.round((rubricFraction / 4) * 100);
    }
  }

  await interview.save();
  return interview;
}
