import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { assertConfigValid, config } from './config.js';
import authRoutes from './routes/auth.js';
import interviewRoutes from './routes/interviews.js';
import llmRoutes from './routes/llm.js';
import { runSeed } from './seed/runSeed.js';
import { cookieParseMiddleware } from './middleware/cookieParse.js';

const app = express();
app.use(
  cors({
    origin: config.frontendOrigins,
    credentials: true,
  })
);
app.use(cookieParseMiddleware);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/llm', llmRoutes);

async function main() {
  assertConfigValid();
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
