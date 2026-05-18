import { SUBSCRIPTION_PERIOD_DAYS } from '../config/plans.js';
import { User } from '../models/User.js';

function isPaidSubscriptionPeriodActive(sub) {
  if (!sub || sub.plan === 'starter') return false;
  if (!sub.currentPeriodEnd) return false;
  const end = new Date(sub.currentPeriodEnd);
  if (Number.isNaN(end.getTime()) || end <= new Date()) return false;
  return sub.status === 'active' || sub.status === 'canceled';
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Migrate legacy counters into interviewsUsed.
 * @param {import('mongoose').Document} user
 */
function migrateLegacyUsage(user) {
  if (!user.usage) user.usage = {};
  if (user.usage.interviewsUsed == null) {
    user.usage.interviewsUsed =
      user.usage.startedInterviews ?? user.usage.completedInterviews ?? 0;
  }
}

/**
 * Resolve billing window for quota (paid subscription period or starter 30-day blocks).
 * @param {import('mongoose').Document} user
 * @returns {{ start: Date, end: Date }}
 */
export function resolveQuotaPeriod(user) {
  const sub = user.subscription ?? { plan: 'starter' };
  const now = new Date();

  if (isPaidSubscriptionPeriodActive(sub)) {
    const start = sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : now;
    let end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : addDays(start, SUBSCRIPTION_PERIOD_DAYS);
    if (Number.isNaN(end.getTime()) || end <= start) {
      end = addDays(start, SUBSCRIPTION_PERIOD_DAYS);
    }
    return { start, end };
  }

  let start = user.usage?.quotaPeriodStart ? new Date(user.usage.quotaPeriodStart) : null;
  if (!start || Number.isNaN(start.getTime())) {
    start = user.createdAt ? new Date(user.createdAt) : now;
  }
  let end = user.usage?.quotaPeriodEnd ? new Date(user.usage.quotaPeriodEnd) : null;
  if (!end || Number.isNaN(end.getTime()) || end <= start) {
    end = addDays(start, SUBSCRIPTION_PERIOD_DAYS);
  }

  while (now >= end) {
    start = new Date(end);
    end = addDays(start, SUBSCRIPTION_PERIOD_DAYS);
  }

  return { start, end };
}

/**
 * Align usage period to subscription / starter window; reset counter when period ended.
 * @param {import('mongoose').Document} user
 * @returns {number} interviewsUsed in current period
 */
export function syncUsagePeriod(user) {
  migrateLegacyUsage(user);
  const { start, end } = resolveQuotaPeriod(user);
  const now = new Date();

  const storedEnd = user.usage.quotaPeriodEnd ? new Date(user.usage.quotaPeriodEnd) : null;
  const periodExpired =
    !storedEnd ||
    Number.isNaN(storedEnd.getTime()) ||
    now >= storedEnd ||
    (user.usage.quotaPeriodStart &&
      new Date(user.usage.quotaPeriodStart).getTime() !== start.getTime());

  if (periodExpired) {
    user.usage.quotaPeriodStart = start;
    user.usage.quotaPeriodEnd = end;
    user.usage.interviewsUsed = 0;
    user.markModified('usage');
  } else if (!user.usage.quotaPeriodStart || !user.usage.quotaPeriodEnd) {
    user.usage.quotaPeriodStart = start;
    user.usage.quotaPeriodEnd = end;
    user.markModified('usage');
  }

  return user.usage.interviewsUsed ?? 0;
}

/**
 * @param {import('mongoose').Document} user
 */
export function getInterviewsUsedInPeriod(user) {
  return syncUsagePeriod(user);
}

/**
 * Reset usage when a paid subscription renews (billing webhook / verify).
 * @param {import('mongoose').Document} user
 * @param {{ periodStart: Date, periodEnd: Date }} period
 */
export function resetUsageForNewSubscriptionPeriod(user, { periodStart, periodEnd }) {
  if (!user.usage) user.usage = {};
  user.usage.quotaPeriodStart = periodStart;
  user.usage.quotaPeriodEnd = periodEnd;
  user.usage.interviewsUsed = 0;
  user.markModified('usage');
}

/**
 * Atomically consume one interview slot for the current billing period.
 * @param {string} userId
 * @param {number | null} limit null = unlimited
 * @returns {Promise<{ ok: boolean, interviewsUsed?: number }>}
 */
export async function tryConsumeInterviewSlot(userId, limit) {
  const user = await User.findById(userId).exec();
  if (!user) return { ok: false };

  syncUsagePeriod(user);
  const { start, end } = resolveQuotaPeriod(user);
  await user.save();

  if (limit == null) {
    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { 'usage.interviewsUsed': 1 },
        $set: {
          'usage.quotaPeriodStart': start,
          'usage.quotaPeriodEnd': end,
        },
      },
      { new: true }
    ).exec();
    return { ok: true, interviewsUsed: updated?.usage?.interviewsUsed ?? 1 };
  }

  const updated = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { 'usage.interviewsUsed': { $lt: limit } },
        { 'usage.interviewsUsed': { $exists: false } },
      ],
    },
    {
      $inc: { 'usage.interviewsUsed': 1 },
      $set: { 'usage.quotaPeriodStart': start, 'usage.quotaPeriodEnd': end },
    },
    { new: true }
  ).exec();

  if (!updated) return { ok: false };
  return { ok: true, interviewsUsed: updated.usage?.interviewsUsed ?? limit };
}

/**
 * Roll back slot if interview row creation failed after consume.
 * @param {string} userId
 */
export async function rollbackInterviewSlot(userId) {
  await User.findByIdAndUpdate(userId, {
    $inc: { 'usage.interviewsUsed': -1 },
  }).exec();
}

/** @deprecated use getInterviewsUsedInPeriod */
export function getStartedInterviewsThisMonth(user) {
  return getInterviewsUsedInPeriod(user);
}

/** @deprecated use tryConsumeInterviewSlot */
export async function incrementStartedInterviews(userId) {
  const user = await User.findById(userId).exec();
  if (!user) return null;
  syncUsagePeriod(user);
  user.usage.interviewsUsed = (user.usage.interviewsUsed ?? 0) + 1;
  user.markModified('usage');
  await user.save();
  return user.usage.interviewsUsed;
}
