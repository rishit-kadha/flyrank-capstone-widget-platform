import { createPool, migrate } from './db.js';
import { createRepository } from './repository.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const server = createApp({ repo: createRepository(pool), config }).listen(config.port, () => {
  console.log('Widget platform ready on ' + config.publicBaseUrl);
});
async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
