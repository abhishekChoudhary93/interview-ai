import { getToken } from '@/lib/authToken.js';

function apiBase() {
  const v = import.meta.env.VITE_API_URL;
  return v === undefined || v === '' ? '' : String(v).replace(/\/$/, '');
}

export async function apiRequest(path, { method = 'GET', body, skipAuth = false } = {}) {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { 'Content-Type': 'application/json' };
  if (!skipAuth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(url, {
    method,
    headers,
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
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
