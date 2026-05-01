import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTemplateId } from './templateResolve.js';

test('explicit template_id resolves when file exists', () => {
  const r = resolveTemplateId({ template_id: 'backend_engineer_senior' });
  assert.equal(r.template_id, 'backend_engineer_senior');
  assert.equal(r.template_version, '2.1');
});

test('SDM track maps manager-style title to backend_engineer_senior', () => {
  const r = resolveTemplateId({
    role_title: 'Engineering Manager',
    role_track: 'sdm',
    experience_level: 'senior',
  });
  assert.equal(r.template_id, 'backend_engineer_senior');
});

test('Frontend Engineer resolves to frontend_engineer_mid', () => {
  const r = resolveTemplateId({ role_title: 'Frontend Engineer', experience_level: 'mid' });
  assert.equal(r.template_id, 'frontend_engineer_mid');
});

test('Backend keyword resolves to backend_engineer_senior', () => {
  const r = resolveTemplateId({ role_title: 'Backend Engineer', experience_level: 'senior' });
  assert.equal(r.template_id, 'backend_engineer_senior');
});

test('system_design interview type resolves to system_design_video_platform', () => {
  const r = resolveTemplateId({
    role_title: 'Engineering Manager',
    role_track: 'sdm',
    interview_type: 'system_design',
    experience_level: 'senior',
  });
  assert.equal(r.template_id, 'system_design_video_platform');
  assert.equal(r.template_version, '1.0');
});
