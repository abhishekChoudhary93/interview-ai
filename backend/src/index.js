import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { assertConfigValid, config } from './config.js';
import authRoutes from './routes/auth.js';
import interviewRoutes from './routes/interviews.js';
import { runSeed } from './seed/runSeed.js';
import publicRoutes from './routes/public.js';
import { cookieParseMiddleware } from './middleware/cookieParse.js';
import { loadInterviewConfig, INTERVIEW_CONFIG_ID } from './services/interviewConfig.js';
import { resolveOpenRouterModel } from './config.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.use(
  cors({
    origin: config.frontendOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Preferred-Market'],
  })
);
app.use(cookieParseMiddleware);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/interviews', interviewRoutes);

/**
 * Make the LLM mode obvious in startup logs so a missing/invalid API key is
 * impossible to miss. When the key is unset the orchestrated interview will
 * silently fall back to the mock LLM and the user sees "[Mock interviewer]"
 * in the chat — that's a configuration bug, not behavior we want to hide.
 */
function logLlmStartupBanner() {
  if (!config.openRouterApiKey) {
    console.warn(
      '[llm] OPENROUTER_API_KEY is NOT set — every interview reply will come from the mock LLM.\n' +
        '      Set OPENROUTER_API_KEY in your .env.local (or shell env) and restart the backend.'
    );
    return;
  }
  console.log(
    '[llm] OpenRouter ENABLED — conversational=%s, opening=%s, eval=%s, debrief=%s',
    resolveOpenRouterModel('conversational'),
    resolveOpenRouterModel('opening'),
    resolveOpenRouterModel('eval'),
    resolveOpenRouterModel('debrief')
  );
}

async function main() {
  assertConfigValid();
  logLlmStartupBanner();
  // v3 single-problem engine: load and validate the one interview config
  // at startup so a bad JSON aborts boot loudly.
  const cfg = loadInterviewConfig();
  console.log(
    `[interview-config] loaded "${INTERVIEW_CONFIG_ID}" — ${cfg.sections?.length || 0} sections, ${cfg.total_minutes}m budget`
  );
  await mongoose.connect(config.mongodbUri);
  console.log('Connected to MongoDB');

  if (config.shouldRunSeedOnStartup) {
    await runSeed();
  } else if (config.seedOnStartRequested && !config.allowDemoSeed) {
    console.warn(
      '[seed] SEED_ON_START is set but demo seed is disabled for APP_ENV=%s (use local or development).',
      config.appEnv
    );
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`API listening on ${config.port} (APP_ENV=${config.appEnv})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
