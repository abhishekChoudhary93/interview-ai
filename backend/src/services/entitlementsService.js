import { User } from '../models/User.js';
import { getPlanConfig } from '../config/plans.js';
import { getStartedInterviewsThisMonth, syncUsagePeriod } from './usageService.js';

/**
 * Paid access is valid while status is active or canceled (grace) and period end is in the future.
 * @param {Record<string, unknown>} sub
 */
export function isPaidPeriodActive(sub) {
  if (!sub || sub.plan === 'starter') return true;
  if (!sub.currentPeriodEnd) return false;
  const end = new Date(sub.currentPeriodEnd);
  if (Number.isNaN(end.getTime()) || end <= new Date()) return false;
  if (sub.status === 'active' || sub.status === 'canceled') return true;
  return false;
}

/**
 * @param {import('mongoose').Document | Record<string, unknown>} user
 */
export function resolveEffectiveSubscription(user) {
  const sub = user.subscription ?? { plan: 'starter', status: 'active' };
  if (sub.plan === 'starter') {
    return {
      plan: 'starter',
      storedPlan: 'starter',
      status: 'active',
      isActive: true,
      expiresAt: null,
      previousPlan: null,
    };
  }
  if (isPaidPeriodActive(sub)) {
    return {
      plan: sub.plan,
      storedPlan: sub.plan,
      status: sub.status === 'canceled' ? 'canceled' : 'active',
      isActive: true,
      expiresAt: sub.currentPeriodEnd ?? null,
      previousPlan: null,
    };
  }
  return {
    plan: 'starter',
    storedPlan: sub.plan,
    status: 'expired',
    isActive: false,
    expiresAt: sub.currentPeriodEnd ?? null,
    previousPlan: sub.plan,
  };
}

/**
 * Persist expired status when paid period has lapsed (idempotent).
 * @param {import('mongoose').Document} user
 */
export async function expireSubscriptionIfNeeded(user) {
  const sub = user.subscription ?? {};
  if (sub.plan === 'starter' || sub.status === 'expired') return false;
  if (!sub.currentPeriodEnd) return false;
  const end = new Date(sub.currentPeriodEnd);
  if (Number.isNaN(end.getTime()) || end > new Date()) return false;
  if (sub.status === 'expired') return false;
  user.subscription.status = 'expired';
  user.markModified('subscription');
  await user.save();
  return true;
}

function daysRemaining(expiresAt) {
  if (!expiresAt) return null;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * @param {import('mongoose').Document} user
 */
export async function getEntitlementsForUser(user) {
  await expireSubscriptionIfNeeded(user);
  const effective = resolveEffectiveSubscription(user);
  syncUsagePeriod(user);
  const planConfig = getPlanConfig(effective.plan);
  const used = getStartedInterviewsThisMonth(user);
  const limit = planConfig.monthlyInterviewLimit;
  const unlimited = limit == null;
  const remaining = unlimited ? null : Math.max(0, limit - used);
  const canStartInterview = unlimited || used < limit;

  return {
    effectivePlan: effective.plan,
    storedPlan: effective.storedPlan,
    subscriptionStatus: effective.status,
    isActive: effective.isActive,
    expiresAt: effective.expiresAt,
    daysRemaining: daysRemaining(effective.expiresAt),
    previousPlan: effective.previousPlan,
    interviewsUsed: used,
    interviewsLimit: limit,
    interviewsRemaining: remaining,
    canStartInterview,
    reportLevel: planConfig.reportLevel,
    features: { ...planConfig.features },
  };
}

/**
 * @param {string} userId
 */
export async function loadUserAndEntitlements(userId) {
  const user = await User.findById(userId).exec();
  if (!user) return { user: null, entitlements: null };
  const entitlements = await getEntitlementsForUser(user);
  return { user, entitlements };
}
