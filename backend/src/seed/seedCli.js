import 'dotenv/config';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { runSeed } from './runSeed.js';

if (!config.allowDemoSeed) {
  console.error('[seed] Refusing: demo seed requires APP_ENV=local or APP_ENV=development.');
  process.exit(1);
}

await mongoose.connect(config.mongodbUri);
await runSeed();
await mongoose.disconnect();
process.exit(0);
