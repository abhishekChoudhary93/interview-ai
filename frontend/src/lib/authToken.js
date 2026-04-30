const STORAGE_KEY = 'interview_ai_access_token';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setToken(token) {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(STORAGE_KEY);
}
