import mongoose from 'mongoose';

const recentTemplateSchema = new mongoose.Schema(
  {
    template_id: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    plan: { type: String, enum: ['starter', 'pro', 'elite'], default: 'starter' },
    status: { type: String, enum: ['active', 'canceled', 'expired'], default: 'active' },
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    razorpaySubscriptionId: { type: String },
    razorpayPlanId: { type: String },
    lastPaymentAt: { type: Date },
  },
  { _id: false }
);

const usageSchema = new mongoose.Schema(
  {
    periodKey: { type: String },
    completedInterviews: { type: Number, default: 0 },
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
    subscription: { type: subscriptionSchema, default: () => ({}) },
    usage: { type: usageSchema, default: () => ({}) },
  },
  { timestamps: true }
);

/** Current UTC calendar month key for usage quotas. */
export function currentUsagePeriodKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function defaultSubscriptionFields() {
  return {
    subscription: { plan: 'starter', status: 'active' },
    usage: { periodKey: currentUsagePeriodKey(), completedInterviews: 0 },
  };
}

export const User = mongoose.model('User', userSchema);
