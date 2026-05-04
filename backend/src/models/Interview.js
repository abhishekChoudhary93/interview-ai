import mongoose from 'mongoose';

/**
 * Per-question scoring is a LEGACY shape from the deprecated 5-question loop.
 * New orchestrated interviews don't write into `questions[]`; they keep
 * conversation as `conversation_turns` and rubric scores in `session_state`.
 * Kept readable so old report rows still render.
 */
const questionSchema = new mongoose.Schema(
  {
    question: String,
    answer: String,
    score_answer_quality: Number,
    score_english_clarity: Number,
    score_communication: Number,
    score_eye_contact: Number,
    score_body_language: Number,
    feedback: String,
  },
  { _id: false }
);

const conversationTurnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['interviewer', 'candidate'] },
    content: String,
    kind: String,
    ts: { type: Date, default: Date.now },
  },
  { _id: false }
);

const interviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: String, required: true, index: true },
    status: { type: String, required: true },
    created_date: { type: String, required: true },
    role_title: String,
    /** ic | sdm — tech interview track (optional on legacy rows). */
    role_track: String,
    company: String,
    experience_level: String,
    /** Calendar years band: 0_2 | 2_5 | 5_8 | 8_12 | 12_plus. */
    years_experience_band: String,
    /**
     * Six-level interviewing taxonomy used by the Planner / Executor split.
     * One of: INTERN | SDE_1 | SDE_2 | SR_SDE | PRINCIPAL_STAFF | SR_PRINCIPAL.
     * New rows write this directly; legacy rows derive it on read via
     * `resolveTargetLevel` so backward compat is preserved.
     */
    target_level: String,
    interview_type: String,
    industry: String,
    interview_mode: { type: String, default: 'chat' },
    duration_seconds: Number,

    /** LEGACY: per-question scoring; new flow does not populate this. */
    questions: { type: [questionSchema], default: [] },

    /** LEGACY: top-level numeric scores from the 5-Q loop. New flow stores
     *  weighted rubric scores under `debrief.section_scores`. */
    overall_score: Number,
    score_answer_quality: Number,
    score_english_clarity: Number,
    score_communication: Number,
    score_eye_contact: Number,
    score_body_language: Number,

    summary_feedback: String,
    strengths: [String],
    improvements: [String],

    /** Orchestration (always present for new rows). */
    template_id: String,
    template_version: String,
    /** Denormalized copy of template_id for resolver convenience. */
    selected_template_id: String,
    /** LEGACY adaptation snapshot — retained for old rows; new flow does not write. */
    adaptation_raw: { type: mongoose.Schema.Types.Mixed },
    /** LEGACY orchestrator state — retained for old rows; new flow does not write. */
    orchestrator_state: { type: mongoose.Schema.Types.Mixed },
    /** v2 LEGACY: resolved template snapshot. v3 rows write to `interview_config` instead. */
    execution_plan: { type: mongoose.Schema.Types.Mixed },
    /** v3 snapshot of the loaded interview-config JSON taken at session start.
     *  Carries problem, sections, scope, scale_facts, fault_scenarios,
     *  raise_stakes_prompts, interviewer persona. The Executor and debrief
     *  read from this so a config edit cannot retroactively change a row. */
    interview_config: { type: mongoose.Schema.Types.Mixed },

    target_duration_minutes: Number,
    session_started_at: Date,
    conversation_turns: { type: [conversationTurnSchema], default: [] },
    orch_schema_version: { type: Number, default: 0 },

    /** v3 live session state. Shape:
     *    {
     *      opening_phase: 'awaiting_ack' | 'in_progress',
     *      turn_count,                    // interviewer turn counter (safety cap)
     *      session_wall_start_ms,         // ms timestamp of session start
     *      last_turn_ts,                  // ms timestamp of previous turn (per-section delta)
     *      eval_history: [{
     *        turn_index, move, difficulty, momentum, bar_trajectory, time_status,
     *        recommended_section_focus_id, performance_assessment, candidate_signal,
     *        consumed_probe_id, probe_observations_added, flags_added_count,
     *        leak_guard_triggered, reply_leak_triggered, validator_flags,
     *        interview_elapsed_fraction, interview_done, notes, at
     *      }],
     *      probe_queue: { [section_id]: [{id, observation, probe, difficulty, added_at_turn, consumed, consumed_at_turn}] },
     *      flags_by_section: { [section_id]: [{type:'green'|'red', signal_id, note, at_turn}] },
     *      section_minutes_used: { [section_id]: number },
     *      performance_by_section: { [section_id]: 'above_target'|'at_target'|'below_target' },
     *      next_directive: {
     *        move, difficulty, recommended_focus, recommended_section_focus_id,
     *        consumed_probe_id, momentum, bar_trajectory, time_status, answer_only,
     *        generated_after_turn
     *      },
     *      interview_done,
     *      // Local-only debug trace, populated when INTERVIEW_DEBUG_TRACE=1:
     *      debug_trace: [{ turn_index, ts, candidate_message, executor:{...}, planner:{...} }]
     *    }
     */
    session_state: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    /** Candidate scratchpad / notes — persisted from the right-rail editor. */
    notes: { type: String, default: '' },

    /** Excalidraw scene snapshot ({ elements, appState, files }) used to
     *  rehydrate the design canvas on resume. Only populated for system_design
     *  interviews; null otherwise. */
    canvas_scene: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Compact textual summary of canvas_scene (boxes, arrows, labels) that
     *  buildSystemPrompt feeds into the conversational LLM each turn. Computed
     *  on the frontend whenever the diagram changes. */
    canvas_text: { type: String, default: '' },

    /** Final structured FAANG-style debrief (system_design + behavioral). */
    debrief: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

interviewSchema.index({ userId: 1, clientId: 1 }, { unique: true });
interviewSchema.index({ userId: 1, status: 1, createdAt: -1 });

const DEPRECATED_WRITE_FIELDS = [
  'orchestrator_state',
  'adaptation_raw',
];

interviewSchema.pre('save', function warnOnDeprecatedWrites(next) {
  if (process.env.NODE_ENV === 'production') return next();
  for (const f of DEPRECATED_WRITE_FIELDS) {
    if (this.isModified(f) && this.get(f) != null && this.isNew) {
      console.warn(`[Interview] new row writing to deprecated field "${f}" — use session_state instead.`);
    }
  }
  next();
});

export const Interview = mongoose.model('Interview', interviewSchema);
