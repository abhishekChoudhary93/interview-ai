import { InterviewSignalSnapshot } from '../models/InterviewSignalSnapshot.js';
import { invokeLLM } from './llmInvoke.js';

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
  const isVideo = interview.interview_mode === 'video';
  const qs = interview.questions || [];
  const avgQuality = avg(qs, 'score_answer_quality');
  const avgClarity = avg(qs, 'score_english_clarity');
  const avgComm = avg(qs, 'score_communication');
  const avgEye = isVideo ? avg(qs, 'score_eye_contact') : null;
  const avgBody = isVideo ? avg(qs, 'score_body_language') : null;
  const scores = [avgQuality, avgClarity, avgComm, ...(isVideo ? [avgEye, avgBody] : [])];
  const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const started = interview.session_started_at
    ? new Date(interview.session_started_at).getTime()
    : Date.now();
  const duration_seconds = Math.round((Date.now() - started) / 1000);

  const [extracted, summary] = await Promise.all([
    extractHistorySignals(interview),
    generateSummaryFeedback(interview),
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
  await interview.save();

  return interview;
}
