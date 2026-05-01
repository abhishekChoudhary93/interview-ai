function apiBase() {
  const v = import.meta.env.VITE_API_URL;
  return v === undefined || v === '' ? '' : String(v).replace(/\/$/, '');
}

const ALLOWED = ['US', 'EU', 'IN', 'ROW'];

/**
 * @param {string | null | undefined} preferredMarket
 */
export async function fetchMarketContext(preferredMarket) {
  const headers = {};
  const p = preferredMarket && ALLOWED.includes(String(preferredMarket).toUpperCase())
    ? String(preferredMarket).toUpperCase()
    : null;
  if (p) headers['X-Preferred-Market'] = p;

  const url = `${apiBase()}/api/public/market-context`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Failed to load market');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
