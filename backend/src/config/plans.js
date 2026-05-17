import { config } from '../config.js';

/** Canonical plan ids stored on User.subscription.plan */
export const PLAN_IDS = ['starter', 'pro', 'elite'];

/** Public catalog tier ids (markets.js) → internal plan id */
export const TIER_TO_PLAN = {
  starter: 'starter',
  pro_monthly: 'pro',
  elite_monthly: 'elite',
};

export const PLANS = {
  starter: {
    id: 'starter',
    monthlyInterviewLimit: config.starterMonthlyInterviewLimit,
    reportLevel: 'basic',
    features: {
      customRoleQuestions: false,
      allSystemDesignTracks: false,
      behavioralBlueprints: false,
      whiteboardHistory: false,
    },
  },
  pro: {
    id: 'pro',
    monthlyInterviewLimit: config.proMonthlyInterviewLimit,
    reportLevel: 'full',
    features: {
      customRoleQuestions: true,
      allSystemDesignTracks: false,
      behavioralBlueprints: false,
      whiteboardHistory: false,
    },
  },
  elite: {
    id: 'elite',
    monthlyInterviewLimit: null,
    reportLevel: 'full',
    features: {
      customRoleQuestions: true,
      allSystemDesignTracks: true,
      behavioralBlueprints: true,
      whiteboardHistory: true,
    },
  },
};

/** Razorpay order amounts in paise (INR). */
export const PLAN_AMOUNTS_INR_PAISE = {
  pro: 100,
  elite: 200,
};

export const SUBSCRIPTION_PERIOD_DAYS = 30;

export function getPlanConfig(planId) {
  return PLANS[planId] || PLANS.starter;
}

export function isValidPaidPlan(plan) {
  return plan === 'pro' || plan === 'elite';
}
