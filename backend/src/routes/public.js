import { Router } from 'express';
import { config } from '../config.js';
import { resolveMarketContext, toPublicMarketPayload } from '../services/resolveMarket.js';

const router = Router();

router.get('/market-context', (req, res) => {
  const ctx = resolveMarketContext({
    req,
    allowDebugOverrides: config.isLocalLike,
    defaultMarketId: config.defaultMarketId,
  });
  res.json(toPublicMarketPayload(ctx));
});

export default router;
