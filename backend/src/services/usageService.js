import { User, currentUsagePeriodKey } from '../models/User.js';

/**
 * Ensure usage.periodKey matches current month; reset counter when month rolls over.
 * @param {import('mongoose').Document} user
 */
export function syncUsagePeriod(user) {
  const key = currentUsagePeriodKey();
  if (!user.usage) user.usage = {};
  if (user.usage.periodKey !== key) {
    user.usage.periodKey = key;
    user.usage.startedInterviews = 0;
    user.markModified('usage');
  }
  return user.usage.startedInterviews ?? user.usage.completedInterviews ?? 0;
}

/**
 * @param {import('mongoose').Document} user
 */
export function getStartedInterviewsThisMonth(user) {
  syncUsagePeriod(user);
  return user.usage?.startedInterviews ?? user.usage?.completedInterviews ?? 0;
}

/**
 * @param {string} userId
 */
export async function incrementStartedInterviews(userId) {
  const user = await User.findById(userId).exec();
  if (!user) return null;
  syncUsagePeriod(user);
  user.usage.startedInterviews = (user.usage.startedInterviews ?? user.usage.completedInterviews ?? 0) + 1;
  user.markModified('usage');
  await user.save();
  return user.usage.startedInterviews;
}
