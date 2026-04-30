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

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'email, password, and fullName are required' });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash,
      fullName: String(fullName).trim(),
    });
    setAuthCookies(res, user._id.toString());
    return res.status(201).json({
      user: { id: user._id.toString(), email: user.email, full_name: user.fullName },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    setAuthCookies(res, user._id.toString());
    return res.json({
      user: { id: user._id.toString(), email: user.email, full_name: user.fullName },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Login failed' });
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
