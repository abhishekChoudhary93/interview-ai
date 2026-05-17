import { apiRequest } from './httpClient.js';

export function fetchRazorpayStatus() {
  return apiRequest('/api/billing/razorpay/status');
}

export function createRazorpayOrder(plan) {
  return apiRequest('/api/billing/razorpay/create-order', {
    method: 'POST',
    body: { plan },
  });
}

export function verifyRazorpayPayment(payload) {
  return apiRequest('/api/billing/razorpay/verify', {
    method: 'POST',
    body: payload,
  });
}
