import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
const target = new URL('../.env', import.meta.url);
try {
  await access(target);
  console.log('.env already exists; left unchanged.');
} catch {
  const databasePassword = randomBytes(24).toString('hex');
  const demoPassword = randomBytes(18).toString('base64url');
  await writeFile(target, [
    'POSTGRES_DB=widget_platform', 'POSTGRES_USER=widget',
    'POSTGRES_PASSWORD=' + databasePassword,
    'DATABASE_URL=postgresql://widget:' + databasePassword + '@localhost:5433/widget_platform',
    'DEMO_PASSWORD=' + demoPassword, 'PORT=4000', 'PUBLIC_BASE_URL=http://localhost:4000',
    'CUSTOMER_PORT=5500', 'GEO_MODE=mock', 'DEMO_CONTROLS=true', 'NOTIFICATION_MODE=console',
    'IP_RATE_LIMIT=10', 'WIDGET_RATE_LIMIT=100', 'RATE_WINDOW_SECONDS=60',
    'TRUST_PROXY_HOPS=0', 'JOB_POLL_MS=500', 'JOB_RETRY_MS=2000', 'JOB_MAX_ATTEMPTS=3', '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  console.log('Generated .env with random local database and demo passwords. Read DEMO_PASSWORD there to log in.');
}
