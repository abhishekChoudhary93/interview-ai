import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import { Interview } from '../models/Interview.js';
import { config } from '../config.js';
import { resolveTemplateId } from '../services/templateResolve.js';
import {
  startInterviewSession,
  processInterviewTurn,
} from '../services/interviewSessionService.js';
import { finalizeOrchestratedInterview } from '../services/interviewCompleteService.js';
import { recordSessionEndMetadata } from '../services/interviewDebriefContext.js';
import { YEARS_EXPERIENCE_BANDS } from '../services/interviewLevel.js';

const router = express.Router();
router.use(authMiddleware);

function toUserObjectId(userId) {
  const s = String(userId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  try {
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
}

function toIso(d = new Date()) {
  return d.toISOString();
}

/**
 * Plain transcript for clients (avoids Mongoose subdoc / JSON edge cases).
 * Mirrors frontend buildReportTranscriptMessages: turns first, else questions Q/A.
 * @param {Record<string, unknown>} interviewPlain from doc.toObject()
 */
export function buildTranscriptMessagesForApi(interviewPlain) {
  const rawTurns = interviewPlain.conversation_turns;
  const turns = Array.isArray(rawTurns)
    ? rawTurns.map((t) => (t && typeof t.toObject === 'function' ? t.toObject() : t)).filter(Boolean)
    : [];

  const messages = [];
  for (const t of turns) {
    const content = t?.content != null ? String(t.content).trim() : '';
    if (!content) continue;
    const role = String(t?.role || '').toLowerCase() === 'interviewer' ? 'interviewer' : 'candidate';
    messages.push({ role, content });
  }

  const orchestrated = Boolean(interviewPlain.template_id && interviewPlain.execution_plan);
  if (orchestrated && messages[0]?.role === 'candidate') {
    const recovered = String(interviewPlain.questions?.[0]?.question || '').trim();
    const opening = String(interviewPlain.orchestrator_state?.pending_question_text || '').trim();
    if (recovered) {
      messages.unshift({ role: 'interviewer', content: recovered });
    } else if (opening) {
      messages.unshift({ role: 'interviewer', content: opening });
    }
  }

  if (messages.length > 0) {
    return messages;
  }

  const qs = Array.isArray(interviewPlain.questions) ? interviewPlain.questions : [];
  for (const q of qs) {
    const qt = q?.question != null ? String(q.question).trim() : '';
    if (qt) messages.push({ role: 'interviewer', content: qt });
    const an = q?.answer != null ? String(q.answer).trim() : '';
    if (an) messages.push({ role: 'candidate', content: an });
  }
  return messages;
}

/**
 * @param {import('mongoose').Document | Record<string, unknown>} doc
 * @param {{ includeTranscript?: boolean }} [options]
 */
export function serializeInterviewDoc(doc, options = {}) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const {
    _id,
    userId,
    clientId,
    __v,
    createdAt,
    updatedAt,
    ...rest
  } = o;
  const out = {
    id: clientId,
    orchestration_enabled: config.orchestrationEnabled,
    ...rest,
  };
  if (options.includeTranscript) {
    out.transcript_messages = buildTranscriptMessagesForApi(o);
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { status, sort = '-created_date', limit = '50' } = req.query;
    const q = { userId: userObjectId };
    if (status) q.status = status;
    const lim = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortDir = sort.startsWith('-') ? -1 : 1;
    const list = await Interview.find(q)
      .sort({ [sortField]: sortDir })
      .limit(lim)
      .exec();
    return res.json(list.map((d) => serializeInterviewDoc(d)));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'List failed' });
  }
});

/** POST body (orchestrated interviews): role_title, role_track, company, experience_level, years_experience_band (0_2|2_5|5_8|8_12|12_plus), interview_type, interview_mode, industry (optional). */
router.post('/', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const body = req.body || {};
    const clientId =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `iv-${Date.now()}`;

    const yb = body.years_experience_band;
    if (yb != null && yb !== '' && !YEARS_EXPERIENCE_BANDS.includes(String(yb))) {
      return res.status(400).json({
        error: `Invalid years_experience_band. Allowed: ${YEARS_EXPERIENCE_BANDS.join(', ')}`,
      });
    }

    let template_id;
    let template_version;
    if (config.orchestrationEnabled) {
      const r = resolveTemplateId({
        role_title: body.role_title,
        role_track: body.role_track,
        experience_level: body.experience_level,
        interview_type: body.interview_type,
        industry: body.industry,
        template_id: body.template_id,
      });
      template_id = r.template_id;
      template_version = r.template_version;
    }

    const row = await Interview.create({
      userId: userObjectId,
      clientId,
      status: body.status || 'in_progress',
      created_date: body.created_date || toIso(),
      role_title: body.role_title,
      role_track: body.role_track,
      company: body.company,
      experience_level: body.experience_level,
      years_experience_band: body.years_experience_band || undefined,
      interview_type: body.interview_type,
      industry: body.industry || '',
      interview_mode: body.interview_mode ?? 'chat',
      duration_seconds: body.duration_seconds,
      questions: Array.isArray(body.questions) ? body.questions : [],
      template_id,
      template_version,
    });
    return res.status(201).json(serializeInterviewDoc(row));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Create failed' });
  }
});

router.post('/:clientId/session/start', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    if (!config.orchestrationEnabled) {
      return res.status(400).json({ error: 'Orchestration disabled' });
    }
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.template_id) {
      return res.status(400).json({ error: 'Interview has no template — legacy flow only' });
    }
    const result = await startInterviewSession(doc);
    return res.json({
      id: doc.clientId,
      ...result,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Session start failed' });
  }
});

router.post('/:clientId/session/turn', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const candidate_message = req.body?.candidate_message ?? req.body?.message;
    if (!candidate_message || typeof candidate_message !== 'string') {
      return res.status(400).json({ error: 'candidate_message required' });
    }
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const result = await processInterviewTurn(doc, candidate_message.trim());
    return res.json({
      id: doc.clientId,
      ...result,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Turn failed' });
  }
});

router.post('/:clientId/session/complete', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.execution_plan) {
      return res.status(400).json({ error: 'Not an orchestrated interview' });
    }
    if (doc.status === 'completed') {
      return res.json(serializeInterviewDoc(doc, { includeTranscript: true }));
    }
    if (!Array.isArray(doc.questions) || doc.questions.length === 0) {
      return res.status(400).json({
        error: 'Answer at least one question before ending the session so we can generate a report.',
      });
    }
    let candidateEndedEarlyFromUi = false;
    if (doc.orchestrator_state && !doc.orchestrator_state.interview_done) {
      candidateEndedEarlyFromUi = true;
      doc.orchestrator_state.interview_done = true;
      doc.orchestrator_state.pending_question_text = '';
      if (!Array.isArray(doc.conversation_turns)) doc.conversation_turns = [];
      doc.conversation_turns.push({
        role: 'interviewer',
        content:
          'You ended the session here — we will generate feedback from everything you shared so far.',
        kind: 'early_complete',
      });
    }
    recordSessionEndMetadata(doc, {
      candidateTriggeredEnd: candidateEndedEarlyFromUi,
      source: candidateEndedEarlyFromUi ? 'session_complete' : 'session_complete_report',
    });
    await finalizeOrchestratedInterview(doc);
    return res.json(serializeInterviewDoc(doc, { includeTranscript: true }));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Complete failed' });
  }
});

router.get('/:clientId', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.json(serializeInterviewDoc(doc, { includeTranscript: true }));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Get failed' });
  }
});

router.patch('/:clientId', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const patch = { ...req.body };
    delete patch.id;
    delete patch.clientId;
    delete patch.userId;
    Object.assign(doc, patch);
    await doc.save();
    return res.json(serializeInterviewDoc(doc, { includeTranscript: true }));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.delete('/:clientId', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const r = await Interview.deleteOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    }).exec();
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Delete failed' });
  }
});

export default router;
