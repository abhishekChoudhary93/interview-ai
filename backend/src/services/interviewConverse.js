import { streamLLM } from './llmInvoke.js';
import { buildSystemPrompt } from './interviewSystemPrompt.js';
import { buildProblemHandoff } from './interviewConfig.js';

// Re-export so existing call sites (and tests) that import from this module
// keep working. The canonical home is now interviewConfig.js.
export { buildProblemHandoff };

function turnToMessage(turn) {
  if (!turn || typeof turn !== 'object') return null;
  if (turn.kind === 'system_internal') return null;
  const content = String(turn.content || '').trim();
  if (!content) return null;
  const role = String(turn.role || '').toLowerCase() === 'interviewer' ? 'assistant' : 'user';
  return { role, content };
}

function windowedHistory(turns, maxMessages = 60) {
  if (!Array.isArray(turns) || turns.length <= maxMessages) {
    return Array.isArray(turns) ? turns : [];
  }
  return turns.slice(turns.length - maxMessages);
}

/**
 * Stream the next interviewer reply token-by-token. Pure pass-through to
 * the Executor LLM — every turn (including opening and LET_LEAD acks) is
 * rendered by the LLM, with the system prompt carrying all the routing
 * logic (opening protocol, directive rendering, move guidance).
 *
 * @param {object} args
 * @param {object} args.interview persisted Interview document (or plain object)
 * @param {object} args.config the loaded interview_config JSON
 * @param {string} args.candidateMessage the message the candidate just sent
 * @param {AbortSignal} [args.signal]
 * @param {object} [args.traceCapture] receives executor trace when INTERVIEW_DEBUG_TRACE=1
 * @returns {AsyncIterable<string>}
 */
export async function* streamInterviewerReply({
  interview,
  config,
  candidateMessage,
  signal,
  traceCapture,
}) {
  const sessionState = interview?.session_state || {};
  const system = buildSystemPrompt({ config, interview, sessionState });

  const priorTurns = Array.isArray(interview?.conversation_turns) ? interview.conversation_turns : [];
  const windowed = windowedHistory(priorTurns);
  const historyMessages = windowed.map(turnToMessage).filter(Boolean);

  const trimmedCandidate = String(candidateMessage || '').trim();
  const messages = [
    { role: 'system', content: system },
    ...historyMessages,
    { role: 'user', content: trimmedCandidate },
  ];

  const debugOn = process.env.INTERVIEW_DEBUG_TRACE === '1';
  if (debugOn && traceCapture) {
    traceCapture.model = 'conversational';
    traceCapture.system_prompt = system;
    traceCapture.history_messages = historyMessages;
    traceCapture.candidate_message = trimmedCandidate;
    traceCapture.started_at = Date.now();
  }

  yield* streamLLM({
    messages,
    modelTier: 'conversational',
    temperature: 0.75,
    max_tokens: 400,
    signal,
  });
}

/**
 * Deterministic conversational opening line (T0). No problem statement, no
 * LLM call — just an in-persona intro and an invitation to begin. The
 * problem statement itself is delivered by the Executor LLM on T2 via the
 * OPENING PROTOCOL section of the system prompt.
 */
export async function generateOpeningLine({ interview: _interview, config }) {
  const interviewer = config?.interviewer || {
    name: 'Alex',
    title: 'Staff Software Engineer',
    company: 'a top-tier tech company',
  };
  const totalMin = Number(config?.total_minutes) ||
    (Array.isArray(config?.sections)
      ? config.sections.reduce((acc, s) => acc + (Number(s.budget_minutes) || 0), 0)
      : 0);
  const minutesClause = totalMin > 0
    ? `We've got ${totalMin} minutes today`
    : `We've got some time today`;
  const titleClause = interviewer.title ? `, ${interviewer.title}` : '';
  const companyClause = interviewer.company ? ` at ${interviewer.company}` : '';
  return `Hi, I'm ${interviewer.name}${titleClause}${companyClause}. ${minutesClause} and the format is conversational — I'll throw a design problem your way and you'll talk me through it. Expect me to push on tradeoffs and pull on threads. Ready to dive in?`;
}
