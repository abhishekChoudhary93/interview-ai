import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const AUTH_COOKIES = {
  access: 'interview_ai_access',
  refresh: 'interview_ai_refresh',
};

function cookieBase() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
  };
}

/** Access JWT is sent only to `/api/*` routes. */
export function accessCookieOptions() {
  return {
    ...cookieBase(),
    path: '/api',
    maxAge: msFromJwtExpiresIn(config.jwtAccessExpiresIn),
  };
}

/** Refresh JWT is sent only to `/api/auth/*` to limit exposure. */
export function refreshCookieOptions() {
  return {
    ...cookieBase(),
    path: '/api/auth',
    maxAge: msFromJwtExpiresIn(config.jwtRefreshExpiresIn),
  };
}

function msFromJwtExpiresIn(exp) {
  const m = String(exp).trim().match(/^(\d+)([smhd])$/i);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const mult = u === 's' ? 1000 : u === 'm' ? 60 * 1000 : u === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return n * mult;
}

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId, typ: 'access' }, config.jwtSecret, {
    expiresIn: config.jwtAccessExpiresIn,
  });
}

export function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, typ: 'refresh' }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiresIn,
  });
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwtRefreshSecret);
  if (payload.typ !== 'refresh' || !payload.sub) {
    throw new Error('Invalid refresh token');
  }
  return String(payload.sub);
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function getAccessToken(req) {
  const fromCookie = req.cookies?.[AUTH_COOKIES.access];
  if (fromCookie) return fromCookie;
  return getBearerToken(req);
}

export function authMiddleware(req, res, next) {
  const token = getAccessToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.typ && payload.typ !== 'access') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function setAuthCookies(res, userId) {
  const access = signAccessToken(userId);
  const refresh = signRefreshToken(userId);
  res.cookie(AUTH_COOKIES.access, access, accessCookieOptions());
  res.cookie(AUTH_COOKIES.refresh, refresh, refreshCookieOptions());
}

export function clearAuthCookies(res) {
  res.clearCookie(AUTH_COOKIES.access, {
    path: '/api',
    secure: config.isProduction,
    sameSite: 'lax',
    httpOnly: true,
  });
  res.clearCookie(AUTH_COOKIES.refresh, {
    path: '/api/auth',
    secure: config.isProduction,
    sameSite: 'lax',
    httpOnly: true,
  });
}
