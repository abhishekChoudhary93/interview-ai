import crypto from 'crypto';
import { config } from '../config.js';
import {
  PLAN_AMOUNTS_INR_PAISE,
  SUBSCRIPTION_PERIOD_DAYS,
  isValidPaidPlan,
} from '../config/plans.js';

function requireRazorpayConfigured() {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    const err = new Error('Razorpay is not configured on the server');
    err.statusCode = 503;
    throw err;
  }
}

/**
 * @returns {Promise<import('razorpay').default | null>}
 */
async function getRazorpayClient() {
  requireRazorpayConfigured();
  const { default: Razorpay } = await import('razorpay');
  return new Razorpay({
    key_id: config.razorpayKeyId,
    key_secret: config.razorpayKeySecret,
  });
}

/**
 * @param {'pro' | 'elite'} plan
 * @param {string} userId
 */
export async function createRazorpayOrder(plan, userId) {
  if (!isValidPaidPlan(plan)) {
    const err = new Error('Invalid plan');
    err.statusCode = 400;
    throw err;
  }
  const amount = PLAN_AMOUNTS_INR_PAISE[plan];
  const rzp = await getRazorpayClient();
  const order = await rzp.orders.create({
    amount,
    currency: 'INR',
    receipt: `sub_${plan}_${userId}_${Date.now()}`.slice(0, 40),
    notes: { plan, userId },
  });
  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: config.razorpayKeyId,
    plan,
  };
}

/**
 * @param {{ razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string }} payload
 */
export function verifyRazorpayPaymentSignature(payload) {
  requireRazorpayConfigured();
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = payload;
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(body)
    .digest('hex');
  return expected === razorpay_signature;
}

export function subscriptionPeriodEndFromNow(date = new Date()) {
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + SUBSCRIPTION_PERIOD_DAYS);
  return end;
}

export function isRazorpayConfigured() {
  return Boolean(config.razorpayKeyId && config.razorpayKeySecret);
}
