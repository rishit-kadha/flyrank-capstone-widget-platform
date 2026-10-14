import { setTimeout as pause } from 'node:timers/promises';
import { createPool, migrate } from './db.js';
import { createRepository } from './repository.js';
import { loadConfig } from './config.js';
import { processOneJob } from './jobs.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const repo = createRepository(pool);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
let ticks = 0;
console.log('Notification worker ready');
while (!stopping) {
  try {
    const worked = await processOneJob({
      repo, maxAttempts: config.jobMaxAttempts, retryDelayMs: config.jobRetryMs,
      notify: async job => {
        if (config.notificationMode === 'fail') throw new Error('Notification unavailable');
        // A local fake notification; never logs lead contents or sends real mail.
        console.log(JSON.stringify({ event: 'console_notification', job_id: job.id }));
      },
    });
    if (++ticks % 120 === 0) await repo.cleanup();
    if (!worked) await pause(config.jobPollMs);
  } catch (error) {
    console.error(JSON.stringify({ event: 'worker_error', code: error.code || 'unavailable' }));
    await pause(config.jobPollMs);
  }
}
await pool.end();
