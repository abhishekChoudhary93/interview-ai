/**
 * Strip paid-only report fields for starter / basic reportLevel.
 * Keeps exactly one actionable weakness/improvement readable ("One Piece of Candy")
 * and fills the rest with realistic engineering "shape" dummy data.
 * @param {Record<string, unknown>} interviewPlain
 */
export function redactInterviewForReport(interviewPlain) {
  const out = { ...interviewPlain };
  out._reportRedacted = true;

  // Realistic System Design mock transcript exchanges for skeleton FOMO
  const mockTurns = [
    {
      role: 'interviewer',
      content: 'Could you elaborate on how you would handle data consistency across your distributed read and write paths?'
    },
    {
      role: 'candidate',
      content: 'We should utilize an event-driven replication model using a distributed commit log. For strict consistency, we can enforce a quorum-based read/write protocol, though this will increase write path latency.'
    },
    {
      role: 'interviewer',
      content: 'How would you design the synchronization mechanism between your primary transactional database and the search replica index?'
    },
    {
      role: 'candidate',
      content: 'I would set up a Change Data Capture (CDC) pipeline using Debezium to stream transaction logs directly from the primary database to Kafka, and have consumer workers batch-index into Elasticsearch asynchronously.'
    },
    {
      role: 'interviewer',
      content: 'What strategy would you employ to mitigate potential split-brain scenarios in a multi-region consensus cluster?'
    },
    {
      role: 'candidate',
      content: 'We must use a consensus algorithm like Raft or Paxos with a minimum of three deployment zones. If a network partition occurs, the minority partition will fail to achieve a quorum and reject writes, preventing split-brain.'
    }
  ];

  // 1. Redact conversation_turns
  if (Array.isArray(interviewPlain.conversation_turns)) {
    out.conversation_turns = interviewPlain.conversation_turns.map((t, idx) => {
      const mock = mockTurns[idx % mockTurns.length];
      return {
        role: t.role || mock.role,
        content: mock.content
      };
    });
  }

  // 2. Redact transcript_messages if they exist
  if (Array.isArray(interviewPlain.transcript_messages)) {
    out.transcript_messages = interviewPlain.transcript_messages.map((m, idx) => {
      const mock = mockTurns[idx % mockTurns.length];
      return {
        role: m.role || mock.role,
        content: mock.content
      };
    });
  }

  // 3. Redact canvas_scene text labels while keeping architectural shapes
  if (out.canvas_scene && Array.isArray(out.canvas_scene.elements)) {
    out.canvas_scene = {
      ...out.canvas_scene,
      elements: out.canvas_scene.elements.map(el => {
        if (el.text !== undefined) {
          return {
            ...el,
            text: 'Service Node',
            originalText: 'Service Node'
          };
        }
        return el;
      })
    };
  }

  // 4. Extract "One Piece of Candy" (Exactly one real weakness / improvement)
  let candyItem = null;
  let candyFound = false;

  if (interviewPlain.debrief && typeof interviewPlain.debrief === 'object') {
    const deb = interviewPlain.debrief;
    if (Array.isArray(deb.improvements) && deb.improvements.length > 0) {
      const firstRealImp = deb.improvements[0];
      if (typeof firstRealImp === 'object' && firstRealImp !== null) {
        candyItem = {
          point: firstRealImp.point || firstRealImp.moment || firstRealImp.title || 'Focus on scale estimates',
          evidence: firstRealImp.evidence || firstRealImp.quote || firstRealImp.detail || 'Improve back-of-the-envelope calculations for storage tier bandwidth.',
          _isCandy: true
        };
        candyFound = true;
      } else if (typeof firstRealImp === 'string') {
        candyItem = {
          point: firstRealImp,
          evidence: 'Identified as a critical growth area during your system layout section.',
          _isCandy: true
        };
        candyFound = true;
      }
    } else if (Array.isArray(deb.top_moments)) {
      const realGap = deb.top_moments.find(m => String(m.type).toLowerCase() === 'gap');
      if (realGap) {
        candyItem = {
          point: realGap.point || realGap.moment || 'Address single points of failure',
          evidence: realGap.evidence || 'You should design for resilience by introducing redundancy and failover pools.',
          _isCandy: true
        };
        candyFound = true;
      }
    }
  }

  // Fallback to legacy improvements array if needed
  if (!candyFound && Array.isArray(interviewPlain.improvements) && interviewPlain.improvements.length > 0) {
    candyItem = {
      point: interviewPlain.improvements[0],
      evidence: 'This improvement was highlighted during your manual interview review.',
      _isCandy: true
    };
    candyFound = true;
  }

  // Fallback to default if absolutely no improvements were found in data
  if (!candyFound) {
    candyItem = {
      point: 'Calculate resource throughput requirements systematically',
      evidence: 'You estimated system scale but did not detail query/sec limits on read replicas under peak loads.',
      _isCandy: true
    };
  }

  // 5. Redact debrief
  if (out.debrief && typeof out.debrief === 'object') {
    const debrief = { ...out.debrief };

    // Keep verdict and overall_score unchanged
    debrief.summary = 'The candidate demonstrated reasonable knowledge of general system structures. However, critical gaps were observed in sizing estimations, back-of-the-envelope throughput calculations, and deep-dive failure isolation mechanisms. (Upgrade to reveal the complete, detailed AI report summary.)';

    // Mock strengths
    debrief.strengths = [
      {
        point: 'Articulated strong separation of concerns',
        evidence: 'Exhibited solid system decomposition by decoupling the heavy write ingestion path from search indexing.'
      },
      {
        point: 'Designed correct fault-tolerant boundaries',
        evidence: 'Correctly proposed client-side circuit breakers and bulkhead strategies to isolate failure cascades.'
      }
    ];

    // Mock next session focus
    debrief.next_session_focus = [
      {
        area: 'Back-of-the-envelope calculations',
        reason: 'Practice translating peak daily active users into network ingress and partition write IOPS.'
      },
      {
        area: 'Cache invalidation protocols',
        reason: 'Focus on explaining consistency tradeoffs when updating distributed key-value replica stores.'
      }
    ];

    // Mock section scores
    if (debrief.section_scores && typeof debrief.section_scores === 'object') {
      const dummySectionScores = {};
      Object.keys(debrief.section_scores).forEach((secId) => {
        const originalSec = debrief.section_scores[secId] || {};
        const dummySignals = Array.isArray(originalSec.signals)
          ? originalSec.signals.map((sig, idx) => ({
              signal: idx % 3 === 0 ? 'Data Consistency' : idx % 3 === 1 ? 'Throughput Estimation' : 'Fault Tolerance',
              score: idx % 2 === 0 ? 3 : 2, // Realistic mix of solid/weak
              evidence: 'Mock evidence capturing the technical execution of this design signal.',
              what_it_means: 'This signal evaluates your ability to structure complex system boundaries under heavy concurrency.'
            }))
          : [];

        dummySectionScores[secId] = {
          status: originalSec.status || 'completed',
          weighted_score: originalSec.weighted_score ? '65/100' : undefined,
          signals: dummySignals,
          comment: 'Mock evaluation highlighting general high-level strengths and growth areas for this system domain.'
        };
      });
      debrief.section_scores = dummySectionScores;
    }

    // Build improvements: Exactly ONE real candy item, and 2 dummy ones
    debrief.improvements = [
      candyItem,
      {
        point: 'Address secondary replication bottlenecks',
        evidence: 'Ensure you address how lag in read replicas can cause transient stale data conditions.',
        _isCandy: false
      },
      {
        point: 'Formalize failure recovery metrics',
        evidence: 'Define clear RTO (Recovery Time Objective) and RPO (Recovery Point Objective) limits for system failovers.',
        _isCandy: false
      }
    ];

    // Dummy top_moments if exists
    if (Array.isArray(debrief.top_moments)) {
      debrief.top_moments = [
        {
          type: 'strength',
          point: 'Articulated strong separation of concerns',
          evidence: 'Exhibited solid system decomposition by decoupling the heavy write ingestion path.'
        },
        {
          type: 'gap',
          point: candyItem.point,
          evidence: candyItem.evidence,
          _isCandy: true
        },
        {
          type: 'gap',
          point: 'Address secondary replication bottlenecks',
          evidence: 'Ensure you address how lag in read replicas can cause transient stale data conditions.',
          _isCandy: false
        }
      ];
    }

    out.debrief = debrief;
  }

  // 6. Redact session_state signals
  if (out.session_state && typeof out.session_state === 'object') {
    const ss = { ...out.session_state };
    delete ss.raw_planner_outputs;
    if (ss.signals) {
      ss.signals = {
        strong: ['Separation of Concerns', 'Fault Isolation'],
        weak: ['Resource Estimation', 'Edge Synchronization']
      };
    }
    out.session_state = ss;
  }

  // 7. Redact legacy questions array if present
  if (Array.isArray(out.questions)) {
    out.questions = interviewPlain.questions.map((q, idx) => {
      return {
        ...q,
        question: `Design Section ${idx + 1}: Edge Network Routing?`,
        answer: 'I would configure global load balancing with GeoDNS to route candidates to the nearest cluster. However, I didn\'t fully specify the failover rules for stateful cache replicas.',
        feedback: idx === 0 
          ? `Needs Work: ${candyItem.point}. ${candyItem.evidence}`
          : 'Detailed performance breakdown and specific guidance are locked for basic reports.',
        score_answer_quality: idx % 2 === 0 ? 75 : 50,
        score_english_clarity: idx % 2 === 0 ? 80 : 60,
        score_communication: idx % 2 === 0 ? 85 : 55,
      };
    });
  }

  // 8. Redact legacy strengths / improvements lists
  if (Array.isArray(interviewPlain.strengths)) {
    out.strengths = [
      'Separated components into dedicated event-driven worker layers.',
      'Identified and resolved single point of failure in load balancing.'
    ];
  }

  if (Array.isArray(interviewPlain.improvements)) {
    out.improvements = [
      candyItem.point,
      'Formulate precise peak query-per-second load limits under concurrent sessions.',
      'Elaborate on data consistency trade-offs when implementing edge caching.'
    ];
  }

  return out;
}
