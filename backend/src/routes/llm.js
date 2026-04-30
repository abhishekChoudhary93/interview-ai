import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { Interview } from '../models/Interview.js';
import { mockInvokeLLM } from '../services/mockLlm.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/invoke', (req, res) => {
  try {
    const result = mockInvokeLLM({ prompt, response_json_schema });
    return res.json({ result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'LLM invoke failed' });
  }
});

export default router;
