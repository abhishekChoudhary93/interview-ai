/**
 * Dev-only fallback LLM. Used when OPENROUTER_API_KEY is unset or upstream is
 * failing in a local environment. The shapes here mirror what the real
 * services request via `response_json_schema` so end-to-end flows don't crash
 * during development without an API key.
 */

function lastUserContent(input) {
  if (Array.isArray(input?.messages) && input.messages.length > 0) {
    for (let i = input.messages.length - 1; i >= 0; i -= 1) {
      const m = input.messages[i];
      if (m?.role === 'user' && typeof m.content === 'string') return m.content;
    }
  }
  return String(input?.prompt || '');
}

function joinedSystemContent(input) {
  if (!Array.isArray(input?.messages)) return '';
  return input.messages
    .filter((m) => m?.role === 'system' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n');
}

export function mockInvokeLLM(input) {
  const schema = input?.response_json_schema;
  if (schema?.properties) {
    const keys = Object.keys(schema.properties);

    /** Final structured debrief. */
    if (keys.includes('verdict_reason') && keys.includes('faang_bar_assessment')) {
      return {
        verdict: 'Hire',
        verdict_reason:
          'Mock debrief: coherent thread and reasonable clarifying questions. Push further on failure modes and concrete numbers next time.',
        completion_note: 'Mock: 5 of 5 sections touched in ~45 minutes (simulated coverage).',
        section_scores: {
          requirements: { score: 3, status: 'completed', comment: 'Mock: bounded scope before designing.' },
          high_level_design: { score: 3, status: 'completed', comment: 'Mock: separated upload vs playback paths.' },
          deep_dive: { score: 2, status: 'partial', comment: 'Mock: thin on encoding edge cases.' },
          tradeoffs: { score: 3, status: 'completed', comment: 'Mock: articulated cost vs latency.' },
          operations: { score: 2, status: 'completed', comment: 'Mock: limited monitoring depth.' },
        },
        strengths: [
          { point: 'Problem framing', evidence: 'I would clarify scale first.' },
          { point: 'Component thinking', evidence: 'Separate upload path from playback.' },
          { point: 'Trade-off awareness', evidence: 'We could optimize for cost or latency.' },
        ],
        improvements: [
          { point: 'Failure modes', evidence: '(thin coverage in mock transcript)' },
          { point: 'Quantitative estimates', evidence: '(few concrete numbers)' },
          { point: 'Operational detail', evidence: '(limited monitoring discussion)' },
        ],
        faang_bar_assessment:
          'Mock FAANG read: bar cleared on communication and high-level structure; more depth on encoding/CDN and reliability would align with staff expectations.',
        next_session_focus: [
          'Back-of-the-envelope sizing',
          'CDN and edge failure modes',
          'Encoding pipeline resilience',
        ],
      };
    }

    /** Cross-session history extraction. */
    if (keys.includes('section_scores') && keys.includes('recommendation')) {
      return {
        section_scores: { fundamentals: 0.72, system_design: 0.65 },
        topic_signals: {
          weak: ['distributed consensus', 'cache invalidation'],
          strong: ['REST APIs', 'task prioritization'],
          never_tested: ['message queues'],
        },
        notable_quotes: ['Candidate emphasized Redis for caching broadly.'],
        recommendation: 'neutral',
      };
    }

    /** Per-turn eval capture (interviewEvalCapture). */
    if (keys.includes('section_progress') && keys.includes('rubric_updates')) {
      return {
        section_progress: 'stay',
        rubric_updates: [],
        signals: { strong: ['communication clarity'], weak: [] },
        notes: 'Mock eval capture — keep going on the current micro-topic.',
        candidate_done: false,
      };
    }

    /** Generic legacy summary feedback. */
    if (keys.includes('summary_feedback')) {
      return {
        summary_feedback:
          'Solid practice session. You structured answers clearly and used relevant examples. Continue deepening technical specifics for senior-level expectations.',
        strengths: ['Clear communication', 'Relevant examples', 'Professional tone'],
        improvements: ['Add more quantified results', 'Tighten action detail', 'Prepare follow-up examples'],
      };
    }
  }

  // Plain-text path. Mostly used for opening framing or one-shot prompts.
  const sys = joinedSystemContent(input);
  if (sys.includes('You are')) {
    return '[Mock interviewer] Walk me through how you would frame the scope before sketching components.';
  }
  return `[Mock] ${lastUserContent(input).slice(0, 200)}`;
}

/**
 * Streaming mock — yields a few canned chunks for the conversational path so
 * dev without an API key still produces a believable typing animation.
 */
export async function* mockStreamLLM(input) {
  const sys = joinedSystemContent(input);
  const isExecutorSystemPrompt = sys.includes('What You Are') || sys.includes('Persona');
  const prefix = isExecutorSystemPrompt ? '[Mock interviewer] ' : '[Mock] ';
  const reply =
    'Got it — let me push on that. Could you walk me through the read/write ratio you are assuming, and how that shapes your storage choice?';
  const chunks = [prefix, ...reply.split(/(\s+)/)];
  for (const c of chunks) {
    if (!c) continue;
    yield c;
    await new Promise((r) => setTimeout(r, 18));
  }
}
