/**
 * System design interview rubrics (verbatim spec).
 * Top-level key `requirements` matches execution_plan section id (spec used `requirements_clarification`).
 */
export const SYSTEM_DESIGN_RUBRICS = {
  requirements: {
    weight: 0.1,
    signals: [
      {
        id: 'scope_driven',
        label: 'Drove scope independently',
        description: 'Asked clarifying questions before touching architecture',
        scores: {
          4: 'Systematically clarified functional + non-functional + scale before designing anything',
          3: 'Clarified most things but needed a prompt for scale or NFRs',
          2: 'Asked 1-2 questions but missed critical areas (e.g. never asked about scale)',
          1: 'Jumped straight to design without any clarification',
        },
      },
      {
        id: 'nfr_awareness',
        label: 'Non-functional requirements',
        description: 'Identified latency, availability, consistency, durability needs',
        scores: {
          4: 'Proactively defined SLAs, consistency model, availability target',
          3: 'Mentioned NFRs when asked or partially covered them',
          2: 'Only covered functional requirements',
          1: 'No NFR awareness',
        },
      },
      {
        id: 'estimation',
        label: 'Back-of-envelope estimation',
        description: 'Quantified scale before designing',
        scores: {
          4: 'Estimated storage, bandwidth, QPS unprompted with reasonable assumptions',
          3: 'Did estimation when prompted, methodology sound',
          2: 'Did estimation but numbers were off or methodology unclear',
          1: 'No estimation attempted',
        },
      },
    ],
  },

  high_level_design: {
    weight: 0.2,
    signals: [
      {
        id: 'component_decomposition',
        label: 'Component decomposition',
        description: 'Broke system into right services with clear boundaries',
        scores: {
          4: 'Clean separation of concerns, each component has single clear responsibility',
          3: 'Good decomposition with minor boundary issues',
          2: 'Decomposed but with unclear responsibilities or missing key components',
          1: 'Monolithic thinking or missing major components',
        },
      },
      {
        id: 'data_flow',
        label: 'Data flow clarity',
        description: 'Explained how data moves through the system end-to-end',
        scores: {
          4: 'Walked through complete data flow for both read and write paths unprompted',
          3: 'Explained primary path, missed secondary or edge case paths',
          2: 'Partial data flow, needed prompting to complete',
          1: 'Could not coherently explain data flow',
        },
      },
      {
        id: 'technology_choices',
        label: 'Technology choices with rationale',
        description: 'Made opinionated choices and defended them',
        scores: {
          4: 'Every major choice came with clear tradeoff reasoning and alternatives considered',
          3: 'Made good choices, some without explicit rationale',
          2: 'Made choices but could not defend or explain tradeoffs',
          1: "Generic choices with no rationale (e.g. 'use a database')",
        },
      },
    ],
  },

  deep_dive: {
    weight: 0.3,
    signals: [
      {
        id: 'failure_modes',
        label: 'Failure mode thinking',
        description: 'Identified what breaks and how to handle it',
        scores: {
          4: 'Proactively identified failure scenarios and designed recovery mechanisms',
          3: 'Addressed failures when asked, solutions were sound',
          2: 'Acknowledged failures exist but solutions were vague',
          1: 'No failure mode awareness',
        },
      },
      {
        id: 'depth_of_knowledge',
        label: 'Technical depth',
        description: 'Could go deep on at least one area with concrete specifics',
        scores: {
          4: 'Went 3+ levels deep on at least one component with concrete implementation details',
          3: 'Went 2 levels deep, some vagueness on specifics',
          2: 'Surface level only, could not go deeper when pushed',
          1: 'Could not go deep even with hints',
        },
      },
      {
        id: 'scaling_strategy',
        label: 'Scaling strategy',
        description: 'Explained how the system handles growth',
        scores: {
          4: 'Specific scaling strategy per component, addressed hotspots proactively',
          3: 'General scaling awareness, addressed bottlenecks when prompted',
          2: 'Mentioned horizontal scaling generically with no specifics',
          1: 'No scaling consideration',
        },
      },
    ],
  },

  tradeoffs: {
    weight: 0.25,
    signals: [
      {
        id: 'tradeoff_awareness',
        label: 'Tradeoff articulation',
        description: 'Acknowledged what design gives up, not just what it gains',
        scores: {
          4: 'Proactively stated tradeoffs for every major decision, connected to requirements',
          3: 'Acknowledged tradeoffs when asked, reasoning was sound',
          2: 'Defended all decisions without acknowledging downsides',
          1: 'No tradeoff awareness',
        },
      },
      {
        id: 'alternatives_considered',
        label: 'Alternatives considered',
        description: 'Showed awareness of other approaches',
        scores: {
          4: 'Named specific alternatives for major decisions and explained why rejected',
          3: 'Mentioned alternatives for some decisions',
          2: 'Could name alternatives when prompted but no analysis',
          1: 'Unaware of alternatives',
        },
      },
    ],
  },

  operations: {
    weight: 0.15,
    signals: [
      {
        id: 'observability',
        label: 'Observability',
        description: 'Metrics, logging, alerting strategy',
        scores: {
          4: "Defined specific metrics, alert thresholds, dashboards — knew what 'system is broken' looks like",
          3: 'Mentioned monitoring, named some metrics',
          2: 'Generic monitoring mention with no specifics',
          1: 'No mention of observability',
        },
      },
      {
        id: 'operational_readiness',
        label: 'Operational readiness',
        description: 'Rollout strategy, rollback, on-call',
        scores: {
          4: 'Discussed feature flags, gradual rollout, rollback triggers',
          3: 'Mentioned some operational concerns',
          2: 'Treated deployment as an afterthought',
          1: 'No operational thinking',
        },
      },
    ],
  },
};
