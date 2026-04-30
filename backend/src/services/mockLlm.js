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
  return mockQuestionFromPrompt(prompt || '');
}
