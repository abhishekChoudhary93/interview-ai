import { Resend } from 'resend';
import { config } from '../../config.js';

let resendClient = null;

function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 1) return s;
  return `${s[0]}***${s.slice(at)}`;
}

export function logEmail(level, message, extra) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  const line = `[email] ${message}${suffix}`;
  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
}

function getClient() {
  if (!config.resendApiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(config.resendApiKey);
  }
  return resendClient;
}

/**
 * Send a raw email (html/text). For future non-template transactional mail.
 */
export async function sendEmail({ to, from, subject, html, text }) {
  const client = getClient();
  if (!client) {
    throw new Error('Resend is not configured (RESEND_API_KEY missing)');
  }
  const recipients = Array.isArray(to) ? to : [to];
  logEmail('info', 'sending inline email', {
    to: recipients.map(maskEmail),
    from,
    subject,
  });
  const { data, error } = await client.emails.send({
    from,
    to: recipients,
    subject,
    html,
    text,
  });
  if (error) {
    logEmail('error', 'Resend API error (inline)', { message: error.message, name: error.name });
    throw new Error(error.message || 'Failed to send email');
  }
  logEmail('info', 'sent inline email', { id: data?.id, to: recipients.map(maskEmail) });
  return data;
}

/**
 * Send using a published Resend dashboard template.
 * Omits from/subject when the template defines them.
 */
export async function sendTemplateEmail({ to, from, subject, templateId, variables }) {
  const client = getClient();
  if (!client) {
    throw new Error('Resend is not configured (RESEND_API_KEY missing)');
  }
  const payload = {
    to: Array.isArray(to) ? to : [to],
    template: {
      id: templateId,
      variables,
    },
  };
  if (from) payload.from = from;
  if (subject) payload.subject = subject;
  const recipients = payload.to;
  logEmail('info', 'sending template email', {
    to: recipients.map(maskEmail),
    templateId,
    from: from || '(template default)',
  });
  const { data, error } = await client.emails.send(payload);
  if (error) {
    logEmail('error', 'Resend API error (template)', {
      templateId,
      message: error.message,
      name: error.name,
    });
    throw new Error(error.message || 'Failed to send template email');
  }
  logEmail('info', 'sent template email', { id: data?.id, templateId, to: recipients.map(maskEmail) });
  return data;
}

/** Startup summary — mirrors the [llm] banner pattern. */
export function logEmailStartupBanner() {
  if (!isEmailConfigured()) {
    logEmail(
      'warn',
      'RESEND_API_KEY is NOT set — OTP codes log here only (no Resend dashboard activity)'
    );
    return;
  }
  const mode = (config.resendOtpTemplateAlias || 'inline').trim();
  logEmail('info', 'Resend ENABLED', {
    otpMode: mode,
    from: config.resendFromEmail || '(required for inline)',
    dashboard: 'https://resend.com/emails',
  });
}

export function isEmailConfigured() {
  return Boolean(config.resendApiKey);
}
