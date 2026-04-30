import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Interview } from '../models/Interview.js';
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
}
