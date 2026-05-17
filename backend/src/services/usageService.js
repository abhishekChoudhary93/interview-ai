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
    user.usage.completedInterviews = 0;
    user.markModified('usage');
  }
  return user.usage.completedInterviews ?? 0;
}

/**
 * @param {import('mongoose').Document} user
 */
export function getCompletedInterviewsThisMonth(user) {
  syncUsagePeriod(user);
  return user.usage?.completedInterviews ?? 0;
}

/**
 * @param {string} userId
 */
export async function incrementCompletedInterviews(userId) {
  const user = await User.findById(userId).exec();
  if (!user) return null;
  syncUsagePeriod(user);
  user.usage.completedInterviews = (user.usage.completedInterviews ?? 0) + 1;
  user.markModified('usage');
  await user.save();
  return user.usage.completedInterviews;
}
