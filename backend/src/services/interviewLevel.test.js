import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCandidateLevel, normalizeYearsExperienceBand } from './interviewLevel.js';

test('normalizeYearsExperienceBand falls back from experience_level', () => {
  assert.equal(normalizeYearsExperienceBand({ experience_level: 'mid' }), '2_5');
  assert.equal(normalizeYearsExperienceBand({ years_experience_band: '12_plus' }), '12_plus');
});

test('deriveCandidateLevel: SDM', () => {
  assert.equal(deriveCandidateLevel({ role_track: 'sdm', experience_level: 'mid' }), 'SDM');
});

test('deriveCandidateLevel: IC_STAFF from YOE or lead title band', () => {
  assert.equal(deriveCandidateLevel({ role_track: 'ic', years_experience_band: '8_12', experience_level: 'mid' }), 'IC_STAFF');
  assert.equal(deriveCandidateLevel({ role_track: 'ic', experience_level: 'lead', years_experience_band: '2_5' }), 'IC_STAFF');
});

test('deriveCandidateLevel: IC_MID', () => {
  assert.equal(deriveCandidateLevel({ role_track: 'ic', years_experience_band: '5_8', experience_level: 'senior' }), 'IC_MID');
});
