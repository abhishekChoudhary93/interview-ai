function mockQuestionFromPrompt(prompt) {
  const role = (prompt.match(/Role:\s*([^\n]+)/) || [])[1]?.trim() || 'this role';
  const company = (prompt.match(/Company:\s*([^\n]+)/) || [])[1]?.trim() || 'the company';
  const qMatch = prompt.match(/Question number:\s*(\d+)\s+of\s+(\d+)/);
  const n = qMatch ? qMatch[1] : '1';
  return `[Mock] Question ${n}: Describe a situation where you drove impact as ${role} at ${company}. What was the outcome?`;
}

export function mockInvokeLLM({ prompt, response_json_schema: schema }) {
  if (schema?.properties) {
    const keys = Object.keys(schema.properties);

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

    if (keys.includes('action') && keys.includes('hint_level')) {
      const p = String(prompt || '').toLowerCase();
      if (p.includes('stuck') || p.includes('not sure')) {
        return { action: 'GIVE_HINT', reason: 'Candidate uncertain', hint_level: 2 };
      }
      return { action: 'GO_DEEPER', reason: 'Continue probing', hint_level: 1 };
    }

    if (keys.includes('opening_question')) {
      return {
        topic_priority_adjustments: { system_design: { lead_with: 'databases' } },
        depth_allocation: { databases: 'max_depth' },
        pre_loaded_probes: [
          {
            trigger: 'cache',
            probe: 'Ask specifically about cache invalidation strategies and TTL tradeoffs.',
            section_id: 'system_design',
          },
        ],
        cross_question_seeds: ['Earlier Redis comment — revisit under consistency.'],
        skip_list: [],
        opening_question: {
          chosen:
            '[Mock] Start by walking me through how you would design a rate limiter for a public API handling bursty traffic.',
          reason: 'Hits scalability and consistency themes early.',
        },
      };
    }

    if (keys.includes('summary_feedback')) {
      return {
        summary_feedback:
          'Solid practice session. You structured answers clearly and used relevant examples. Continue deepening technical specifics for senior-level expectations.',
        strengths: ['Clear communication', 'Relevant examples', 'Professional tone'],
        improvements: ['Add more quantified results', 'Tighten STAR "action" detail', 'Prepare 2 follow-up stories'],
      };
    }
    if (keys.includes('answer_quality')) {
      const hasVideo = keys.includes('eye_contact');
      return {
        answer_quality: 78,
        english_clarity: 82,
        communication: 75,
        ...(hasVideo ? { eye_contact: 70, body_language: 72 } : {}),
        feedback:
          'Good structure and relevance. Strengthen with one more concrete metric and a clearer summary of your role in the outcome.',
      };
    }
  }

  if (
    String(prompt || '').includes('You are Maya') ||
    String(prompt || '').includes('senior engineering interviewer')
  ) {
    return `[Mock interviewer] Thanks for sharing that. Can you go one level deeper on the trade-offs you considered?`;
  }

  return mockQuestionFromPrompt(prompt || '');
}
