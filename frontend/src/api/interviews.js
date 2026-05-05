import { apiRequest } from './httpClient.js';
import { getToken } from '@/lib/authToken.js';

function apiBase() {
  const v = import.meta.env.VITE_API_URL;
  return v === undefined || v === '' ? '' : String(v).replace(/\/$/, '');
}

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

/**
 * Stream the interviewer's reply via Server-Sent Events.
 *
 * Browser EventSource doesn't support POST, so we use fetch + a manual SSE
 * parser. Returns a function the caller can invoke to abort the connection
 * (used when the user navigates away or aborts mid-turn).
 *
 * Events:
 *   meta  → { turn_index }            once at start
 *   token → { delta }                 N times as tokens arrive
 *   done  → { interviewer_message }   once when stream completes
 *   error → { message }               on failure
 *
 * The `state` event used to fire once after the Planner eval landed and
 * carried interview_done. The backend now runs the Planner eval as
 * fire-and-forget AFTER res.end() (so the user's UI unblocks immediately),
 * so the inline `state` event is no longer emitted. Clients that need
 * post-turn session state should poll GET /session/state on a short delay
 * after `done`. The dispatch path for `state` is kept here so an old
 * backend or a future protocol revival doesn't error the client.
 *
 * @param {string} clientId
 * @param {string} candidate_message
 * @param {{
 *   onMeta?: (data: { turn_index: number }) => void,
 *   onToken?: (delta: string) => void,
 *   onDone?: (data: { interviewer_message: string }) => void,
 *   onState?: (data: { session_state: object, interview_done: boolean }) => void,
 *   onError?: (message: string) => void,
 *   signal?: AbortSignal,
 * }} handlers
 * @returns {Promise<void>}
 */
export async function streamInterviewSessionTurn(clientId, candidate_message, handlers = {}) {
  const url = `${apiBase()}/api/interviews/${encodeURIComponent(clientId)}/session/turn`;
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ candidate_message }),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    let message = `Stream failed (${res.status})`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      /* ignore */
    }
    handlers.onError?.(message);
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  function dispatch(event, data) {
    let parsed = data;
    try {
      parsed = JSON.parse(data);
    } catch {
      /* leave as raw string */
    }
    if (event === 'meta') handlers.onMeta?.(parsed);
    else if (event === 'token') handlers.onToken?.(parsed?.delta ?? '');
    else if (event === 'done') handlers.onDone?.(parsed);
    else if (event === 'state') handlers.onState?.(parsed);
    else if (event === 'error') handlers.onError?.(parsed?.message || 'Stream error');
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let eventName = 'message';
        const dataLines = [];
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          dispatch(eventName, dataLines.join('\n'));
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

export function getInterviewSessionState(clientId) {
  return apiRequest(`/api/interviews/${encodeURIComponent(clientId)}/session/state`);
}

export function interviewSessionComplete(clientId) {
  return apiRequest(`/api/interviews/${encodeURIComponent(clientId)}/session/complete`, {
    method: 'POST',
  });
}

/**
 * Local-only debug trace fetch. Returns 404 from the backend when
 * INTERVIEW_DEBUG_TRACE is not set; the caller treats that as "feature off".
 */
export function getInterviewDebugTrace(clientId) {
  return apiRequest(`/api/interviews/${encodeURIComponent(clientId)}/debug-trace`);
}
