import { getMockSeedInterviews } from './mockInterviewSeed';

const interviews = new Map();

function ensureSeedInterviews() {
  for (const row of getMockSeedInterviews()) {
    if (!interviews.has(row.id)) {
      interviews.set(row.id, { ...row });
    }
  }
}

ensureSeedInterviews();

function nowIso() {
  return new Date().toISOString();
}

function mockQuestionFromPrompt(prompt) {
  const role = (prompt.match(/Role:\s*([^\n]+)/) || [])[1]?.trim() || 'this role';
  const company = (prompt.match(/Company:\s*([^\n]+)/) || [])[1]?.trim() || 'the company';
  const qMatch = prompt.match(/Question number:\s*(\d+)\s+of\s+(\d+)/);
  const n = qMatch ? qMatch[1] : '1';
  return `[Mock] Question ${n}: Describe a situation where you drove impact as ${role} at ${company}. What was the outcome?`;
}

function mockInvokeLLM({ prompt, response_json_schema: schema }) {
  if (schema?.properties) {
    const keys = Object.keys(schema.properties);
    if (keys.includes('summary_feedback')) {
      return Promise.resolve({
        summary_feedback:
          'Solid practice session. You structured answers clearly and used relevant examples. Continue deepening technical specifics for senior-level expectations.',
        strengths: ['Clear communication', 'Relevant examples', 'Professional tone'],
        improvements: ['Add more quantified results', 'Tighten STAR "action" detail', 'Prepare 2 follow-up stories'],
      });
    }
    if (keys.includes('answer_quality')) {
      const hasVideo = keys.includes('eye_contact');
      return Promise.resolve({
        answer_quality: 78,
        english_clarity: 82,
        communication: 75,
        ...(hasVideo ? { eye_contact: 70, body_language: 72 } : {}),
        feedback:
          'Good structure and relevance. Strengthen with one more concrete metric and a clearer summary of your role in the outcome.',
      });
    }
  }
  return Promise.resolve(mockQuestionFromPrompt(prompt || ''));
}

const Interview = {
  create(payload) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-${Date.now()}`;
    const row = {
      ...payload,
      id,
      created_date: nowIso(),
      interview_mode: payload.interview_mode ?? 'chat',
      questions: payload.questions ?? [],
    };
    interviews.set(id, row);
    return Promise.resolve({ ...row });
  },
  get(id) {
    const row = interviews.get(id);
    if (!row) return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
    return Promise.resolve({ ...row });
  },
  update(id, patch) {
    const prev = interviews.get(id);
    if (!prev) return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
    const next = { ...prev, ...patch };
    interviews.set(id, next);
    return Promise.resolve({ ...next });
  },
  delete(id) {
    interviews.delete(id);
    return Promise.resolve();
  },
  filter(criteria, _sort, limit = 50) {
    let list = [...interviews.values()];
    if (criteria && typeof criteria === 'object') {
      list = list.filter((row) =>
        Object.entries(criteria).every(([k, v]) => row[k] === v)
      );
    }
    list.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    if (typeof limit === 'number' && limit > 0) list = list.slice(0, limit);
    return Promise.resolve(list.map((r) => ({ ...r })));
  },
};

export const mockBase44Client = {
  auth: {
    me: () =>
      Promise.resolve({
        full_name: 'Local Tester',
        role: 'user',
        email: 'local@example.test',
      }),
    logout: () => {},
    redirectToLogin: () => {
      console.info('[mock Base44] redirectToLogin skipped');
    },
  },
  entities: {
    Interview,
  },
  integrations: {
    Core: {
      InvokeLLM: mockInvokeLLM,
    },
  },
};
