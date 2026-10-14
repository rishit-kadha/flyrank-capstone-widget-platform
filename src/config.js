import 'dotenv/config';

export function loadConfig(env = process.env) {
  const positive = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
    return value;
  };
  return {
    port: positive('PORT', 4000),
    publicBaseUrl: env.PUBLIC_BASE_URL || 'http://localhost:4000',
    databaseUrl: env.DATABASE_URL,
    bodyLimit: '16kb',
    ipRateLimit: positive('IP_RATE_LIMIT', 10),
    widgetRateLimit: positive('WIDGET_RATE_LIMIT', 100),
    rateWindowSeconds: positive('RATE_WINDOW_SECONDS', 60),
    demoControls: env.DEMO_CONTROLS !== 'false',
    trustProxy: Number(env.TRUST_PROXY_HOPS || 0),
    geoMode: env.GEO_MODE || 'mock',
    notificationMode: env.NOTIFICATION_MODE || 'console',
    jobPollMs: positive('JOB_POLL_MS', 500),
    jobRetryMs: positive('JOB_RETRY_MS', 2000),
    jobMaxAttempts: positive('JOB_MAX_ATTEMPTS', 3),
  };
}
