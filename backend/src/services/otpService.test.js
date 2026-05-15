import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, OtpError } from './otpService.js';

describe('normalizeEmail', () => {
  test('lowercases and trims', () => {
    assert.equal(normalizeEmail('  Test@Example.COM '), 'test@example.com');
  });

  test('returns empty for missing input', () => {
    assert.equal(normalizeEmail(''), '');
    assert.equal(normalizeEmail(null), '');
  });
});

describe('OtpError', () => {
  test('carries status code', () => {
    const err = new OtpError('Too many attempts', 429);
    assert.equal(err.message, 'Too many attempts');
    assert.equal(err.statusCode, 429);
    assert.equal(err.name, 'OtpError');
  });
});
