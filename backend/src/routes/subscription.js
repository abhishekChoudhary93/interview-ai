import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
import { User, defaultSubscriptionFields } from '../models/User.js';
import { getEntitlementsForUser } from '../services/entitlementsService.js';
import { isRazorpayConfigured } from '../services/razorpayService.js';

const router = express.Router();
router.use(authMiddleware);

function toUserObjectId(userId) {
  const s = String(userId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function subscriptionPayload(user, entitlements) {
  const sub = user.subscription ?? {};
  return {
    subscription: {
      plan: sub.plan ?? 'starter',
      status: sub.status ?? 'active',
      currentPeriodStart: sub.currentPeriodStart ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      lastPaymentAt: sub.lastPaymentAt ?? null,
    },
    usage: {
      periodKey: user.usage?.periodKey ?? null,
      completedInterviews: user.usage?.completedInterviews ?? 0,
    },
    entitlements,
    razorpayConfigured: isRazorpayConfigured(),
  };
}

router.get('/', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(userObjectId).exec();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const entitlements = await getEntitlementsForUser(user);
    return res.json(subscriptionPayload(user, entitlements));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to load subscription' });
  }
});

function allowDevSetPlan(req) {
  if (!config.isProduction) return true;
  const secret = config.subscriptionAdminSecret;
  if (!secret) return false;
  return req.headers['x-subscription-admin-secret'] === secret;
}

/**
 * Dev / admin: set plan without payment. Body: { plan, daysRemaining? }
 */
router.post('/dev/set-plan', async (req, res) => {
  try {
    if (!allowDevSetPlan(req)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const { plan, daysRemaining } = req.body || {};
    if (!plan || !['starter', 'pro', 'elite'].includes(plan)) {
      return res.status(400).json({ error: 'plan must be starter, pro, or elite' });
    }

    const user = await User.findById(userObjectId).exec();
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.subscription) user.subscription = defaultSubscriptionFields().subscription;
    user.subscription.plan = plan;

    if (plan === 'starter') {
      user.subscription.status = 'active';
      user.subscription.currentPeriodStart = undefined;
      user.subscription.currentPeriodEnd = undefined;
    } else {
      const days = Number(daysRemaining) > 0 ? Number(daysRemaining) : 30;
      const now = new Date();
      user.subscription.status = 'active';
      user.subscription.currentPeriodStart = now;
      const end = new Date(now);
      end.setUTCDate(end.getUTCDate() + days);
      user.subscription.currentPeriodEnd = end;
      user.subscription.lastPaymentAt = now;
    }
    user.markModified('subscription');
    await user.save();

    const entitlements = await getEntitlementsForUser(user);
    return res.json(subscriptionPayload(user, entitlements));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to set plan' });
  }
});

export default router;
