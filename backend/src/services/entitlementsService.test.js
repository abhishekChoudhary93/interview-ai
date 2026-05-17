import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPaidPeriodActive,
  resolveEffectiveSubscription,
} from './entitlementsService.js';

test('starter is always active', () => {
  const r = resolveEffectiveSubscription({ subscription: { plan: 'starter', status: 'active' } });
  assert.equal(r.plan, 'starter');
  assert.equal(r.isActive, true);
});

test('pro with future period end is active', () => {
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const r = resolveEffectiveSubscription({
    subscription: { plan: 'pro', status: 'active', currentPeriodEnd: end },
  });
  assert.equal(r.plan, 'pro');
  assert.equal(r.isActive, true);
});

test('pro with past period end resolves to starter', () => {
  const end = new Date(Date.now() - 1000);
  const r = resolveEffectiveSubscription({
    subscription: { plan: 'pro', status: 'active', currentPeriodEnd: end },
  });
  assert.equal(r.plan, 'starter');
  assert.equal(r.isActive, false);
  assert.equal(r.previousPlan, 'pro');
});

test('canceled pro keeps access until period end', () => {
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    isPaidPeriodActive({ plan: 'pro', status: 'canceled', currentPeriodEnd: end }),
    true
  );
});
