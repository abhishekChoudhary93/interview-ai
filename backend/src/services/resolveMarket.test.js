import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countryFromEdgeHeaders,
  countryFromDebug,
  countryToMarketId,
  parsePreferredMarket,
  resolveMarketContext,
} from './resolveMarket.js';

function req(h = {}, q = {}) {
  return { headers: h, query: q };
}

test('countryFromEdgeHeaders reads CF-IPCountry', () => {
  assert.equal(countryFromEdgeHeaders({ 'cf-ipcountry': 'de' }), 'DE');
});

test('countryFromEdgeHeaders prefers CF over Vercel', () => {
  assert.equal(
    countryFromEdgeHeaders({ 'cf-ipcountry': 'US', 'x-vercel-ip-country': 'FR' }),
    'US'
  );
});

test('countryFromDebug only when allowed', () => {
  assert.equal(
    countryFromDebug({
      headers: { 'x-debug-country': 'IN' },
      query: {},
      allowDebugOverrides: false,
    }),
    null
  );
  assert.equal(
    countryFromDebug({
      headers: { 'x-debug-country': 'IN' },
      query: {},
      allowDebugOverrides: true,
    }),
    'IN'
  );
});

test('countryFromDebug query debugCountry when allowed', () => {
  assert.equal(
    countryFromDebug({
      headers: {},
      query: { debugCountry: 'fr' },
      allowDebugOverrides: true,
    }),
    'FR'
  );
});

test('countryToMarketId maps regions', () => {
  assert.equal(countryToMarketId('US'), 'US');
  assert.equal(countryToMarketId('IN'), 'IN');
  assert.equal(countryToMarketId('DE'), 'EU');
  assert.equal(countryToMarketId('GB'), 'EU');
  assert.equal(countryToMarketId('JP'), 'ROW');
  assert.equal(countryToMarketId(null), null);
});

test('parsePreferredMarket validates', () => {
  assert.equal(parsePreferredMarket('eu'), 'EU');
  assert.equal(parsePreferredMarket('XX'), null);
});

test('resolveMarketContext: debug country beats edge', () => {
  const ctx = resolveMarketContext({
    req: req({ 'cf-ipcountry': 'US', 'x-debug-country': 'IN' }),
    allowDebugOverrides: true,
    defaultMarketId: 'ROW',
  });
  assert.equal(ctx.country, 'IN');
  assert.equal(ctx.marketId, 'IN');
  assert.equal(ctx.paymentProvider, 'razorpay');
});

test('resolveMarketContext: preferred market overrides country', () => {
  const ctx = resolveMarketContext({
    req: req({ 'cf-ipcountry': 'US', 'x-preferred-market': 'EU' }),
    allowDebugOverrides: false,
    defaultMarketId: 'ROW',
  });
  assert.equal(ctx.country, 'US');
  assert.equal(ctx.marketId, 'EU');
  assert.equal(ctx.currency, 'EUR');
});

test('resolveMarketContext: default when no signals', () => {
  const ctx = resolveMarketContext({
    req: req({}, {}),
    allowDebugOverrides: false,
    defaultMarketId: 'US',
  });
  assert.equal(ctx.country, null);
  assert.equal(ctx.marketId, 'US');
});
