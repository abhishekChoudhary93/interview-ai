import { EU_ISO_COUNTRIES, MARKET_IDS, MARKETS } from '../config/markets.js';

const DEBUG_COUNTRY_HEADER = 'x-debug-country';
const PREFERRED_MARKET_HEADER = 'x-preferred-market';

function normalizeIso2(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.length !== 2 || s === 'XX' || s === 'T1') return null;
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/**
 * Lowercase header names → values (Express lowercases incoming headers).
 */
export function headerMap(req) {
  const out = {};
  if (!req.headers) return out;
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v.length) out[k.toLowerCase()] = v[0];
  }
  return out;
}

/**
 * Country from CDN / proxy headers (production path).
 */
export function countryFromEdgeHeaders(h) {
  const cf = normalizeIso2(h['cf-ipcountry']);
  if (cf) return cf;
  const vercel = normalizeIso2(h['x-vercel-ip-country']);
  if (vercel) return vercel;
  const appGeo = normalizeIso2(h['x-app-geo-country']);
  if (appGeo) return appGeo;
  return null;
}

/**
 * Debug-only country from header or query (guarded by caller).
 */
export function countryFromDebug({ headers, query, allowDebugOverrides }) {
  if (!allowDebugOverrides) return null;
  const h = typeof headers === 'object' && headers ? headers : {};
  const q = typeof query === 'object' && query ? query : {};
  const fromHeader = normalizeIso2(h[DEBUG_COUNTRY_HEADER]);
  if (fromHeader) return fromHeader;
  const fromQuery = normalizeIso2(q.debugcountry ?? q.debugCountry);
  if (fromQuery) return fromQuery;
  return null;
}

export function parsePreferredMarket(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = String(raw).trim().toUpperCase();
  return MARKET_IDS.includes(id) ? id : null;
}

export function preferredMarketFromRequest(req) {
  const h = headerMap(req);
  return parsePreferredMarket(h[PREFERRED_MARKET_HEADER]);
}

/**
 * Map ISO 3166-1 alpha-2 country to market id.
 */
export function countryToMarketId(country) {
  const c = normalizeIso2(country);
  if (!c) return null;
  if (c === 'US') return 'US';
  if (c === 'IN') return 'IN';
  if (EU_ISO_COUNTRIES.has(c)) return 'EU';
  return 'ROW';
}

function clampMarketId(marketId, defaultMarketId) {
  const fallback = MARKET_IDS.includes(defaultMarketId) ? defaultMarketId : 'ROW';
  if (marketId && MARKET_IDS.includes(marketId)) return marketId;
  return fallback;
}

/**
 * Resolve market context for the public API. Mutates nothing.
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {boolean} opts.allowDebugOverrides - true when APP_ENV is local or development
 * @param {string} opts.defaultMarketId - e.g. ROW or US from config
 */
export function resolveMarketContext({ req, allowDebugOverrides, defaultMarketId }) {
  const h = headerMap(req);
  const q = req.query || {};

  const debugCountry = countryFromDebug({
    headers: h,
    query: q,
    allowDebugOverrides,
  });
  const edgeCountry = countryFromEdgeHeaders(h);
  const detectedCountry = debugCountry ?? edgeCountry ?? null;

  const preferred = preferredMarketFromRequest(req);

  const fromCountry = countryToMarketId(detectedCountry);
  const defaultM = clampMarketId(defaultMarketId, 'ROW');
  const marketId = clampMarketId(preferred ?? fromCountry ?? defaultM, defaultM);

  const block = MARKETS[marketId];
  return {
    country: detectedCountry,
    marketId,
    currency: block.currency,
    currencySymbol: block.currencySymbol,
    paymentProvider: block.paymentProvider,
    pricing: block.pricing,
    copy: block.copy,
  };
}

/** Strip gateway-internal ids from the public JSON payload. */
export function toPublicMarketPayload(ctx) {
  return {
    country: ctx.country,
    marketId: ctx.marketId,
    currency: ctx.currency,
    currencySymbol: ctx.currencySymbol,
    paymentProvider: ctx.paymentProvider,
    pricing: ctx.pricing.map(
      ({ id, name, intervalLabel, amountDisplay, highlight, features }) => ({
        id,
        name,
        intervalLabel,
        amountDisplay,
        highlight,
        features,
      })
    ),
    copy: ctx.copy,
  };
}
