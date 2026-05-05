import { invokeLLM, streamLLM } from './llmInvoke.js';
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

  const onUsage = traceCapture
    ? (usage) => {
        traceCapture.usage = usage;
      }
    : undefined;

  yield* streamLLM({
    messages,
    modelTier: 'conversational',
    temperature: 0.75,
    max_tokens: 400,
    signal,
    onUsage,
  });
}

/**
 * Deterministic fallback opening line. Used when the LLM opening call fails
 * (no API key, upstream outage, parser failure). Mirrors the historical T0
 * format so unit tests and offline dev sessions still work.
 */
function deterministicOpening(config) {
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
  const handoff = buildProblemHandoff(config);
  return `Hi, I'm ${interviewer.name}${titleClause}${companyClause}. ${minutesClause} — ${handoff}`.trim();
}

/**
 * Build the system prompt for the opening LLM call. Carries persona, the
 * curated problem brief as DATA, and tight output constraints so the model
 * produces ONE warm message (intro + problem + invitation) — not two scripted
 * messages back-to-back.
 */
function buildOpeningSystemPrompt(config) {
  const interviewer = config?.interviewer || {
    name: 'Alex',
    title: 'Staff Software Engineer',
    company: 'a top-tier tech company',
    style_note: '',
  };
  const totalMin = Number(config?.total_minutes) ||
    (Array.isArray(config?.sections)
      ? config.sections.reduce((acc, s) => acc + (Number(s.budget_minutes) || 0), 0)
      : 0);
  const handoff = buildProblemHandoff(config);
  const styleClause = interviewer.style_note
    ? `Style: ${interviewer.style_note}.`
    : '';
  const minutesClause = totalMin > 0 ? `${totalMin} minutes` : 'about an hour';

  return [
    `You are ${interviewer.name}, ${interviewer.title} at ${interviewer.company}. You are a real human engineer running a system-design loop.`,
    `${styleClause}`,
    '',
    'You are about to greet the candidate and hand them the problem in ONE message. This is the very first thing they hear from you — make it feel like a person, not a script.',
    '',
    'Output rules (hard):',
    `  - 2-3 sentences total. Conversational, warm, prose only. NO bullets, NO bold, NO markdown headers.`,
    `  - Open with a brief intro: your first name, role, company, and that the format is ${minutesClause} of conversational system design.`,
    `  - Then deliver the problem statement. You may paraphrase lightly for rhythm, but every concrete fact and constraint from the brief below must survive verbatim — title, the "long URL → short slug → redirect" mechanic, and the "take it from there" handoff.`,
    `  - End by inviting them to begin (their cue to start).`,
    `  - NO praise, NO "great to meet you", NO "feel free to ask anything", NO emotes (*nods*), NO meta-commentary.`,
    `  - Do NOT preview later sections, do NOT mention rubrics, do NOT list scope items.`,
    '',
    'Problem brief (DATA — render its content; do not quote this label):',
    '<<<',
    handoff,
    '>>>',
    '',
    'Reply with the message and nothing else.',
  ].join('\n');
}

/**
 * Generate the conversational opening line (T0). LLM-backed: persona +
 * problem statement combined into a single warm message. Falls back to a
 * deterministic synthesis if the LLM call fails so the session can still
 * start in offline / test environments.
 *
 * Replaces the previous two-message handoff (deterministic intro on T0 +
 * verbatim problem on T2 via the OPENING PROTOCOL block). One LLM call,
 * one warm message, then natural Planner-first flow from T1 onward.
 */
export async function generateOpeningLine({ interview: _interview, config }) {
  const fallback = deterministicOpening(config);
  try {
    const system = buildOpeningSystemPrompt(config);
    const text = await invokeLLM({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Greet the candidate and hand them the problem now.' },
      ],
      modelTier: 'opening',
      temperature: 0.7,
      max_tokens: 220,
    });
    const trimmed = String(text || '').trim();
    if (!trimmed) return fallback;
    return trimmed;
  } catch (err) {
    console.warn('[opening] LLM opening generation failed; using deterministic fallback:', err?.message || err);
    return fallback;
  }
}

/**
 * Fire-and-forget LLM cache warmup against the Executor system prefix.
 *
 * DeepSeek-V3 implements native context caching keyed on the longest stable
 * prefix; an idle warmup call right after session start primes that cache so
 * the candidate's first real turn (T1) hits a warm prefix and feels
 * noticeably snappier. Does NOT throw — any error is swallowed so a missing
 * API key or upstream blip never breaks /session/start.
 *
 * Crucially, this uses the same `buildSystemPrompt` the streaming path uses,
 * with an empty session_state so the (turn-varying) Directive block ends
 * with the literal "(no directive — opening turn)" placeholder. That makes
 * the prefix byte-stable across the warmup → first real turn boundary.
 */
export function warmExecutorPrefix({ config, interview }) {
  return Promise.resolve().then(async () => {
    try {
      const system = buildSystemPrompt({
        config,
        interview,
        sessionState: { opening_phase: 'awaiting_ack', next_directive: null },
      });
      // We don't care about the output — we just want OpenRouter to register
      // the system prefix in DeepSeek's cache. Tiny max_tokens keeps the
      // warmup cost trivial (~$0.001 per session).
      await invokeLLM({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: '.' },
        ],
        modelTier: 'conversational',
        temperature: 0,
        max_tokens: 4,
      });
    } catch (err) {
      console.warn('[warmup] executor prefix warmup failed (non-fatal):', err?.message || err);
    }
  });
}
