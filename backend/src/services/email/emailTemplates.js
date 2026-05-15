/** Resend dashboard template registry — maps logical email types to aliases. */

export const EMAIL_TEMPLATES = {
  otp: {
    alias: 'otp-template',
    variables: ['otp'],
  },
};

/** Use inline html/text instead of a Resend dashboard template. */
export const INLINE_OTP_TEMPLATE_ALIAS = 'inline';

export function getOtpTemplateConfig(templateAlias) {
  return {
    ...EMAIL_TEMPLATES.otp,
    alias: templateAlias || EMAIL_TEMPLATES.otp.alias,
  };
}

export function usesInlineOtpEmail(templateAlias) {
  const alias = (templateAlias || '').trim().toLowerCase();
  return !alias || alias === INLINE_OTP_TEMPLATE_ALIAS;
}

export function buildOtpEmailContent(otp) {
  const code = String(otp);
  const subject = 'Your InterviewAI sign-in code';
  const text = [
    'Your InterviewAI verification code is:',
    '',
    code,
    '',
    'This code expires in a few minutes. If you did not request it, you can ignore this email.',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
  <p>Your InterviewAI verification code is:</p>
  <p style="font-size: 28px; font-weight: 700; letter-spacing: 0.2em; margin: 24px 0;">${code}</p>
  <p style="color: #555;">This code expires in a few minutes. If you did not request it, you can ignore this email.</p>
</body>
</html>`;
  return { subject, html, text };
}
