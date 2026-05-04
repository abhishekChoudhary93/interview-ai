import mongoose from 'mongoose';

const recentTemplateSchema = new mongoose.Schema(
  {
    template_id: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    /** v2 LEGACY: rotation history for the multi-template resolver, retained
     *  on the schema so old user docs do not lose data. v3 single-problem
     *  engine no longer writes here. */
    recent_templates: { type: [recentTemplateSchema], default: [] },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
