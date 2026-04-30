/**
 * Central config from environment. Set variables per environment (local vs production)
 * — see root `.env.local` and `.env.production`.
 */

const DEV_JWT_PLACEHOLDERS = new Set([
  'dev-insecure-change-me',
  'dev-jwt-secret-change-in-production',
]);

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
  frontendOrigins: parseOrigins(envString('FRONTEND_ORIGIN', 'http://localhost:5173')),
  demoUser: {
    email: envString('DEMO_USER_EMAIL', 'demo@interview-ai.local').toLowerCase(),
    password: envString('DEMO_USER_PASSWORD', 'demo123456'),
    name: envString('DEMO_USER_NAME', 'Demo User'),
  },
};

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
}
