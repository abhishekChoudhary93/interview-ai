import { apiRequest } from './httpClient.js';

export function fetchSubscription() {
  return apiRequest('/api/subscription');
}

/** Dev / local only — set plan without payment */
export function devSetPlan({ plan, daysRemaining }) {
  return apiRequest('/api/subscription/dev/set-plan', {
    method: 'POST',
    body: { plan, daysRemaining },
  });
}
