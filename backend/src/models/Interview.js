import mongoose from 'mongoose';

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
    /** Calendar years band: 0_2 | 2_5 | 5_8 | 8_12 | 12_plus — drives IC_MID vs IC_STAFF with experience_level. */
    years_experience_band: String,
    interview_type: String,
    industry: String,
    interview_mode: { type: String, default: 'chat' },
    duration_seconds: Number,
    questions: { type: [questionSchema], default: [] },
    overall_score: Number,
    score_answer_quality: Number,
    score_english_clarity: Number,
    score_communication: Number,
    score_eye_contact: Number,
    score_body_language: Number,
    summary_feedback: String,
    strengths: [String],
    improvements: [String],
    /** Orchestration (optional — legacy interviews omit). */
    template_id: String,
    template_version: String,
    execution_plan: { type: mongoose.Schema.Types.Mixed },
    adaptation_raw: { type: mongoose.Schema.Types.Mixed },
    orchestrator_state: { type: mongoose.Schema.Types.Mixed },
    target_duration_minutes: Number,
    session_started_at: Date,
    conversation_turns: { type: [conversationTurnSchema], default: [] },
    orch_schema_version: { type: Number, default: 0 },
    /** Structured FAANG-style debrief when execution_plan includes primary_question (e.g. system design). */
    debrief: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

interviewSchema.index({ userId: 1, clientId: 1 }, { unique: true });
interviewSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const Interview = mongoose.model('Interview', interviewSchema);
