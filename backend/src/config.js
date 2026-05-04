/**
 * Central config from environment. Set variables per environment (local vs production)
 * — see root `.env.local` and `.env.production`.
 */

const DEV_JWT_PLACEHOLDERS = new Set([
  'dev-insecure-change-me',
  'dev-jwt-secret-change-in-production',
]);

const DEV_JWT_REFRESH_SUFFIX = ':interview-ai-refresh-v1';

function envString(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return v;
}

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

function parseAppEnv() {
  const raw = (process.env.APP_ENV || 'local').toLowerCase();
  if (raw === 'local' || raw === 'development' || raw === 'production' || raw === 'test') {
    return raw;
  }
  return 'local';
}

function parseOrigins(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const appEnv = parseAppEnv();

function resolveJwtRefreshSecret() {
  const explicit = process.env.JWT_REFRESH_SECRET;
  if (explicit !== undefined && explicit !== '') return explicit;
  if (appEnv === 'production') return '';
  const base = envString('JWT_SECRET', 'dev-insecure-change-me');
  return `${base}${DEV_JWT_REFRESH_SUFFIX}`;
}

function parseTrustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') return false;
  if (raw === 'true' || raw === '1') return true;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  return false;
}

export const config = {
  appEnv,
  get isProduction() {
    return appEnv === 'production';
  },
  get isLocalLike() {
    return appEnv === 'local' || appEnv === 'development';
  },
  /** Demo DB seed is allowed only in local-like environments. */
  get allowDemoSeed() {
    return this.isLocalLike;
  },
  /** Whether startup should run demo seed (config flag + environment gate). */
  get shouldRunSeedOnStartup() {
    return envBool('SEED_ON_START', false) && this.allowDemoSeed;
  },
  /** Whether SEED_ON_START was set (used for logging when seed is refused). */
  get seedOnStartRequested() {
    return envBool('SEED_ON_START', false);
  },
  port: Number(envString('PORT', '3001')) || 3001,
  mongodbUri: envString('MONGODB_URI', 'mongodb://127.0.0.1:27017/interview_ai'),
  jwtSecret: envString('JWT_SECRET', 'dev-insecure-change-me'),
  jwtRefreshSecret: resolveJwtRefreshSecret(),
  jwtAccessExpiresIn: envString('JWT_ACCESS_EXPIRES_IN', '15m'),
  jwtRefreshExpiresIn: envString('JWT_REFRESH_EXPIRES_IN', '30d'),
  frontendOrigins: parseOrigins(envString('FRONTEND_ORIGIN', 'http://localhost:5173')),
  demoUser: {
    email: envString('DEMO_USER_EMAIL', 'demo@interview-ai.local').toLowerCase(),
    password: envString('DEMO_USER_PASSWORD', 'demo123456'),
    name: envString('DEMO_USER_NAME', 'Demo User'),
  },
  /** Set OPENROUTER_API_KEY to use OpenRouter; if unset, the mock LLM is used (dev-only). */
  openRouterApiKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  /** Universal fallback model when a per-tier override is not configured. */
  openRouterModel: envString('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
  openRouterBaseUrl: envString('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
  openRouterHttpReferer: envString(
    'OPENROUTER_HTTP_REFERER',
    parseOrigins(envString('FRONTEND_ORIGIN', 'http://localhost:5173'))[0] || 'http://localhost:5173'
  ),
  openRouterAppTitle: envString('OPENROUTER_APP_TITLE', 'InterviewAI'),
  /**
   * Streaming interviewer voice — the call the candidate actually hears.
   *
   * Default is `openai/gpt-4o` so the conversational tier shares the same
   * billing path as the other OpenAI tiers; any OpenRouter account that can
   * call gpt-4o-mini can usually also call gpt-4o. For the most natural
   * pacing/persona, override this with `anthropic/claude-3.5-sonnet`
   * (requires Anthropic-model access on your OpenRouter account).
   */
  openRouterConversationalModel: envString(
    'OPENROUTER_CONVERSATIONAL_MODEL',
    'openai/gpt-4o'
  ),
  /** Background JSON eval call after each turn (rubric signals + section progress). */
  openRouterEvalModel: envString('OPENROUTER_EVAL_MODEL', 'openai/gpt-4o-mini'),
  /** One-shot final debrief / report at the end of the interview. */
  openRouterDebriefModel: envString('OPENROUTER_DEBRIEF_MODEL', 'openai/gpt-4o'),
  /** Opening framing call at session start. */
  openRouterOpeningModel: envString('OPENROUTER_OPENING_MODEL', 'openai/gpt-4o-mini'),
  /** Cross-session history signal extraction (interviewCompleteService). */
  openRouterExtractionModel: envString('OPENROUTER_EXTRACTION_MODEL', ''),
  /** When true or a hop count, Express trusts X-Forwarded-* from proxies (see README). */
  trustProxy: parseTrustProxy(),
  /** ISO country unknown → use this market (US | EU | IN | ROW). */
  defaultMarketId: envString('DEFAULT_MARKET_ID', 'ROW').toUpperCase(),
};

/**
 * Effective OpenRouter model for a tier (falls back to openRouterModel).
 * Tiers map to call purpose: 'conversational' (streaming interviewer), 'eval'
 * (per-turn rubric capture), 'debrief' (final report), 'opening' (session start),
 * 'extraction' (cross-session history signals).
 */
export function resolveOpenRouterModel(tier) {
  const m =
    tier === 'conversational'
      ? config.openRouterConversationalModel
      : tier === 'eval'
        ? config.openRouterEvalModel
        : tier === 'debrief'
          ? config.openRouterDebriefModel
          : tier === 'opening'
            ? config.openRouterOpeningModel
            : tier === 'extraction'
              ? config.openRouterExtractionModel
              : '';
  return (m && m.trim()) || config.openRouterModel;
}

/**
 * Fail fast when production is misconfigured (weak defaults).
 */
export function assertConfigValid() {
  if (!config.isProduction) return;
  if (!config.jwtSecret || config.jwtSecret.length < 24) {
    throw new Error(
      '[config] Production requires JWT_SECRET to be set to a long random value (at least 24 characters).'
    );
  }
  if (DEV_JWT_PLACEHOLDERS.has(config.jwtSecret)) {
    throw new Error(
      '[config] Production requires JWT_SECRET to be set to a strong secret (not a dev placeholder).'
    );
  }
  if (!config.jwtRefreshSecret || config.jwtRefreshSecret.length < 24) {
    throw new Error(
      '[config] Production requires JWT_REFRESH_SECRET to be set to a long random value (at least 24 characters), distinct from JWT_SECRET.'
    );
  }
  if (config.jwtRefreshSecret === config.jwtSecret) {
    throw new Error('[config] Production requires JWT_REFRESH_SECRET to differ from JWT_SECRET.');
  }
  if (DEV_JWT_PLACEHOLDERS.has(config.jwtRefreshSecret)) {
    throw new Error(
      '[config] Production requires JWT_REFRESH_SECRET to be a strong secret (not a dev placeholder).'
    );
  }
}
