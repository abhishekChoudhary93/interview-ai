import { apiRequest } from './httpClient.js';
import { clearToken } from '@/lib/authToken.js';

export async function registerRequest({ email, password, fullName }) {
  return apiRequest('/api/auth/register/request', {
    method: 'POST',
    body: { email, password, fullName },
    skipAuth: true,
  });
}

export async function registerVerify({ email, code }) {
  const data = await apiRequest('/api/auth/register/verify', {
    method: 'POST',
    body: { email, code },
    skipAuth: true,
  });
  return normalizeUser(data.user);
}

export async function login({ email, password }) {
  const data = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuth: true,
  });
  return normalizeUser(data.user);
}

export async function sendLoginOtp({ email }) {
  return apiRequest('/api/auth/otp/send', {
    method: 'POST',
    body: { email, purpose: 'login' },
    skipAuth: true,
  });
}

export async function verifyLoginOtp({ email, code }) {
  const data = await apiRequest('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code, purpose: 'login' },
    skipAuth: true,
  });
  return normalizeUser(data.user);
}

export async function fetchMe() {
  const u = await apiRequest('/api/auth/me');
  return normalizeUser(u);
}

export async function logoutApi() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', skipAuth: true });
  } catch {
    // Still clear client state if the network fails.
  }
  clearToken();
}

export function logoutClient() {
  clearToken();
}

function normalizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role || 'user',
  };
}
