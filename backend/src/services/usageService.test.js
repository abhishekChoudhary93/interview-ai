import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncUsagePeriod,
  resolveQuotaPeriod,
  getInterviewsUsedInPeriod,
  resetUsageForNewSubscriptionPeriod,
} from './usageService.js';

function mockUser(overrides = {}) {
  return {
    subscription: { plan: 'starter', status: 'active' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    usage: {},
    markModified() {},
    isModified() {
      return false;
    },
    ...overrides,
  };
}

test('syncUsagePeriod resets interviewsUsed when quota period ended', () => {
  const pastEnd = new Date('2026-01-01T00:00:00Z');
  const user = mockUser({
    usage: {
      interviewsUsed: 3,
      quotaPeriodStart: new Date('2025-12-01T00:00:00Z'),
      quotaPeriodEnd: pastEnd,
    },
  });
  const used = syncUsagePeriod(user);
  assert.equal(used, 0);
  assert.equal(user.usage.interviewsUsed, 0);
  assert.ok(user.usage.quotaPeriodEnd > pastEnd);
});

test('resolveQuotaPeriod uses subscription dates for paid plan', () => {
  const start = new Date();
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 30);
  const user = mockUser({
    subscription: {
      plan: 'pro',
      status: 'active',
      currentPeriodStart: start,
      currentPeriodEnd: end,
    },
  });
  const period = resolveQuotaPeriod(user);
  assert.equal(period.start.getTime(), start.getTime());
  assert.equal(period.end.getTime(), end.getTime());
});

test('resetUsageForNewSubscriptionPeriod clears counter', () => {
  const user = mockUser({ usage: { interviewsUsed: 2 } });
  const start = new Date('2026-05-01T00:00:00Z');
  const end = new Date('2026-05-31T00:00:00Z');
  resetUsageForNewSubscriptionPeriod(user, { periodStart: start, periodEnd: end });
  assert.equal(user.usage.interviewsUsed, 0);
  assert.equal(user.usage.quotaPeriodStart.getTime(), start.getTime());
  assert.equal(getInterviewsUsedInPeriod(user), 0);
});
