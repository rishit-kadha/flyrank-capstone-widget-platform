import 'dotenv/config';
import { createPool, migrate } from '../src/db.js';
import { createRepository } from '../src/repository.js';
import { hashPassword } from '../src/security.js';
if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) throw new Error('Run npm run init first, or set DEMO_PASSWORD to at least 12 characters.');
const pool = createPool(process.env.DATABASE_URL);
try {
  await migrate(pool);
  await createRepository(pool).seedDemo({ passwordHash: await hashPassword(process.env.DEMO_PASSWORD) });
  console.log('Demo owners seeded: alice@example.test and bob@example.test. Password: DEMO_PASSWORD in your local .env.');
} finally { await pool.end(); }
