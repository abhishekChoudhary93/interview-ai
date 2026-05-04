/**
 * Demo rows for the seeded "Demo User" account.
 *
 * Two shapes coexist:
 *   - LEGACY: 5-question loop with per-question chat scores (q1, q2, q3 below).
 *     Renders through Report.jsx's legacy code path.
 *   - NEW (orchestrated): one design session with conversation_turns,
 *     session_state.signals, debrief.section_scores, etc. Renders through
 *     the new rubric-signal-per-section view.
 *
 * Keeping both lets us showcase what old rows still look like alongside what
 * new sessions produce.
 */

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
    buildOrchestratedSeed(),
  ];
}

/**
 * Hand-rolled new-shape (orchestrated) demo session: a completed system-design
 * interview on a URL shortener, with conversation_turns, session_state.signals,
 * and a structured debrief that exercises every section of the new Report.jsx.
 */
function buildOrchestratedSeed() {
  const turns = [
    {
      role: 'interviewer',
      content:
        "Hi — I'm Alex, staff engineer at a developer-tools company. We've got about 50 minutes. I'd like you to design a URL shortener like bit.ly. Before we start sketching, what would you like to clarify?",
      kind: 'opening',
    },
    {
      role: 'candidate',
      content:
        "Quick clarifications: (1) custom slugs in scope? (2) what's the read/write ratio I should design for? (3) is per-link analytics in scope, or just redirects?",
      kind: 'answer',
    },
    {
      role: 'interviewer',
      content:
        'Good questions. Custom slugs are in scope — first-write-wins on collision. Reads dominate at roughly 100:1. Aggregate per-link click counts are in scope; per-user analytics are out of scope. Anything else, or do you want to start sketching?',
      kind: 'reply',
    },
    {
      role: 'candidate',
      content:
        "I'll size it: ~5k writes/sec at peak and ~500k redirects/sec globally. p99 redirect latency budget — let's say 80ms. I'll separate the write API from the redirect tier. Write API hits an id allocator and a metadata KV store; redirect tier reads from an edge cache with origin shield to a sharded KV. Analytics goes through an async pipeline.",
      kind: 'answer',
    },
    {
      role: 'interviewer',
      content:
        "Good — you split read and write paths cleanly. Walk me through your id allocation under 5k writes/sec. What happens if two writers want the same custom slug at the same instant?",
      kind: 'reply',
    },
    {
      role: 'candidate',
      content:
        "Sharded id allocator: each writer node gets a pre-allocated range of, say, 100k integers from a coordinator (Zookeeper or a single-shard counter). Within its range it increments locally. The integer is base62-encoded into a 7-char slug — that gives ~3.5T address space, plenty of headroom. For custom slugs we go through a separate code path: a single KV write with a conditional put on the slug key. First write wins; the second sees the conditional failure and we return 409.",
      kind: 'answer',
    },
    {
      role: 'interviewer',
      content:
        "Solid. Now the redirect path — a brand-new link goes viral and takes 90% of traffic for an hour. What does your cache do?",
      kind: 'reply',
    },
    {
      role: 'candidate',
      content:
        "Edge cache (Cloudfront or similar) with TTL of, say, 1 hour. The first viral hit cache-misses and falls through to an origin shield — a regional cache that absorbs the stampede so only one request reaches the metadata store. The shield uses request coalescing: if 10k concurrent requests for the same key arrive while one is in flight, they all wait on the same upstream call. After that it's served from the edge.",
      kind: 'answer',
    },
    {
      role: 'interviewer',
      content:
        "Good — you named request coalescing without prompting. What's the trade-off you accepted by pre-allocating id ranges instead of strictly monotonic ids?",
      kind: 'reply',
    },
    {
      role: 'candidate',
      content:
        "Strict monotonic would let us order links globally and reason about creation time directly from the slug. Pre-allocated ranges give up that ordering and create gaps when a writer dies mid-range, but in exchange we eliminate the global write bottleneck. For a URL shortener, ordering by slug isn't a product requirement, so the trade is worth it.",
      kind: 'answer',
    },
    {
      role: 'interviewer',
      content:
        "Last topic: how do you stop someone using your service to generate billions of phishing links overnight?",
      kind: 'reply',
    },
    {
      role: 'candidate',
      content:
        "Per-account write rate limits at the API gateway, with much tighter limits for unauthenticated users. Async URL classification — a worker pulls new submissions and runs them through a reputation service; flagged links get soft-deleted (redirects return a warning interstitial). Anomaly detection on creation patterns (one account creating 10k slugs/hour) triggers a takedown queue.",
      kind: 'answer',
    },
    {
      role: 'interviewer',
      content:
        "Great session. I'd hire — strong on the read/write split, request coalescing, and explicit trade-off articulation. Wrapping up; you'll see your scored report in a moment.",
      kind: 'reply',
    },
  ];

  const sectionScores = {
    requirements: {
      weighted_score: '4.0/4.0',
      status: 'completed',
      signals: [
        {
          signal: 'Asks about read/write ratio early',
          score: 4,
          evidence: "what's the read/write ratio I should design for?",
          what_it_means: 'Sets the dominant SLO before designing.',
        },
        {
          signal: 'Identifies p99 redirect latency target',
          score: 4,
          evidence: 'p99 redirect latency budget — 80ms.',
          what_it_means: 'Names the SLO that drives the architecture.',
        },
      ],
    },
    high_level_design: {
      weighted_score: '4.0/4.0',
      status: 'completed',
      signals: [
        {
          signal: 'Separates write API from redirect read tier',
          score: 4,
          evidence: 'Write API hits an id allocator and a metadata KV store; redirect tier reads from an edge cache.',
          what_it_means: 'Decouples the dominant read path from writes — exactly the staff-level move.',
        },
      ],
    },
    deep_dive: {
      weighted_score: '4.0/4.0',
      status: 'completed',
      signals: [
        {
          signal: 'Sharded id allocator with rationale',
          score: 4,
          evidence: 'Each writer node gets a pre-allocated range of 100k integers from a coordinator.',
          what_it_means: 'Eliminates the global write bottleneck with a concrete allocation scheme.',
        },
        {
          signal: 'Cache stampede protection on viral links',
          score: 4,
          evidence: 'Origin shield with request coalescing.',
          what_it_means: 'Names the exact pattern unprompted; this is what the question was probing.',
        },
      ],
    },
    tradeoffs: {
      weighted_score: '3.5/4.0',
      status: 'completed',
      signals: [
        {
          signal: 'Acknowledges what they gave up',
          score: 4,
          evidence: 'Pre-allocated ranges create gaps when a writer dies mid-range, but in exchange we eliminate the global write bottleneck.',
          what_it_means: 'Trade-off articulated both ways, not defensive.',
        },
        {
          signal: 'Could discuss cost vs latency tier choices more explicitly',
          score: 3,
          evidence: '',
          what_it_means: 'Strong on engineering trade-offs; lighter on cost-driven design alternatives.',
        },
      ],
    },
    operations: {
      weighted_score: '3.0/4.0',
      status: 'partial',
      signals: [
        {
          signal: 'Has an abuse-detection + takedown story',
          score: 4,
          evidence: 'Async URL classification — a worker pulls new submissions and runs them through a reputation service.',
          what_it_means: 'Concrete pipeline, not hand-waved.',
        },
        {
          signal: 'Did not name p99 latency dashboards or per-region alerting',
          score: 2,
          evidence: '',
          what_it_means: 'Operations was abbreviated by time; would benefit from monitoring specifics.',
        },
      ],
    },
  };

  const debrief = {
    debrief_kind: 'system_design_rubric',
    verdict: 'Strong Hire',
    overall_score: '3.7/4.0',
    verdict_reason:
      'Strong technical depth across requirements, architecture, and the deep dive. Volunteered request coalescing for the viral-link stampede without prompting and articulated trade-offs both ways.',
    completion_note: '5 of 5 sections covered in 14.8 min (operations slightly abbreviated).',
    section_scores: sectionScores,
    top_moments: [
      {
        type: 'strength',
        moment: 'Named request coalescing on the origin shield without being prompted.',
        why_it_matters:
          'This is the specific failure mode the question was probing — most candidates need a hint to get there.',
      },
      {
        type: 'strength',
        moment: 'Articulated the pre-allocated id range trade-off in both directions.',
        why_it_matters: 'Trade-off thinking that distinguishes senior from staff.',
      },
      {
        type: 'gap',
        moment: 'Operations section was abbreviated — no concrete dashboards or per-region alerting story.',
        why_it_matters: 'Production-readiness signals are part of a staff-level bar.',
      },
    ],
    strengths: [
      {
        point: 'Clean read/write path decoupling',
        evidence: "Write API hits an id allocator and a metadata KV store; redirect tier reads from an edge cache.",
      },
      {
        point: 'Stampede protection',
        evidence: 'Origin shield with request coalescing for viral links.',
      },
      {
        point: 'Trade-off articulation',
        evidence: 'Pre-allocated ranges create gaps but eliminate the global write bottleneck.',
      },
    ],
    improvements: [
      {
        point: 'Operations / monitoring depth',
        evidence: 'Did not name p99 dashboards, per-region alerting, or rollout strategy.',
      },
      {
        point: 'Cost vs latency framing',
        evidence: 'Trade-offs were engineering-first; cost as a primary axis was lighter.',
      },
    ],
    faang_bar_assessment:
      'Comfortably at the staff IC bar for a developer-tools company. Strong on the dominant read path, id generation, and trade-offs. To reach principal: deeper coverage of operations (dashboards, rollback, multi-region failover) and an explicit cost model.',
    next_session_focus: [
      { area: 'Operational excellence', reason: 'Practice covering monitoring and rollback in <5 min.' },
      { area: 'Cost modeling', reason: 'Lead with cost-driven architecture variants once per session.' },
    ],
  };

  // Match the canonical session_state shape from interviewSessionService.
  const session_state = {
    current_section_index: 4,
    section_started_at: new Date(),
    session_wall_start_ms: Date.now() - 14 * 60 * 1000,
    session_ended_at_ms: Date.now() - 30 * 1000,
    signals: {
      strong: ['read_write_split', 'stampede_protection', 'tradeoff_articulation', 'id_allocation'],
      weak: ['operations_depth', 'cost_modeling'],
    },
    live_evaluation: {},
    eval_history: [],
    interview_done: true,
    total_sections: 5,
    turn_count: 7,
  };

  const execution_plan = {
    template_id: 'system_design_url_shortener',
    sections: [
      { id: 'requirements', name: 'Requirements Clarification', time_budget_minutes: 7 },
      { id: 'high_level_design', name: 'High Level Architecture', time_budget_minutes: 12 },
      { id: 'deep_dive', name: 'Deep Dive — ID Generation & Redirect Path', time_budget_minutes: 14 },
      { id: 'tradeoffs', name: 'Tradeoffs & Alternatives', time_budget_minutes: 9 },
      { id: 'operations', name: 'Reliability & Operations', time_budget_minutes: 8 },
    ],
    primary_question: {
      title: 'Design a URL Shortener',
      problem_statement:
        'Design a URL shortener like bit.ly. Users submit long URLs and get back a short slug; anyone can later visit the slug and be redirected to the original URL.',
    },
    interviewer_persona: {
      name: 'Alex',
      title: 'Staff Software Engineer',
      style: 'rigorous, friendly, fast on push-back',
    },
  };

  return {
    id: 'mock-seed-orchestrated-sd',
    status: 'completed',
    created_date: daysAgoIso(0),
    role_title: 'Staff Software Engineer',
    role_track: 'ic',
    company: 'Octopus Labs',
    experience_level: 'staff',
    years_experience_band: '8_12',
    interview_type: 'system_design',
    industry: 'Developer Tools',
    interview_mode: 'chat',
    duration_seconds: 900,
    template_id: 'system_design_url_shortener',
    template_version: '1.0',
    selected_template_id: 'system_design_url_shortener',
    execution_plan,
    session_state,
    conversation_turns: turns,
    debrief,
    overall_score: 92,
    notes:
      "- ~5k writes/sec, ~500k reads/sec\n- p99 redirect 80ms\n- base62, 7-char slugs (~3.5T)\n- pre-allocated id ranges\n- origin shield + request coalescing",
  };
}
