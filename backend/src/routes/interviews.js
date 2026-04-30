import express from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import { Interview } from '../models/Interview.js';

const router = express.Router();
router.use(authMiddleware);

function toIso(d = new Date()) {
  return d.toISOString();
}

function serialize(doc) {
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
    ...rest,
  };
}

router.get('/', async (req, res) => {
  try {
    const { status, sort = '-created_date', limit = '50' } = req.query;
    const q = { userId: req.userId };
    if (status) q.status = status;
    const lim = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortDir = sort.startsWith('-') ? -1 : 1;
    const list = await Interview.find(q)
      .sort({ [sortField]: sortDir })
      .limit(lim)
      .exec();
    return res.json(list.map((d) => serialize(d)));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'List failed' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const clientId =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `iv-${Date.now()}`;
    const row = await Interview.create({
      userId: req.userId,
      clientId,
      status: body.status || 'in_progress',
      created_date: body.created_date || toIso(),
      role_title: body.role_title,
      company: body.company,
      experience_level: body.experience_level,
      interview_type: body.interview_type,
      industry: body.industry || '',
      interview_mode: body.interview_mode ?? 'chat',
      duration_seconds: body.duration_seconds,
      questions: Array.isArray(body.questions) ? body.questions : [],
    });
    return res.status(201).json(serialize(row));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Create failed' });
  }
});

router.get('/:clientId', async (req, res) => {
  try {
    const doc = await Interview.findOne({
      userId: req.userId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.json(serialize(doc));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Get failed' });
  }
});

router.patch('/:clientId', async (req, res) => {
  try {
    const doc = await Interview.findOne({
      userId: req.userId,
      clientId: req.params.clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const patch = { ...req.body };
    delete patch.id;
    delete patch.clientId;
    delete patch.userId;
    Object.assign(doc, patch);
    await doc.save();
    return res.json(serialize(doc));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.delete('/:clientId', async (req, res) => {
  try {
    const r = await Interview.deleteOne({
      userId: req.userId,
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
