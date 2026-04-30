import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { invokeLLM } from '../services/llmInvoke.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/invoke', async (req, res) => {
  try {
    const { prompt, response_json_schema } = req.body || {};
    const result = await invokeLLM({ prompt, response_json_schema });
    return res.json({ result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'LLM invoke failed' });
  }
});

export default router;
