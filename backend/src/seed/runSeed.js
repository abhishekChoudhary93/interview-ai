import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Interview } from '../models/Interview.js';
import { InterviewSignalSnapshot } from '../models/InterviewSignalSnapshot.js';
import { getMockSeedInterviews } from './interviewSeedData.js';

export async function runSeed() {
  if (!config.allowDemoSeed) {
    throw new Error(
      'Demo seed is only allowed when APP_ENV is local or development. Refusing to run.'
    );
  }

  const { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME } = config.demoUser;

  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    user = await User.create({
      email: DEMO_EMAIL,
      passwordHash,
      fullName: DEMO_NAME,
    });
    console.log('[seed] Created demo user:', DEMO_EMAIL);
  } else {
    console.log('[seed] Demo user exists:', DEMO_EMAIL);
  }

  const uid = user._id;
  const seeds = getMockSeedInterviews();
  const seedClientIds = seeds.map((r) => r.id);

  // Attach seed rows to the current demo account even if the DB still had
  // mock-seed-* interviews tied to an older user id (e.g. user recreated).
  await Interview.updateMany({ clientId: { $in: seedClientIds } }, { $set: { userId: uid } });

  for (const row of seeds) {
    const { id, ...fields } = row;
    await Interview.findOneAndUpdate(
      { userId: uid, clientId: id },
      {
        $set: {
          userId: uid,
          clientId: id,
          ...fields,
        },
      },
      { upsert: true, new: true }
    );
  }
  console.log('[seed] Upserted', seeds.length, 'demo interviews');

  const signalSeeds = [
    {
      interviewClientId: 'mock-seed-swe',
      template_id: 'frontend_engineer_mid',
      section_scores: { js_runtime: 0.74, coding: 0.69 },
      topic_signals: {
        weak: ['distributed cache invalidation'],
        strong: ['React', 'TypeScript'],
        never_tested: ['WebSockets'],
      },
      notable_quotes: ['Reached for client-side caching broadly without discussing TTL tradeoffs.'],
      recommendation: 'neutral',
    },
    {
      interviewClientId: 'mock-seed-senior-pm',
      template_id: 'product_manager_growth',
      section_scores: { product_sense: 0.82, execution: 0.78 },
      topic_signals: {
        weak: ['pricing experiments'],
        strong: ['stakeholder narrative', 'metrics'],
        never_tested: ['international rollout'],
      },
      notable_quotes: ['Shipped activation experiment that moved signup conversion by 12%.'],
      recommendation: 'hire',
    },
  ];

  for (const snap of signalSeeds) {
    await InterviewSignalSnapshot.findOneAndUpdate(
      { userId: uid, interviewClientId: snap.interviewClientId },
      {
        $set: {
          userId: uid,
          interviewClientId: snap.interviewClientId,
          completedAt: new Date(),
          template_id: snap.template_id,
          section_scores: snap.section_scores,
          topic_signals: snap.topic_signals,
          notable_quotes: snap.notable_quotes,
          recommendation: snap.recommendation,
        },
      },
      { upsert: true, new: true }
    );
  }
  console.log('[seed] Upserted', signalSeeds.length, 'interview signal snapshots');
}
