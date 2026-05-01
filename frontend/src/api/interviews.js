import { apiRequest } from './httpClient.js';

export async function listInterviews({ status, sort = '-created_date', limit = 50 } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (sort) q.set('sort', sort);
  if (limit) q.set('limit', String(limit));
  const qs = q.toString();
  return apiRequest(`/api/interviews${qs ? `?${qs}` : ''}`);
}

export function createInterview(payload) {
  return apiRequest('/api/interviews', { method: 'POST', body: payload });
}

export function getInterview(id) {
  return apiRequest(`/api/interviews/${encodeURIComponent(id)}`);
}

export function updateInterview(id, patch) {
  return apiRequest(`/api/interviews/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export function deleteInterview(id) {
  return apiRequest(`/api/interviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function startInterviewSession(clientId) {
  return apiRequest(`/api/interviews/${encodeURIComponent(clientId)}/session/start`, {
    method: 'POST',
  });
}

export function interviewSessionTurn(clientId, candidate_message) {
  return apiRequest(`/api/interviews/${encodeURIComponent(clientId)}/session/turn`, {
    method: 'POST',
    body: { candidate_message },
  });
}

export function interviewSessionComplete(clientId) {
  return apiRequest(`/api/interviews/${encodeURIComponent(clientId)}/session/complete`, {
    method: 'POST',
  });
}
