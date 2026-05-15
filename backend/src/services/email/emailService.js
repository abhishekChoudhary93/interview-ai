import { config } from '../../config.js';
import {
  sendEmail,
  sendTemplateEmail,
  isEmailConfigured,
  logEmail,
} from './emailClient.js';
import {
  buildOtpEmailContent,
  getOtpTemplateConfig,
  usesInlineOtpEmail,
} from './emailTemplates.js';

function logDevOtpFallback(to, otp, reason) {
  logEmail('info', `OTP for ${to}: ${otp} (dev fallback — not sent via Resend)`, { reason });
}

function requireFromEmail() {
  if (config.resendFromEmail) return config.resendFromEmail;
  throw new Error(
    'RESEND_FROM_EMAIL is required to send OTP emails (e.g. InterviewAI <auth@yourdomain.com>)'
  );
}

/**
 * Send OTP via Resend. Uses a dashboard template when configured and published;
 * otherwise sends inline html/text (requires RESEND_FROM_EMAIL).
 */
export async function sendOtpEmail({ to, otp }) {
  const otpStr = String(otp);
  logEmail('info', 'OTP send requested', {
    to,
    mode: config.resendOtpTemplateAlias || 'inline',
  });

  if (!isEmailConfigured()) {
    if (config.isLocalLike) {
      logDevOtpFallback(to, otpStr, 'RESEND_API_KEY not set');
      return { id: 'dev-console' };
    }
    throw new Error('Email delivery is not configured');
  }

  if (usesInlineOtpEmail(config.resendOtpTemplateAlias)) {
    const result = await sendInlineOtpEmail({ to, otp: otpStr });
    logEmail('info', 'OTP email queued via Resend (inline)', { to, resendId: result?.id });
    return result;
  }

  const { alias } = getOtpTemplateConfig(config.resendOtpTemplateAlias);
  try {
    const result = await sendTemplateEmail({
      to,
      from: config.resendFromEmail || undefined,
      templateId: alias,
      variables: { otp: otpStr },
    });
    logEmail('info', 'OTP email queued via Resend (template)', { to, templateId: alias, resendId: result?.id });
    return result;
  } catch (err) {
    const message = err?.message || '';
    const templateUnavailable =
      /missing `html` or `text`/i.test(message) ||
      /template/i.test(message) ||
      /not found/i.test(message);

    if (!templateUnavailable) throw err;

    console.warn(
      `[email] Resend template "${alias}" failed (${message}); sending inline OTP email`
    );
    const result = await sendInlineOtpEmail({ to, otp: otpStr });
    logEmail('info', 'OTP email queued via Resend (inline fallback)', { to, resendId: result?.id });
    return result;
  }
}

async function sendInlineOtpEmail({ to, otp }) {
  const { subject, html, text } = buildOtpEmailContent(otp);
  const from = requireFromEmail();
  return sendEmail({ to, from, subject, html, text });
}
