import { InterviewSignalSnapshot } from '../models/InterviewSignalSnapshot.js';
import { invokeLLM } from './llmInvoke.js';
import { deriveCandidateLevel } from './interviewLevel.js';
import { recordSessionEndMetadata } from './interviewDebriefContext.js';
import { aggregateLiveEvaluationForReport } from './liveEvaluationMerge.js';

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

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary_feedback: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
  },
};

const DEBRIEF_POINT = {
  type: 'object',
  properties: {
    point: { type: 'string' },
    evidence: { type: 'string' },
  },
};

const DEBRIEF_SECTION_ENTRY = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    status: { type: 'string' },
    comment: { type: 'string' },
  },
};

const DEBRIEF_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    verdict_reason: { type: 'string' },
    completion_note: { type: 'string' },
    section_scores: { type: 'object', additionalProperties: DEBRIEF_SECTION_ENTRY },
    strengths: { type: 'array', items: DEBRIEF_POINT },
    improvements: { type: 'array', items: DEBRIEF_POINT },
    faang_bar_assessment: { type: 'string' },
    next_session_focus: { type: 'array', items: { type: 'string' } },
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
 * @param {unknown} debriefOrString debrief object or raw string
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

/**
 * Verbatim-structure report prompt for system design rubric debrief.
 */
export function buildSystemDesignReportPrompt(interview, ctx) {
  const {
    totalMinutes,
    expectedMinutes,
    completionPct,
    sectionsAttempted,
    totalSections,
    overallScore,
    sectionSummaries,
    transcript,
    sparseLiveScores,
  } = ctx;
  const plan = interview.execution_plan || {};
  const pq = plan.primary_question;
  const questionTitle = pq && typeof pq === 'object' ? pq.title : 'System design';
  const level = deriveCandidateLevel(interview);
  const safeQ = String(questionTitle).replace(/"/g, '\\"');
  const sparseBlock = sparseLiveScores
    ? `NOTE: Live rubric scores were sparse — use FULL TRANSCRIPT for narrative fields where scores are missing.\n\n`
    : '';
  const overallDisplay = overallScore != null ? overallScore : 'null';
  const overallScoreExample =
    overallScore != null ? `${overallScore}/4.0` : '—/4.0';

  return `${sparseBlock}Generate an interview debrief report. Return JSON only.

METADATA:
level=${level}
question="${safeQ}"
duration=${totalMinutes}min (expected ${expectedMinutes}min)
completion=${completionPct}%
sections_attempted=${sectionsAttempted}/${totalSections}
computed_weighted_score=${overallDisplay} (out of 4.0)

RUBRIC SCORES CAPTURED DURING INTERVIEW:
${JSON.stringify(sectionSummaries, null, 2)}

FULL TRANSCRIPT:
${transcript}

VERDICT RULES (non-negotiable):
- completion < 40% → verdict = "Incomplete — Cannot Assess"
- completion 40-60% → verdict capped at "No Hire" regardless of scores  
- score >= 3.5 AND completion >= 80% → eligible for "Strong Hire"
- score 2.8-3.4 AND completion >= 80% → "Hire"
- score 2.0-2.7 → "No Hire"
- score < 2.0 → "Strong No Hire"
- duration < 15min → verdict = "Incomplete — Cannot Assess" always

Return:
{
  "verdict": "...",
  "verdict_reason": "2 sentences. Reference score, completion, and 1 specific moment.",
  "overall_score": "${overallScoreExample}",
  "completion_note": "${sectionsAttempted} of ${totalSections} sections in ${totalMinutes} min.",
  "section_scores": {
    "[section_id]": {
      "weighted_score": "x.x/4.0",
      "status": "completed|partial|not_reached",
      "signals": [
        {
          "signal": "...",
          "score": 1-4 or null,
          "evidence": "exact quote or moment — never generic",
          "what_it_means": "one line from rubric score description"
        }
      ]
    }
  },
  "top_moments": [
    { "type": "strength|gap", "moment": "what they said or did", "why_it_matters": "..." }
  ],
  "faang_bar_assessment": "3-4 sentences. Specific. Reference actual moments.",
  "next_session_focus": [
    { "area": "...", "reason": "why — reference transcript evidence" }
  ]
}`;
}

/**
 * Normalize LLM output for system design rubric debrief.
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

function liveEvaluationHasScores(le) {
  if (!le || typeof le !== 'object') return false;
  for (const sec of Object.values(le)) {
    if (!sec || typeof sec !== 'object') continue;
    for (const ev of Object.values(sec)) {
      if (
        ev &&
        typeof ev === 'object' &&
        ev.score != null &&
        Number(ev.score) >= 1 &&
        Number(ev.score) <= 4
      ) {
        return true;
      }
    }
  }
  return false;
}

async function generateSystemDesignStructuredDebrief(interview) {
  const plan = interview.execution_plan || {};
  const pq = plan.primary_question;
  const sections = plan.sections || [];
  const sectionIds = sections.map((s) => s.id).filter(Boolean);
  const os = interview.orchestrator_state || {};

  const startedAt =
    os.session_wall_start_ms ??
    (interview.session_started_at ? new Date(interview.session_started_at).getTime() : Date.now());
  const endedAt =
    os.session_ended_at_ms != null && Number.isFinite(os.session_ended_at_ms)
      ? os.session_ended_at_ms
      : Date.now();
  const totalMinutes = ((endedAt - startedAt) / 60000).toFixed(1);
  const expectedMinutes = plan.total_minutes ?? 60;
  const curIdx = os.current_section_index ?? 0;
  const sectionsAttempted = curIdx + 1;
  const totalSections = sections.length || 1;
  const completionPct = Math.round((sectionsAttempted / totalSections) * 100);

  const sectionCoverageMap = sections.map((s, i) => ({
    id: s.id,
    name: s.name,
    status: i < curIdx ? 'completed' : i === curIdx ? 'partial' : 'not_reached',
  }));

  const liveEval = os.live_evaluation || {};
  const sparseLiveScores = !liveEvaluationHasScores(liveEval);

  const { sectionSummaries, overallScore } = aggregateLiveEvaluationForReport(liveEval);
  const transcript = transcriptCompactIc(interview);

  const prompt = buildSystemDesignReportPrompt(interview, {
    totalMinutes,
    expectedMinutes,
    completionPct,
    sectionsAttempted,
    totalSections,
    overallScore,
    sectionSummaries,
    transcript,
    sparseLiveScores,
  });

  const raw = await invokeLLM({
    prompt,
    response_json_schema: SD_DEBRIEF_SCHEMA,
    modelTier: 'extraction',
  });
  const normalized = normalizeSdStructuredDebrief(raw, sectionIds, sectionCoverageMap);
  return applyDebriefVerdictGuards(normalized, interview, sectionCoverageMap);
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string[]} sectionIds
 * @param {Array<{ id?: string, name?: string, status?: string }>} coverageMap
 */
export function normalizeStructuredDebrief(raw, sectionIds = [], coverageMap = []) {
  if (!raw || typeof raw !== 'object') return null;
  let verdict = String(raw.verdict || '').trim() || 'Hire';
  if (!VALID_VERDICTS.has(verdict)) verdict = 'Hire';
  const verdict_reason =
    typeof raw.verdict_reason === 'string' && raw.verdict_reason.trim()
      ? raw.verdict_reason.trim()
      : typeof raw.verdict_summary === 'string' && raw.verdict_summary.trim()
        ? raw.verdict_summary.trim()
        : '';

  const completion_note =
    typeof raw.completion_note === 'string' && raw.completion_note.trim()
      ? raw.completion_note.trim()
      : '';

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
      section_scores[id] = { score: null, status: 'not_reached', comment: 'Section not covered.' };
      continue;
    }
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const stRaw = String(v.status || forced || 'completed').trim() || 'completed';
      const st = ['completed', 'partial', 'not_reached'].includes(stRaw) ? stRaw : forced || 'partial';
      if (st === 'not_reached') {
        section_scores[id] = {
          score: null,
          status: 'not_reached',
          comment: String(v.comment || '').trim() || 'Section not covered.',
        };
        continue;
      }
      const rawSc = v.score;
      if (rawSc === null || rawSc === undefined || rawSc === 'null') {
        section_scores[id] = {
          score: null,
          status: st,
          comment: String(v.comment || '').trim(),
        };
        continue;
      }
      const sc = Math.round(Number(rawSc));
      const score = Number.isFinite(sc) ? Math.min(4, Math.max(1, sc)) : null;
      section_scores[id] = {
        score,
        status: st,
        comment: String(v.comment || '').trim(),
      };
    } else if (v != null && (typeof v === 'number' || typeof v === 'string')) {
      const sc = Math.round(Number(v));
      if (Number.isFinite(sc)) {
        section_scores[id] = {
          score: Math.min(4, Math.max(1, sc)),
          status: forced || 'completed',
          comment: '',
        };
      }
    }
  }

  function mapEvidence(arr, legacy) {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        if (item.point != null || item.evidence != null) {
          return { point: String(item.point || '').trim() || '—', evidence: String(item.evidence || '').trim() || '—' };
        }
        if (legacy && (item.title != null || item.quote != null)) {
          return {
            point: String(item.title || 'Strength').trim(),
            evidence: String(item.quote || item.detail || '').trim() || '—',
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  let strengths = mapEvidence(raw.strengths, false);
  let improvements = mapEvidence(raw.improvements, false);
  if (!strengths.length) strengths = mapEvidence(raw.strengths_evidence, true);
  if (!improvements.length) improvements = mapEvidence(raw.improvements_evidence, true);
  while (strengths.length < 3) strengths.push({ point: '—', evidence: '—' });
  while (improvements.length < 3) improvements.push({ point: '—', evidence: '—' });

  return {
    verdict,
    verdict_reason,
    completion_note,
    section_scores,
    strengths: strengths.slice(0, 6),
    improvements: improvements.slice(0, 6),
    faang_bar_assessment: String(raw.faang_bar_assessment || '').trim(),
    next_session_focus: Array.isArray(raw.next_session_focus)
      ? raw.next_session_focus.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

/**
 * Deterministic caps so short / low-coverage sessions cannot surface Hire/Strong Hire from model drift.
 * @param {Record<string, unknown>|null} debrief
 * @param {import('mongoose').Document} interview
 * @param {Array<{ id?: string, status?: string }>} [coverageOverride] same map as debrief prompt (section index coverage)
 */
export function applyDebriefVerdictGuards(debrief, interview, coverageOverride) {
  if (!debrief || typeof debrief !== 'object') return debrief;

  if (debrief.debrief_kind === 'system_design_rubric') {
    const coverageMap =
      Array.isArray(coverageOverride) && coverageOverride.length
        ? coverageOverride
        : Array.isArray(interview.orchestrator_state?.debrief_section_coverage_map)
          ? interview.orchestrator_state.debrief_section_coverage_map
          : [];
    return applySystemDesignDebriefGuards(debrief, interview, coverageMap);
  }

  const os = interview.orchestrator_state || {};
  const min = typeof os.debrief_elapsed_minutes === 'number' ? os.debrief_elapsed_minutes : null;
  const timePct = typeof os.debrief_time_completion_pct === 'number' ? os.debrief_time_completion_pct : null;
  const coverageMap =
    Array.isArray(coverageOverride) && coverageOverride.length
      ? coverageOverride
      : Array.isArray(os.debrief_section_coverage_map)
        ? os.debrief_section_coverage_map
        : [];
  const hasNotReached = coverageMap.some((r) => r && r.status === 'not_reached');

  for (const row of coverageMap) {
    if (row && row.status === 'not_reached' && row.id && debrief.section_scores && debrief.section_scores[row.id]) {
      debrief.section_scores[row.id] = {
        score: null,
        status: 'not_reached',
        comment: 'Section not covered.',
      };
    }
  }

  let verdict = debrief.verdict;
  const before = verdict;
  const reason0 = typeof debrief.verdict_reason === 'string' ? debrief.verdict_reason : '';

  if (min != null && min < 5 && (verdict === 'Hire' || verdict === 'Strong Hire')) {
    verdict = 'Incomplete — Cannot Assess';
  }

  if (timePct != null && timePct < 40) {
    verdict = 'Incomplete — Cannot Assess';
  }

  if (timePct != null && timePct >= 40 && timePct < 60) {
    const attempted = coverageMap.filter((r) => r && (r.status === 'completed' || r.status === 'partial'));
    const scores = debrief.section_scores || {};
    const allFour =
      attempted.length > 0 &&
      attempted.every((r) => {
        const e = scores[r.id];
        return e && e.score === 4;
      });
    if (!allFour && (verdict === 'Hire' || verdict === 'Strong Hire')) {
      verdict = 'No Hire';
    }
  }

  if (hasNotReached && verdict === 'Strong Hire') {
    verdict = 'Hire';
  }

  if (verdict !== before) {
    debrief.verdict = verdict;
    const note =
      verdict === 'Incomplete — Cannot Assess'
        ? '[Verdict capped: duration/coverage vs planned interview.]'
        : '[Verdict adjusted for coverage and scoring rules.]';
    debrief.verdict_reason = [reason0.trim(), note].filter(Boolean).join(' ');
  }

  return debrief;
}

/**
 * Verdict caps for system design rubric debrief (non-negotiable rules from report prompt).
 * @param {Record<string, unknown>} debrief
 * @param {import('mongoose').Document} interview
 * @param {Array<{ id?: string, status?: string }>} coverageMap
 */
export function applySystemDesignDebriefGuards(debrief, interview, coverageMap) {
  const os = interview.orchestrator_state || {};
  const min = typeof os.debrief_elapsed_minutes === 'number' ? os.debrief_elapsed_minutes : null;
  const secPct =
    typeof os.debrief_section_progress_pct === 'number' ? os.debrief_section_progress_pct : null;
  const hasNotReached = coverageMap.some((r) => r && r.status === 'not_reached');
  const scoreNum = parseOverallScoreFraction(debrief);

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
    else if (secPct != null && secPct >= 80 && scoreNum >= 2.8 && scoreNum <= 3.4 && verdict === 'Strong Hire') {
      verdict = 'Hire';
    }
  }

  if (hasNotReached && verdict === 'Strong Hire') verdict = 'Hire';

  if (verdict !== before) {
    debrief.verdict = verdict;
    const note =
      verdict === 'Incomplete — Cannot Assess'
        ? '[Verdict capped: duration/coverage vs planned interview.]'
        : '[Verdict adjusted for system design rubric rules.]';
    debrief.verdict_reason = [reason0.trim(), note].filter(Boolean).join(' ');
  }

  return debrief;
}

export async function generateStructuredDebrief(interview) {
  const isSd = String(interview.interview_type || '').toLowerCase() === 'system_design';
  const plan = interview.execution_plan || {};
  if (isSd && plan.primary_question) {
    return generateSystemDesignStructuredDebrief(interview);
  }

  const pq = plan.primary_question;
  const sections = plan.sections || [];
  const sectionIds = sections.map((s) => s.id).filter(Boolean);
  const candidateLevel = deriveCandidateLevel(interview);
  const os = interview.orchestrator_state || {};

  const startedAt =
    os.session_wall_start_ms ??
    (interview.session_started_at ? new Date(interview.session_started_at).getTime() : Date.now());
  const endedAt =
    os.session_ended_at_ms != null && Number.isFinite(os.session_ended_at_ms)
      ? os.session_ended_at_ms
      : Date.now();
  const totalMinutes = ((endedAt - startedAt) / 60000).toFixed(1);
  const expectedMinutes = plan.total_minutes ?? 60;
  const completionPct = Math.round((parseFloat(totalMinutes) / expectedMinutes) * 100);
  const curIdx = os.current_section_index ?? 0;
  const sectionsAttempted = curIdx + 1;
  const totalSections = sections.length;
  const sectionCoverageMap = sections.map((s, i) => ({
    id: s.id,
    name: s.name,
    status: i < curIdx ? 'completed' : i === curIdx ? 'partial' : 'not_reached',
  }));
  const strongSig = os.candidate_knowledge_map?.strong || [];
  const weakSig = os.candidate_knowledge_map?.weak || [];
  const transcript = transcriptCompactIc(interview);
  const questionTitle = pq && typeof pq === 'object' ? pq.title : 'System design';

  const prompt = `FAANG interview debrief. Return JSON only, no preamble.

LEVEL: ${candidateLevel}
QUESTION: ${questionTitle}
INTERVIEW DURATION: ${totalMinutes} minutes (expected ${expectedMinutes} min)
COMPLETION: ${completionPct}% of planned interview
SECTIONS ATTEMPTED: ${sectionsAttempted} of ${totalSections}
SECTION COVERAGE: ${JSON.stringify(sectionCoverageMap)}
SIGNALS: strong=[${strongSig}] weak=[${weakSig}]

TRANSCRIPT:
${transcript}

SCORING RULES (non-negotiable):
- If completion < 40%: verdict MUST be "Incomplete — Cannot Assess"
- If completion 40-60%: verdict capped at "No Hire" unless every attempted section scored 4
- If sections with status "not_reached" exist: those score null, cannot be Strong Hire
- Scores must reflect transcript evidence — if candidate said little, score is low
- A 5-minute interview cannot produce Hire or Strong Hire under any circumstance
- Strengths and improvements must quote or reference specific transcript moments
  If transcript is too short to find evidence, say "insufficient data"

Return:
{
  "verdict": "Strong Hire|Hire|No Hire|Strong No Hire|Incomplete — Cannot Assess",
  "verdict_reason": "2 sentences. Must reference duration and coverage explicitly if incomplete.",
  "completion_note": "X of Y sections covered in Z minutes. [Any sections not reached].",
  "section_scores": {
    "section_id": {
      "score": 1-4 or null,
      "status": "completed|partial|not_reached",
      "comment": "1 sentence with specific transcript evidence. If not_reached: 'Section not covered.'"
    }
  },
  "strengths": [
    { "point": "...", "evidence": "direct quote or specific moment. If none: 'Insufficient data'" }
  ],
  "improvements": [
    { "point": "...", "evidence": "direct quote or specific moment." }
  ],
  "faang_bar_assessment": "3-4 sentences. Must mention what was NOT covered and why that affects assessment.",
  "next_session_focus": ["topic1", "topic2", "topic3"]
}

Score key: 1=below bar 2=approaching bar 3=meets bar 4=exceeds bar null=not assessed`;

  const raw = await invokeLLM({
    prompt,
    response_json_schema: DEBRIEF_SCHEMA,
    modelTier: 'extraction',
  });
  const normalized = normalizeStructuredDebrief(raw, sectionIds, sectionCoverageMap);
  return applyDebriefVerdictGuards(normalized, interview, sectionCoverageMap);
}

export async function extractHistorySignals(interview) {
  const prompt = `From this mock interview transcript, produce structured signals for the candidate's profile (used to personalize a future session).

Questions and answers:
${(interview.questions || [])
  .map((q, i) => `Q${i + 1}: ${q.question}\nA: ${q.answer}\nFeedback: ${q.feedback || ''}`)
  .join('\n\n')}

Return JSON with section_scores (object mapping section id to 0-1 score if inferable), topic_signals { weak, strong, never_tested }, notable_quotes (short strings), recommendation (strong_hire | hire | no_hire | neutral).`;

  return invokeLLM({
    prompt,
    response_json_schema: EXTRACTION_SCHEMA,
    modelTier: 'extraction',
  });
}

export async function generateSummaryFeedback(interview) {
  const isVideo = interview.interview_mode === 'video';
  const prompt = `Based on this mock interview for ${interview.role_title} at ${interview.company} (mode: ${interview.interview_mode}), provide:
1. A summary feedback paragraph (3-4 sentences)
2. Top 3 strengths
3. Top 3 areas for improvement
${isVideo ? 'Include observations about presence, body language and eye contact.' : ''}

Questions and scores:
${(interview.questions || [])
  .map(
    (a, i) =>
      `Q${i + 1}: ${a.question}\nScores: Quality ${a.score_answer_quality}, Clarity ${a.score_english_clarity}, Communication ${a.score_communication}${isVideo ? `, Eye Contact ${a.score_eye_contact}, Body Language ${a.score_body_language}` : ''}`
  )
  .join('\n\n')}`;

  return invokeLLM({
    prompt,
    response_json_schema: SUMMARY_SCHEMA,
  });
}

function avg(arr, key) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((s, a) => s + (a[key] || 0), 0) / arr.length);
}

/**
 * Mark interview completed, write summary + signal snapshot.
 * @param {import('mongoose').Document} interview
 */
export async function finalizeOrchestratedInterview(interview) {
  if (interview.status === 'completed') {
    return interview;
  }

  if (interview.execution_plan && interview.orchestrator_state && !interview.orchestrator_state.session_ended_at_ms) {
    recordSessionEndMetadata(interview, { source: 'finalize_fallback' });
  }

  const isVideo = interview.interview_mode === 'video';
  const qs = interview.questions || [];
  const avgQuality = avg(qs, 'score_answer_quality');
  const avgClarity = avg(qs, 'score_english_clarity');
  const avgComm = avg(qs, 'score_communication');
  const avgEye = isVideo ? avg(qs, 'score_eye_contact') : null;
  const avgBody = isVideo ? avg(qs, 'score_body_language') : null;
  const scores = [avgQuality, avgClarity, avgComm, ...(isVideo ? [avgEye, avgBody] : [])];
  const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const os = interview.orchestrator_state;
  const startedMs = interview.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : Date.now();
  const endedMs =
    os?.session_ended_at_ms != null && Number.isFinite(os.session_ended_at_ms)
      ? os.session_ended_at_ms
      : Date.now();
  const duration_seconds = Math.round(Math.max(0, endedMs - startedMs) / 1000);

  const needsDebrief = Boolean(interview.execution_plan?.primary_question);

  const [extracted, summary, debrief] = await Promise.all([
    extractHistorySignals(interview),
    generateSummaryFeedback(interview),
    needsDebrief ? generateStructuredDebrief(interview) : Promise.resolve(null),
  ]);

  await InterviewSignalSnapshot.create({
    userId: interview.userId,
    interviewClientId: interview.clientId,
    completedAt: new Date(),
    template_id: interview.template_id,
    section_scores: extracted.section_scores || {},
    topic_signals: {
      weak: extracted.topic_signals?.weak || [],
      strong: extracted.topic_signals?.strong || [],
      never_tested: extracted.topic_signals?.never_tested || [],
    },
    notable_quotes: extracted.notable_quotes || [],
    recommendation: extracted.recommendation || 'neutral',
  });

  interview.status = 'completed';
  interview.duration_seconds = duration_seconds;
  interview.overall_score = overall;
  interview.score_answer_quality = avgQuality;
  interview.score_english_clarity = avgClarity;
  interview.score_communication = avgComm;
  if (isVideo) {
    interview.score_eye_contact = avgEye;
    interview.score_body_language = avgBody;
  }
  interview.summary_feedback = summary.summary_feedback;
  interview.strengths = summary.strengths;
  interview.improvements = summary.improvements;
  if (debrief && typeof debrief === 'object') {
    interview.debrief = debrief;
  }
  await interview.save();

  return interview;
}
