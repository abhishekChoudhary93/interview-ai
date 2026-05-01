/**
 * Orchestrated template sessions are one design exercise with many scored turns;
 * the report should treat them as a single "question" for counts and charts.
 */
export function isOrchestratedSession(interview) {
  return Boolean(interview?.template_id && interview?.execution_plan);
}

/** Display count: always 1 for orchestrated; else number of legacy question rows. */
export function reportedQuestionCount(interview) {
  if (isOrchestratedSession(interview)) return 1;
  return interview?.questions?.length || 0;
}

export function reportedQuestionCountLabel(interview) {
  if (isOrchestratedSession(interview)) return '1 design session';
  const n = interview?.questions?.length || 0;
  return `${n} question${n === 1 ? '' : 's'}`;
}

function turnsArrayToMessages(turns) {
  if (!Array.isArray(turns) || !turns.length) return [];
  return turns
    .filter((t) => t && String(t.content ?? '').trim())
    .map((t) => {
      const r = String(t.role || '').toLowerCase();
      return {
        role: r === 'interviewer' ? 'interviewer' : 'candidate',
        content: String(t.content ?? '').trim(),
      };
    });
}

function messagesFromQuestions(interview) {
  const out = [];
  for (const q of interview?.questions || []) {
    if (q?.question && String(q.question).trim()) {
      out.push({ role: 'interviewer', content: String(q.question) });
    }
    if (q?.answer && String(q.answer).trim()) {
      out.push({ role: 'candidate', content: String(q.answer) });
    }
  }
  return out;
}

/**
 * Transcript bubbles: prefer server `transcript_messages` (GET /interviews/:id),
 * else conversation_turns, else Q/A pairs from questions.
 */
export function buildReportTranscriptMessages(interview) {
  const prebuilt = interview?.transcript_messages;
  if (Array.isArray(prebuilt) && prebuilt.length > 0) {
    return prebuilt
      .filter((m) => m && String(m.content ?? '').trim())
      .map((m) => {
        const r = String(m.role || '').toLowerCase();
        return {
          role: r === 'interviewer' ? 'interviewer' : 'candidate',
          content: String(m.content ?? '').trim(),
        };
      });
  }

  let messages = turnsArrayToMessages(interview?.conversation_turns);

  if (isOrchestratedSession(interview) && messages[0]?.role === 'candidate') {
    const recovered = String(interview?.questions?.[0]?.question || '').trim();
    const opening = String(interview?.orchestrator_state?.pending_question_text || '').trim();
    if (recovered) {
      messages.unshift({ role: 'interviewer', content: recovered });
    } else if (opening) {
      messages.unshift({ role: 'interviewer', content: opening });
    }
  }

  if (messages.length > 0) {
    return messages;
  }

  return messagesFromQuestions(interview);
}

/**
 * One synthetic row with chart scores = averages across turns (single bar in progression chart).
 */
export function aggregateOrchestratedQuestionsForCharts(interview) {
  const qs = interview?.questions || [];
  if (!qs.length) return [];
  const avgKey = (key) => {
    const vals = qs.map((q) => Number(q[key])).filter((x) => Number.isFinite(x));
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  const pq = interview.execution_plan?.primary_question;
  const title =
    pq && typeof pq === 'object' && pq.title
      ? `Design exercise: ${pq.title}`
      : 'System design session';
  const row = {
    question: title,
    answer: qs
      .map((q, i) => {
        const a = String(q.answer || '').trim();
        const hint = String(q.question || '').trim();
        const head = hint.length > 140 ? `${hint.slice(0, 140)}…` : hint || '(prompt)';
        return a ? `Turn ${i + 1}\nInterviewer: ${head}\n\nYou:\n${a}` : '';
      })
      .filter(Boolean)
      .join('\n\n—\n\n'),
    feedback: qs.map((q) => q.feedback).filter(Boolean).join('\n\n'),
    score_answer_quality: avgKey('score_answer_quality'),
    score_english_clarity: avgKey('score_english_clarity'),
    score_communication: avgKey('score_communication'),
    _chartLabel: 'Session',
  };
  if (interview.interview_mode === 'video') {
    row.score_eye_contact = avgKey('score_eye_contact');
    row.score_body_language = avgKey('score_body_language');
  }
  return [row];
}
