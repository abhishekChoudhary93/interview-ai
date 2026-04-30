import { getToken, clearToken } from '@/lib/authToken.js';

function apiBase() {
  const v = import.meta.env.VITE_API_URL;
  return v === undefined || v === '' ? '' : String(v).replace(/\/$/, '');
}

let refreshPromise = null;

async function postRefresh() {
  const url = `${apiBase()}/api/auth/refresh`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    const err = new Error(data?.error || res.statusText || 'Session expired');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.json().catch(() => ({}));
}

function ensureRefresh() {
  if (!refreshPromise) {
    refreshPromise = postRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiRequest(path, { method = 'GET', body, skipAuth = false, _skipRefreshOnce = false } = {}) {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { 'Content-Type': 'application/json' };
  if (!skipAuth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (res.status === 401 && !skipAuth && !_skipRefreshOnce) {
    try {
      await ensureRefresh();
      return apiRequest(path, { method, body, skipAuth, _skipRefreshOnce: true });
    } catch {
      clearToken();
      const err = new Error(data?.error || res.statusText || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
