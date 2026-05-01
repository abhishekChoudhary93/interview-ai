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

export function serializeInterviewDoc(doc) {
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
  return {
    id: clientId,
    orchestration_enabled: config.orchestrationEnabled,
    ...rest,
  };
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

router.post('/', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const body = req.body || {};
    const clientId =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `iv-${Date.now()}`;

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
      return res.json(serializeInterviewDoc(doc));
    }
    await finalizeOrchestratedInterview(doc);
    return res.json(serializeInterviewDoc(doc));
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
    return res.json(serializeInterviewDoc(doc));
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
    return res.json(serializeInterviewDoc(doc));
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
