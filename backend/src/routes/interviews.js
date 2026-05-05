import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import { Interview } from '../models/Interview.js';
import { loadInterviewConfig, INTERVIEW_CONFIG_ID } from '../services/interviewConfig.js';
import {
  startInterviewSession,
  appendCandidateTurn,
  appendInterviewerTurn,
  runBackgroundEvalCapture,
  runForegroundEvalCapture,
  recordDebugTraceEntry,
  streamInterviewerReply,
  YEARS_EXPERIENCE_BANDS,
} from '../services/interviewSessionService.js';
import { finalizeOrchestratedInterview } from '../services/interviewCompleteService.js';
import { recordSessionEndMetadata } from '../services/interviewDebriefContext.js';
import { resolveTargetLevel, isValidTargetLevel } from '../config/targetLevels.js';

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

  const orchestrated = Boolean(
    interviewPlain.template_id && (interviewPlain.interview_config || interviewPlain.execution_plan)
  );
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
  const { _id, userId, clientId, __v, createdAt, updatedAt, ...rest } = o;
  const out = {
    id: clientId,
    ...rest,
  };
  if (options.includeTranscript) {
    out.transcript_messages = buildTranscriptMessagesForApi(o);
  }
  return out;
}

/* ---------------- SSE helpers ---------------- */

function openSseStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering if present
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Per-interview in-flight Planner eval promise. v5 Planner-first flow uses
 * background eval ONLY for T1 (the very first candidate turn after the intro
 * line) — T1's Executor reply is the deterministic problem-statement handoff,
 * so we don't need Planner before it; we let the eval classify T1 in the
 * background to keep TTI snappy. T2+ runs Planner inline before the Executor.
 *
 * The next turn awaits any in-flight prior eval here before re-fetching the
 * doc, so it never reads a stale next_directive.
 */
const pendingEvalByInterview = new Map();

/* ---------------- Routes ---------------- */

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

/**
 * POST body (orchestrated interviews):
 *   - role_title, role_track, company, interview_mode, industry (optional)
 *   - target_level: one of INTERN | SDE_1 | SDE_2 | SR_SDE | PRINCIPAL_STAFF | SR_PRINCIPAL.
 *
 * v3 single-problem mode: there is exactly one interview config (URL
 * shortener). `interview_type` and `template_id` are pinned; legacy clients
 * may still send other values but they are ignored.
 *
 * Legacy clients may still send `experience_level` + `years_experience_band` —
 * we accept those, derive `target_level` via resolveTargetLevel, and persist
 * both so old debrief logic keeps working.
 */
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

    if (
      body.target_level != null &&
      body.target_level !== '' &&
      !isValidTargetLevel(String(body.target_level))
    ) {
      return res.status(400).json({
        error:
          'Invalid target_level. Allowed: INTERN, SDE_1, SDE_2, SR_SDE, PRINCIPAL_STAFF, SR_PRINCIPAL.',
      });
    }

    const targetLevel = resolveTargetLevel(body);
    const legacyExperienceLevel =
      body.experience_level ||
      ({
        INTERN: 'entry',
        SDE_1: 'entry',
        SDE_2: 'mid',
        SR_SDE: 'senior',
        PRINCIPAL_STAFF: 'staff',
        SR_PRINCIPAL: 'principal',
      })[targetLevel] ||
      '';

    const row = await Interview.create({
      userId: userObjectId,
      clientId,
      status: body.status || 'in_progress',
      created_date: body.created_date || toIso(),
      role_title: body.role_title,
      role_track: body.role_track,
      company: body.company,
      experience_level: body.experience_level || legacyExperienceLevel,
      years_experience_band: body.years_experience_band || undefined,
      target_level: targetLevel,
      interview_type: 'system_design',
      industry: body.industry || '',
      interview_mode: body.interview_mode ?? 'chat',
      duration_seconds: body.duration_seconds,
      template_id: INTERVIEW_CONFIG_ID,
      template_version: 'v3',
      selected_template_id: INTERVIEW_CONFIG_ID,
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

/**
 * Streaming turn endpoint. Sends:
 *   event: meta  data: { turn_index }            once
 *   event: token data: { delta }                 N times as tokens arrive
 *   event: done  data: { interviewer_message }   once when stream completes
 *   event: error data: { message }               on failure
 *
 * v5 Planner-first flow:
 *   T1 (first candidate turn): Executor streams the deterministic
 *     problem-statement handoff via the Opening Protocol. Planner runs as
 *     fire-and-forget AFTER res.end() (signal-only — its directive will be
 *     overwritten by T2's foreground Planner run anyway).
 *   T2+ : Planner runs SYNCHRONOUSLY before the Executor stream so the
 *     Executor's system prompt reads a fresh `next_directive` produced from
 *     this turn's candidate message. This is what stops things like
 *     "candidate jumps to HLD before requirements" from getting rubber-
 *     stamped on the same turn they happen.
 *
 * Frontends that need to know whether the interview is_done after a turn
 * poll /session/state a few seconds after the `done` event.
 */
router.post('/:clientId/session/turn', async (req, res) => {
  let opened = false;
  const clientId = req.params.clientId;
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const candidate_message = req.body?.candidate_message ?? req.body?.message;
    if (!candidate_message || typeof candidate_message !== 'string') {
      return res.status(400).json({ error: 'candidate_message required' });
    }

    // Serialize against any still-in-flight Planner eval for THIS interview.
    // Without this, a fast typer's turn N+1 could re-fetch the doc before
    // turn N's eval has saved its session_state mutations, so the Executor
    // would render against a stale next_directive (and worse, the late
    // eval save could clobber turn N+1's appended candidate turn).
    const prior = pendingEvalByInterview.get(clientId);
    if (prior) {
      try {
        await prior;
      } catch {
        /* already logged inside the eval wrapper */
      }
    }

    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId,
    }).exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.interview_config || !doc.template_id) {
      return res.status(400).json({ error: 'Session not started — call /session/start first' });
    }
    if (doc.session_state?.interview_done) {
      return res.status(409).json({ error: 'Interview already complete' });
    }

    const config = loadInterviewConfig();
    const trimmedMessage = candidate_message.trim();

    // The most recent interviewer turn BEFORE this candidate turn — used as
    // the Planner's "LATEST INTERVIEWER TURN" context on T2+ (where the
    // Planner runs before the new Executor reply). Computed before
    // appendCandidateTurn so it's unambiguously the prior interviewer turn.
    const priorInterviewerReply = (() => {
      const turns = Array.isArray(doc.conversation_turns) ? doc.conversation_turns : [];
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        if (turns[i]?.role === 'interviewer') return String(turns[i].content || '');
      }
      return '';
    })();

    const candidateTurnIndex = appendCandidateTurn(doc, trimmedMessage);
    const isT1 = candidateTurnIndex === 1;

    // T2+ : Planner-first. Run the Planner LLM synchronously so the Executor's
    // system prompt picks up the freshly-mutated next_directive in-memory.
    // captured.__trace is preserved on the result for the post-stream debug
    // entry assembly below.
    let foregroundCaptured = null;
    if (!isT1) {
      try {
        const result = await runForegroundEvalCapture(doc, {
          config,
          candidateMessage: trimmedMessage,
          interviewerReply: priorInterviewerReply,
          candidateTurnIndex,
        });
        foregroundCaptured = result.captured;
      } catch (err) {
        // If the Planner fails, continue with whatever next_directive was
        // already on the doc. The Executor still has the Opening Protocol
        // / prior directive to fall back on. The miss gets logged.
        console.warn('[session/turn] foreground planner eval failed:', err);
      }

      // Hard turn-cap could have flipped interview_done synchronously inside
      // the foreground eval (HARD_TURN_CAP=60). If so, bail with a 409 before
      // streaming — there's no Executor reply to give.
      if (doc.session_state?.interview_done) {
        await doc.save();
        return res.status(409).json({ error: 'Interview already complete' });
      }
    }

    openSseStream(res);
    opened = true;
    writeSseEvent(res, 'meta', { turn_index: candidateTurnIndex });

    // Disconnect handling — abort the upstream generator if the client bails.
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    let assembled = '';
    // When INTERVIEW_DEBUG_TRACE=1, the streaming layer fills this object with
    // the executor's prompt + history. We accumulate the reply ourselves below
    // and stitch them together for the debug timeline.
    const executorTrace = process.env.INTERVIEW_DEBUG_TRACE === '1' ? {} : null;
    try {
      for await (const delta of streamInterviewerReply({
        interview: doc,
        config,
        candidateMessage: trimmedMessage,
        signal: abort.signal,
        traceCapture: executorTrace,
      })) {
        if (abort.signal.aborted) break;
        assembled += delta;
        writeSseEvent(res, 'token', { delta });
      }
    } catch (err) {
      console.error('[session/turn] stream failed:', err);
      writeSseEvent(res, 'error', { message: err.message || 'Stream failed' });
      try {
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }

    if (abort.signal.aborted) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }

    const finalReply = assembled.trim();
    appendInterviewerTurn(doc, finalReply);

    if (executorTrace) {
      executorTrace.reply = finalReply;
      executorTrace.duration_ms = executorTrace.started_at
        ? Date.now() - executorTrace.started_at
        : null;
    }

    // T2+ : the Planner already ran inline; fold its trace + the executor
    // trace into a single debug_trace entry now that both are available.
    if (!isT1 && foregroundCaptured) {
      recordDebugTraceEntry(doc, {
        candidateTurnIndex,
        candidateMessage: trimmedMessage,
        captured: foregroundCaptured,
        executorTrace,
      });
    }

    await doc.save();

    writeSseEvent(res, 'done', { interviewer_message: finalReply });

    // End the SSE stream NOW so the user's UI unblocks immediately.
    res.end();

    // T1 only — fire-and-forget Planner eval. T1's Executor reply is the
    // deterministic problem-statement handoff (Opening Protocol), so we
    // don't need Planner BEFORE the stream. Its directive is signal-only
    // because T2 will overwrite next_directive via its foreground run.
    if (isT1) {
      const evalPromise = (async () => {
        try {
          await runBackgroundEvalCapture(doc, {
            config,
            candidateMessage: trimmedMessage,
            interviewerReply: finalReply,
            candidateTurnIndex,
            executorTrace,
          });
        } catch (err) {
          console.warn('[session/turn] eval capture failed:', err);
        } finally {
          if (pendingEvalByInterview.get(clientId) === evalPromise) {
            pendingEvalByInterview.delete(clientId);
          }
        }
      })();
      pendingEvalByInterview.set(clientId, evalPromise);
    }
  } catch (e) {
    console.error(e);
    if (opened) {
      try {
        writeSseEvent(res, 'error', { message: e.message || 'Turn failed' });
        res.end();
      } catch {
        /* ignore */
      }
    } else {
      res.status(500).json({ error: e.message || 'Turn failed' });
    }
  }
});

/**
 * Debug-only: per-turn trace of Executor + Planner prompts, outputs, and
 * applied directive. Local-only feature gated by INTERVIEW_DEBUG_TRACE=1.
 *
 * Returns 404 (not 403) when the flag is off, to avoid signalling that this
 * endpoint exists in production. Auth is reused from the router-level
 * middleware so the user must own the interview.
 */
router.get('/:clientId/debug-trace', async (req, res) => {
  if (process.env.INTERVIEW_DEBUG_TRACE !== '1') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    })
      .select('clientId session_state target_level role_title interview_type')
      .exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const ss = doc.session_state || {};
    const trace = Array.isArray(ss.debug_trace) ? ss.debug_trace : [];
    // eval_history rows carry every tripwire flag (leak_guard,
    // cant_see, reply_leak, verbal_advance, calibrated_advance,
    // handoff_reconciliation), the post-sanitize candidate_signal, the
    // derived_move vs planner_recommended_move split, coverage_ok,
    // elapsed_fraction, section_pressure, section_nudge_count, and
    // hand_off_targets. The UI joins debug_trace + eval_history by
    // turn_index to render a compact decision summary without re-parsing
    // the heavy LLM prompts.
    const evalHistory = Array.isArray(ss.eval_history) ? ss.eval_history : [];
    return res.json({
      id: doc.clientId,
      target_level: doc.target_level || null,
      role_title: doc.role_title || '',
      interview_type: doc.interview_type || '',
      trace,
      eval_history: evalHistory,
      enabled: true,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Debug trace fetch failed' });
  }
});

/**
 * Lightweight refetch for the session state — clients call this if the SSE
 * connection drops mid-eval, or before navigating away to make sure the last
 * eval landed.
 */
router.get('/:clientId/session/state', async (req, res) => {
  try {
    const userObjectId = toUserObjectId(req.userId);
    if (!userObjectId) return res.status(401).json({ error: 'Unauthorized' });
    const doc = await Interview.findOne({
      userId: userObjectId,
      clientId: req.params.clientId,
    })
      .select('clientId session_state status template_id interview_config conversation_turns')
      .exec();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.json({
      id: doc.clientId,
      session_state: doc.session_state || {},
      status: doc.status,
      conversation_turns: doc.conversation_turns || [],
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Get state failed' });
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
    if (!doc.interview_config) {
      return res.status(400).json({ error: 'Not an orchestrated interview' });
    }
    if (doc.status === 'completed') {
      return res.json(serializeInterviewDoc(doc, { includeTranscript: true }));
    }

    const turns = Array.isArray(doc.conversation_turns) ? doc.conversation_turns : [];
    const candidateTurns = turns.filter((t) => t.role === 'candidate').length;
    if (candidateTurns === 0) {
      return res.status(400).json({
        error: 'Answer at least one question before ending the session so we can generate a report.',
      });
    }

    const candidateEndedEarlyFromUi = !doc.session_state?.interview_done;
    if (candidateEndedEarlyFromUi) {
      if (!doc.session_state) doc.session_state = {};
      doc.session_state.interview_done = true;
      doc.conversation_turns.push({
        role: 'interviewer',
        content:
          'You ended the session here — we will generate feedback from everything you shared so far.',
        kind: 'early_complete',
      });
      doc.markModified('conversation_turns');
      doc.markModified('session_state');
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
    // Mongoose `Mixed` types do not auto-detect changes from
    // Object.assign — without an explicit markModified, save() silently
    // drops the update. The canvas_scene drop on pause/resume traced back
    // to exactly this. Mark every Mixed field that this PATCH might have
    // touched so they're persisted.
    const MIXED_FIELDS = [
      'canvas_scene',
      'session_state',
      'interview_config',
      'execution_plan',
      'orchestrator_state',
      'adaptation_raw',
      'debrief',
    ];
    for (const f of MIXED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, f)) {
        doc.markModified(f);
      }
    }
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
