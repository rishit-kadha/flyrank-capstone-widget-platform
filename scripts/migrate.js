import 'dotenv/config';
import { createPool, migrate } from '../src/db.js';
const pool = createPool(process.env.DATABASE_URL);
try { await migrate(pool); console.log('Migrations applied'); } finally { await pool.end(); }
