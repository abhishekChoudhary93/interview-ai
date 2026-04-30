/**
 * Minimal Cookie header parser (no cookie-parser dependency).
 */
export function cookieParseMiddleware(req, _res, next) {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (!raw) {
    next();
    return;
  }
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        req.cookies[k] = decodeURIComponent(v);
      } catch {
        req.cookies[k] = v;
      }
    }
  }
  next();
}
