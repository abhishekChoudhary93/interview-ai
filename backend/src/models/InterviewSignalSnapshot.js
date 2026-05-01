import mongoose from 'mongoose';

/** Append-only signals from completed interviews — feeds Layer 2 adaptation. */
const interviewSignalSnapshotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    interviewClientId: { type: String, required: true },
    completedAt: { type: Date, default: Date.now },
    template_id: String,
    section_scores: { type: mongoose.Schema.Types.Mixed, default: {} },
    topic_signals: {
      weak: [String],
      strong: [String],
      never_tested: [String],
    },
    notable_quotes: [String],
    recommendation: String,
  },
  { timestamps: true }
);

interviewSignalSnapshotSchema.index({ userId: 1, completedAt: -1 });

export const InterviewSignalSnapshot = mongoose.model(
  'InterviewSignalSnapshot',
  interviewSignalSnapshotSchema
);
