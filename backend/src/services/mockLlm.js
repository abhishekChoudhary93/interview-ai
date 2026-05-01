function mockQuestionFromPrompt(prompt) {
  const role = (prompt.match(/Role:\s*([^\n]+)/) || [])[1]?.trim() || 'this role';
  const company = (prompt.match(/Company:\s*([^\n]+)/) || [])[1]?.trim() || 'the company';
  const qMatch = prompt.match(/Question number:\s*(\d+)\s+of\s*(\d+)/);
  const n = qMatch ? qMatch[1] : '1';
  return `[Mock] Question ${n}: Describe a situation where you drove impact as ${role} at ${company}. What was the outcome?`;
}

export function mockInvokeLLM({ prompt, response_json_schema: schema }) {
  if (schema?.properties) {
    const keys = Object.keys(schema.properties);

    if (keys.includes('verdict_reason') && keys.includes('faang_bar_assessment') && keys.includes('completion_note')) {
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
      const base = {
        probe_to_fire: '',
        cross_question_seed: '',
        notable_statement: '',
        redirect_target: '',
        update_signals: { strong: [], weak: [] },
      };
      if (p.includes('stuck') || p.includes('not sure')) {
        return { ...base, action: 'GIVE_HINT', reason: 'Candidate uncertain', hint_level: 2 };
      }
      if (p.includes('requirements_factual_clarification=true')) {
        return {
          ...base,
          action: 'ANSWER_AND_CONTINUE',
          reason: 'Requirements factual clarification',
          hint_level: 0,
        };
      }
      if (p.includes('candidate_seeking_direction=true')) {
        return {
          ...base,
          action: 'REDIRECT',
          reason: 'Candidate seeking direction',
          hint_level: 0,
          redirect_target: 'upload-to-playback path',
        };
      }
      if (p.includes('clarify') || p.includes('scale') || p.includes('?')) {
        return { ...base, action: 'LET_CANDIDATE_LEAD', reason: 'Clarifying turn', hint_level: 0 };
      }
      if (p.includes('requirements') && p.includes('ic_mid')) {
        return { ...base, action: 'ANSWER_AND_CONTINUE', reason: 'Mid IC clarifying in requirements', hint_level: 0 };
      }
      return { ...base, action: 'GO_DEEPER', reason: 'Continue probing', hint_level: 0 };
    }

    if (keys.includes('time_adjustments') && keys.includes('priority_probes')) {
      return {
        time_adjustments: { requirements: 1 },
        priority_probes: { requirements: ['Clarify read vs write ratio for this design.'] },
        opening_framing:
          '[Mock] Thanks for joining. We will work a focused system design today — start by stating your assumptions on users and scale, then we will go deeper.',
        level_expectations: 'Mock: expects crisp scope before components and arrows.',
      };
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
    String(prompt || '').includes('You are Alex') ||
    String(prompt || '').includes('You are Maya') ||
    String(prompt || '').includes('Staff Engineer doing a FAANG')
  ) {
    return `[Mock interviewer] Okay. Can you go one level deeper on the trade-offs you considered?`;
  }

  return mockQuestionFromPrompt(prompt || '');
}
