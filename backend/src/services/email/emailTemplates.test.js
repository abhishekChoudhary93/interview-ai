import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOtpTemplateConfig,
  EMAIL_TEMPLATES,
  usesInlineOtpEmail,
  buildOtpEmailContent,
  INLINE_OTP_TEMPLATE_ALIAS,
} from './emailTemplates.js';

describe('emailTemplates', () => {
  test('OTP template uses otp-template alias and otp variable only', () => {
    const cfg = getOtpTemplateConfig('otp-template');
    assert.equal(cfg.alias, 'otp-template');
    assert.deepEqual(cfg.variables, ['otp']);
    assert.equal(EMAIL_TEMPLATES.otp.alias, 'otp-template');
  });

  test('custom alias override', () => {
    const cfg = getOtpTemplateConfig('my-custom-otp');
    assert.equal(cfg.alias, 'my-custom-otp');
  });

  test('inline delivery mode', () => {
    assert.equal(INLINE_OTP_TEMPLATE_ALIAS, 'inline');
    assert.equal(usesInlineOtpEmail('inline'), true);
    assert.equal(usesInlineOtpEmail(''), true);
    assert.equal(usesInlineOtpEmail('otp-template'), false);
  });

  test('buildOtpEmailContent includes code in html and text', () => {
    const { subject, html, text } = buildOtpEmailContent('123456');
    assert.match(subject, /InterviewAI/i);
    assert.match(html, /123456/);
    assert.match(text, /123456/);
  });
});
