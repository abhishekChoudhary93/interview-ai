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

const interviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: String, required: true, index: true },
    status: { type: String, required: true },
    created_date: { type: String, required: true },
    role_title: String,
    company: String,
    experience_level: String,
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
  },
  { timestamps: true }
);

interviewSchema.index({ userId: 1, clientId: 1 }, { unique: true });

export const Interview = mongoose.model('Interview', interviewSchema);
