/** Rich demo rows — same data as former frontend mockInterviewSeed.js */

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeQuestions(baseQuality, variance = 6) {
  const templates = [
    {
      q: 'Tell me about a time you had to influence stakeholders without direct authority.',
      a: 'I aligned three teams on a launch date by running a weekly sync, documenting decisions, and escalating blockers early. We shipped on time and adoption exceeded targets by 18%.',
    },
    {
      q: 'How do you prioritize when everything feels urgent?',
      a: 'I use impact vs. effort, clarify deadlines with PMs, and communicate trade-offs. Last quarter I cut scope on one initiative so we could fix a revenue-impacting bug first.',
    },
    {
      q: 'Describe a failure and what you learned.',
      a: 'I underestimated integration risk on a vendor API. I now bake spike time into estimates and run a go/no-go checklist before commitments.',
    },
    {
      q: 'What metrics do you use to know your team is healthy?',
      a: 'Delivery predictability, incident rate, and qualitative 1:1 signals. I pair metrics with team surveys so we do not optimize the wrong thing.',
    },
    {
      q: 'Why this role, and why now?',
      a: 'I want to own a larger slice of the product surface and mentor junior engineers. This team’s customer focus matches how I like to work.',
    },
  ];
  return templates.map((t, i) => {
    const drift = (i % 3) * 3 - variance;
    const aq = Math.min(95, Math.max(55, baseQuality + drift + (i % 2) * 4));
    const ec = Math.min(95, Math.max(55, aq - 2 + (i % 2)));
    const cm = Math.min(95, Math.max(55, aq - 4));
    return {
      question: t.q,
      answer: t.a,
      score_answer_quality: aq,
      score_english_clarity: ec,
      score_communication: cm,
      feedback:
        i % 2 === 0
          ? "Strong example with measurable outcome. Tighten the 'situation' setup in one sentence."
          : 'Clear structure. Add one more specific detail about your personal contribution.',
    };
  });
}

export function getMockSeedInterviews() {
  const id1 = 'mock-seed-staff-swe';
  const id2 = 'mock-seed-swe';
  const id3 = 'mock-seed-video';

  const q1 = makeQuestions(82);
  const q2 = makeQuestions(71, 8);
  const q3 = makeQuestions(76, 5).map((row, i) =>
    i === 0
      ? {
          ...row,
          score_eye_contact: 72,
          score_body_language: 74,
        }
      : {
          ...row,
          score_eye_contact: 68 + (i % 3) * 4,
          score_body_language: 70 + (i % 2) * 5,
        }
  );

  const avgChat = (questions) => ({
    score_answer_quality: Math.round(questions.reduce((s, q) => s + q.score_answer_quality, 0) / questions.length),
    score_english_clarity: Math.round(questions.reduce((s, q) => s + q.score_english_clarity, 0) / questions.length),
    score_communication: Math.round(questions.reduce((s, q) => s + q.score_communication, 0) / questions.length),
  });

  const videoDims = (questions) => {
    const eye = Math.round(questions.reduce((s, q) => s + (q.score_eye_contact || 0), 0) / questions.length);
    const body = Math.round(questions.reduce((s, q) => s + (q.score_body_language || 0), 0) / questions.length);
    return { score_eye_contact: eye, score_body_language: body };
  };

  const scores1 = avgChat(q1);
  const overall1 = Math.round(
    (scores1.score_answer_quality + scores1.score_english_clarity + scores1.score_communication) / 3
  );

  const scores2 = avgChat(q2);
  const overall2 = Math.round(
    (scores2.score_answer_quality + scores2.score_english_clarity + scores2.score_communication) / 3
  );

  const scores3 = avgChat(q3);
  const v3 = videoDims(q3);
  const overall3 = Math.round(
    (scores3.score_answer_quality +
      scores3.score_english_clarity +
      scores3.score_communication +
      v3.score_eye_contact +
      v3.score_body_language) /
      5
  );

  return [
    {
      id: id1,
      status: 'completed',
      created_date: daysAgoIso(2),
      role_title: 'Staff Software Engineer',
      role_track: 'ic',
      company: 'Northwind Labs',
      experience_level: 'senior',
      years_experience_band: '8_12',
      interview_type: 'behavioral',
      industry: 'Technology',
      interview_mode: 'chat',
      duration_seconds: 840,
      questions: q1,
      overall_score: overall1,
      ...scores1,
      summary_feedback:
        'Strong behavioral signals with measurable outcomes. A few answers could open with a sharper headline before the STAR detail.',
      strengths: ['Clear ownership narrative', 'Good use of metrics', 'Calm, structured delivery'],
      improvements: [
        'Lead with the punchline once in a while',
        'Name one trade-off you rejected',
        'Practice a 60-second version of your flagship story',
      ],
    },
    {
      id: id2,
      status: 'completed',
      created_date: daysAgoIso(9),
      role_title: 'Software Engineer',
      role_track: 'ic',
      company: 'Aperture Systems',
      experience_level: 'mid',
      years_experience_band: '2_5',
      interview_type: 'mixed',
      industry: 'Cloud / Infra',
      interview_mode: 'chat',
      duration_seconds: 612,
      questions: q2,
      overall_score: overall2,
      ...scores2,
      summary_feedback:
        'Solid technical instincts and honest reflection on mistakes. Push examples further into system-design specifics when discussing scale.',
      strengths: ['Practical prioritization', 'Ownership of failures', 'Team health thinking'],
      improvements: ['Add latency/scale numbers', 'Clarify your decision criteria', 'Shorten setup, lengthen impact'],
    },
    {
      id: id3,
      status: 'completed',
      created_date: daysAgoIso(1),
      role_title: 'Engineering Manager',
      role_track: 'sdm',
      company: 'Contoso Health',
      experience_level: 'lead',
      years_experience_band: '12_plus',
      interview_type: 'mixed',
      industry: 'Healthcare',
      interview_mode: 'video',
      duration_seconds: 905,
      questions: q3,
      overall_score: overall3,
      ...scores3,
      ...v3,
      summary_feedback:
        'Strong leadership examples and good on-camera presence. Tie coaching examples to business outcomes more explicitly.',
      strengths: ['Coaching examples', 'Presence on camera', 'Cross-functional alignment'],
      improvements: ['Quantify org outcomes', 'One more peer-conflict example', 'Tighter closing statements'],
    },
  ];
}
