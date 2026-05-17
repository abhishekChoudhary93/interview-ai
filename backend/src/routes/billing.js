import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { PaymentEvent } from '../models/PaymentEvent.js';
import { PLAN_AMOUNTS_INR_PAISE, isValidPaidPlan } from '../config/plans.js';
import {
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  subscriptionPeriodEndFromNow,
  isRazorpayConfigured,
} from '../services/razorpayService.js';
import { getEntitlementsForUser } from '../services/entitlementsService.js';

const router = express.Router();
router.use(authMiddleware);

function toUserObjectId(userId) {
  const s = String(userId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

router.get('/razorpay/status', (_req, res) => {
  return res.json({ configured: isRazorpayConfigured() });
});

router.post('/razorpay/create-order', async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ error: 'Razorpay is not configured' });
    }
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const { plan } = req.body || {};
    if (!isValidPaidPlan(plan)) {
      return res.status(400).json({ error: 'plan must be pro or elite' });
    }
    const order = await createRazorpayOrder(plan, userObjectId.toString());
    return res.json(order);
  } catch (e) {
    console.error(e);
    const status = e.statusCode || 500;
    return res.status(status).json({ error: e.message || 'Create order failed' });
  }
});

router.post('/razorpay/verify', async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ error: 'Razorpay is not configured' });
    }
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan,
    } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing Razorpay payment fields' });
    }
    if (!isValidPaidPlan(plan)) {
      return res.status(400).json({ error: 'plan must be pro or elite' });
    }

    if (
      !verifyRazorpayPaymentSignature({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      })
    ) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const existing = await PaymentEvent.findOne({ razorpayPaymentId: razorpay_payment_id }).exec();
    if (existing) {
      const user = await User.findById(userObjectId).exec();
      const entitlements = user ? await getEntitlementsForUser(user) : null;
      return res.json({
        ok: true,
        alreadyApplied: true,
        entitlements,
      });
    }

    const now = new Date();
    const periodEnd = subscriptionPeriodEndFromNow(now);
    const user = await User.findById(userObjectId).exec();
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.subscription) user.subscription = {};
    user.subscription.plan = plan;
    user.subscription.status = 'active';
    user.subscription.currentPeriodStart = now;
    user.subscription.currentPeriodEnd = periodEnd;
    user.subscription.lastPaymentAt = now;
    user.markModified('subscription');
    await user.save();

    await PaymentEvent.create({
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      userId: userObjectId,
      plan,
      amountPaise: PLAN_AMOUNTS_INR_PAISE[plan],
    });

    const entitlements = await getEntitlementsForUser(user);
    return res.json({ ok: true, entitlements });
  } catch (e) {
    console.error(e);
    const status = e.statusCode || 500;
    return res.status(status).json({ error: e.message || 'Verify failed' });
  }
});

export default router;
