import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { sendOtpEmail } from './email/emailService.js';

const OTP_PURPOSES = ['register', 'login'];

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function expiresAtFromNow() {
  return new Date(Date.now() + config.otpExpiresMinutes * 60 * 1000);
}

export class OtpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OtpError';
    this.statusCode = statusCode;
  }
}

/**
 * Create or replace an OTP challenge and send the email.
 * @param {{ email: string, purpose: 'register'|'login', pendingFullName?: string, pendingPasswordHash?: string }} opts
 */
export async function createAndSendOtp({ email, purpose, pendingFullName, pendingPasswordHash }) {
  if (!OTP_PURPOSES.includes(purpose)) {
    throw new OtpError('Invalid OTP purpose');
  }

  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new OtpError('Email is required');
  }

  const existing = await OtpChallenge.findOne({ email: normalized, purpose });
  if (existing?.lastSentAt) {
    const elapsed = Date.now() - new Date(existing.lastSentAt).getTime();
    const cooldownMs = config.otpResendCooldownSeconds * 1000;
    if (elapsed < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
      throw new OtpError(`Please wait ${waitSec} seconds before requesting a new code`, 429);
    }
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);

  await OtpChallenge.findOneAndUpdate(
    { email: normalized, purpose },
    {
      email: normalized,
      purpose,
      codeHash,
      expiresAt: expiresAtFromNow(),
      attempts: 0,
      lastSentAt: new Date(),
      pendingFullName: pendingFullName ?? undefined,
      pendingPasswordHash: pendingPasswordHash ?? undefined,
    },
    { upsert: true, new: true }
  );

  await sendOtpEmail({ to: normalized, otp: code });

  return { ok: true };
}

/**
 * Verify OTP and return challenge payload (deleted on success).
 * @returns {{ email: string, purpose: string, pendingFullName?: string, pendingPasswordHash?: string }}
 */
export async function verifyOtp({ email, code, purpose }) {
  if (!OTP_PURPOSES.includes(purpose)) {
    throw new OtpError('Invalid OTP purpose');
  }

  const normalized = normalizeEmail(email);
  const codeStr = String(code || '').trim();
  if (!normalized || !codeStr) {
    throw new OtpError('Email and code are required');
  }

  const challenge = await OtpChallenge.findOne({ email: normalized, purpose });
  if (!challenge) {
    throw new OtpError('Invalid or expired code', 401);
  }

  if (new Date() > challenge.expiresAt) {
    await OtpChallenge.deleteOne({ _id: challenge._id });
    throw new OtpError('Invalid or expired code', 401);
  }

  if (challenge.attempts >= config.otpMaxAttempts) {
    await OtpChallenge.deleteOne({ _id: challenge._id });
    throw new OtpError('Too many attempts. Request a new code.', 401);
  }

  const valid = await bcrypt.compare(codeStr, challenge.codeHash);
  if (!valid) {
    challenge.attempts += 1;
    await challenge.save();
    throw new OtpError('Invalid or expired code', 401);
  }

  const payload = {
    email: challenge.email,
    purpose: challenge.purpose,
    pendingFullName: challenge.pendingFullName,
    pendingPasswordHash: challenge.pendingPasswordHash,
  };

  await OtpChallenge.deleteOne({ _id: challenge._id });
  return payload;
}
