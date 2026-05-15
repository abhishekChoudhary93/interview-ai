import express from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import {
  authMiddleware,
  setAuthCookies,
  clearAuthCookies,
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  AUTH_COOKIES,
  accessCookieOptions,
  refreshCookieOptions,
} from '../middleware/auth.js';
import {
  createAndSendOtp,
  verifyOtp,
  normalizeEmail,
  OtpError,
} from '../services/otpService.js';

const router = express.Router();

const GENERIC_OTP_SENT = 'If an account exists for this email, we sent a verification code.';

function userPayload(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    full_name: user.fullName,
  };
}

function handleOtpError(res, e) {
  if (e instanceof OtpError) {
    return res.status(e.statusCode).json({ error: e.message });
  }
  console.error(e);
  return res.status(500).json({ error: 'Request failed' });
}

router.post('/register/request', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'email, password, and fullName are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalized = normalizeEmail(email);
    const existing = await User.findOne({ email: normalized });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await createAndSendOtp({
      email: normalized,
      purpose: 'register',
      pendingFullName: String(fullName).trim(),
      pendingPasswordHash: passwordHash,
    });

    return res.json({ ok: true, message: 'Verification code sent' });
  } catch (e) {
    return handleOtpError(res, e);
  }
});

router.post('/register/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'email and code are required' });
    }

    const payload = await verifyOtp({
      email,
      code,
      purpose: 'register',
    });

    if (!payload.pendingFullName || !payload.pendingPasswordHash) {
      return res.status(400).json({ error: 'Invalid registration session. Please start again.' });
    }

    const existing = await User.findOne({ email: payload.email });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = await User.create({
      email: payload.email,
      passwordHash: payload.pendingPasswordHash,
      fullName: payload.pendingFullName,
    });

    setAuthCookies(res, user._id.toString());
    return res.status(201).json({ user: userPayload(user) });
  } catch (e) {
    return handleOtpError(res, e);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    setAuthCookies(res, user._id.toString());
    return res.json({ user: userPayload(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/otp/send', async (req, res) => {
  try {
    const { email, purpose = 'login' } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (purpose !== 'login') {
      return res.status(400).json({ error: 'Invalid purpose' });
    }

    const normalized = normalizeEmail(email);
    const user = await User.findOne({ email: normalized });

    if (user) {
      await createAndSendOtp({ email: normalized, purpose: 'login' });
    }

    return res.json({ ok: true, message: GENERIC_OTP_SENT });
  } catch (e) {
    return handleOtpError(res, e);
  }
});

router.post('/otp/verify', async (req, res) => {
  try {
    const { email, code, purpose = 'login' } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'email and code are required' });
    }
    if (purpose !== 'login') {
      return res.status(400).json({ error: 'Invalid purpose' });
    }

    const payload = await verifyOtp({ email, code, purpose: 'login' });
    const user = await User.findOne({ email: payload.email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    setAuthCookies(res, user._id.toString());
    return res.json({ user: userPayload(user) });
  } catch (e) {
    return handleOtpError(res, e);
  }
});

router.post('/refresh', (req, res) => {
  try {
    const rt = req.cookies?.[AUTH_COOKIES.refresh];
    if (!rt) {
      return res.status(401).json({ error: 'No refresh token' });
    }
    const userId = verifyRefreshToken(rt);
    const access = signAccessToken(userId);
    const refresh = signRefreshToken(userId);
    res.cookie(AUTH_COOKIES.access, access, accessCookieOptions());
    res.cookie(AUTH_COOKIES.refresh, refresh, refreshCookieOptions());
    return res.json({ ok: true });
  } catch {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', (_req, res) => {
  clearAuthCookies(res);
  return res.json({ ok: true });
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({
      id: user._id.toString(),
      email: user.email,
      full_name: user.fullName,
      role: 'user',
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to load user' });
  }
});

export default router;
