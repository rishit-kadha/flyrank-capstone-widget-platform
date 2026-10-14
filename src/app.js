import express from 'express';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { AppError, notFound, errorHandler } from './errors.js';
import { parse, widgetSchema, widgetPatchSchema, loginSchema, uuidSchema, submissionSchema, idempotencySchema, demoSchema, querySchema } from './validation.js';
import { newToken, sha256, verifyPassword } from './security.js';
import { createGeoService } from './geo.js';
import { createSubmissionService } from './services.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const widgetConfig = widget => ({
  id: widget.id, type: widget.type, title: widget.title, description: widget.description,
  button_text: widget.button_text, fields: widget.fields, display: widget.display,
});
const editableConfig = widget => ({
  type: widget.type, title: widget.title, description: widget.description, button_text: widget.button_text,
  fields: widget.fields, display: widget.display, active: widget.active,
});

export function createApp({ repo, config: supplied = {}, geoService, ipResolver } = {}) {
  const config = { ...loadConfig(), ...supplied };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const ipOf = ipResolver || (req => req.ip);
  const submitService = createSubmissionService({ repo, geoService: geoService || createGeoService({ mode: config.geoMode }) });

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/') || req.path === '/submissions') res.set('Cache-Control', 'no-store');
    next();
  });
  function publicCors(req, res, next) {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
      'Access-Control-Expose-Headers': 'Retry-After',
      'Access-Control-Max-Age': '600',
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  }
  app.use('/submissions', publicCors);
  app.use('/widgets', publicCors);
  app.use('/widget.v1.js', publicCors);
  app.use('/widget.js', publicCors);

  async function limit(req, res, scope, key, maximum) {
    const result = await repo.consumeRateLimit(scope, sha256(key), maximum, config.rateWindowSeconds);
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfter));
      throw new AppError(429, 'rate_limited', 'Too many requests. Please try again later.');
    }
  }
  // Bound public request volume before JSON parsing and expensive enrichment.
  app.use('/submissions', async (req, res, next) => {
    if (req.method === 'POST') await limit(req, res, 'submission_ip', ipOf(req), config.ipRateLimit);
    next();
  });
  app.use(express.json({ limit: config.bodyLimit }));
  const jsonOnly = (req, res, next) => {
    if (!req.is('application/json')) throw new AppError(415, 'unsupported_media_type', 'Use application/json');
    next();
  };
  async function auth(req, res, next) {
    const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(req.get('Authorization') || '');
    const user = match ? await repo.getSession(sha256(match[1])) : null;
    if (!user) throw new AppError(401, 'unauthorized', 'A valid owner session is required');
    req.user = user;
    req.tokenHash = sha256(match[1]);
    next();
  }
  app.get('/health', async (req, res) => {
    await repo.health();
    res.json({ status: 'ok' });
  });
  app.post('/api/auth/login', jsonOnly, async (req, res) => {
    await limit(req, res, 'login_ip', ipOf(req), 20);
    const credentials = parse(loginSchema, req.body);
    const user = await repo.getUserByEmail(credentials.email);
    if (!user || !await verifyPassword(credentials.password, user.password_hash)) throw new AppError(401, 'invalid_credentials', 'Invalid login credentials');
    const token = newToken();
    await repo.createSession({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 8 * 3600_000) });
    res.json({ access_token: token, user: { email: user.email, tenant_id: user.tenant_id, tenant_name: user.tenant_name } });
  });
  app.post('/api/auth/logout', auth, async (req, res) => {
    await repo.deleteSession(req.tokenHash);
    res.status(204).end();
  });
  app.get('/api/auth/me', auth, (req, res) => res.json({ user: { email: req.user.email, tenant_id: req.user.tenant_id, tenant_name: req.user.tenant_name } }));
  app.use('/api', auth);
  app.get('/api/widgets', async (req, res) => res.json({ items: await repo.listWidgets(req.user.tenant_id) }));
  app.post('/api/widgets', jsonOnly, async (req, res) => res.status(201).json(await repo.createWidget(req.user.tenant_id, parse(widgetSchema, req.body))));
  app.param('id', (req, res, next, id) => { parse(uuidSchema, id); next(); });
  app.get('/api/widgets/:id', async (req, res) => {
    const widget = await repo.getWidget(req.user.tenant_id, req.params.id);
    if (!widget) throw notFound();
    res.json(widget);
  });
  app.patch('/api/widgets/:id', jsonOnly, async (req, res) => {
    const patch = parse(widgetPatchSchema, req.body);
    if (!Object.keys(patch).length) throw new AppError(400, 'validation_error', 'Provide at least one change');
    const existing = await repo.getWidget(req.user.tenant_id, req.params.id);
    if (!existing) throw notFound();
    const config = parse(widgetSchema, { ...editableConfig(existing), ...patch, display: { ...existing.display, ...patch.display } });
    res.json(await repo.updateWidget(req.user.tenant_id, existing.id, config));
  });
  app.delete('/api/widgets/:id', async (req, res) => {
    if (!await repo.deleteWidget(req.user.tenant_id, req.params.id)) throw notFound();
    res.status(204).end();
  });
  app.get('/api/widgets/:id/embed', async (req, res) => {
    const widget = await repo.getWidget(req.user.tenant_id, req.params.id);
    if (!widget) throw notFound();
    const script_url = new URL('/widget.v1.js', config.publicBaseUrl);
    script_url.searchParams.set('id', widget.id);
    res.json({ script_url: script_url.href, snippet: '<script src="' + script_url.href + '" defer></script>' });
  });
  app.get('/widgets/:id/config', async (req, res) => {
    const widget = await repo.getPublicWidget(req.params.id);
    if (!widget) throw notFound();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(widgetConfig(widget));
  });
  app.get('/widget.v1.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile('widget.v1.js', { root: publicDir, cacheControl: false });
  });
  app.get('/widget.js', (req, res) => {
    const target = new URL('/widget.v1.js', config.publicBaseUrl);
    if (typeof req.query.id === 'string') target.searchParams.set('id', parse(uuidSchema, req.query.id));
    res.set('Cache-Control', 'no-cache').redirect(302, target.href);
  });
  app.post('/submissions', jsonOnly, async (req, res) => {
    const body = parse(submissionSchema, req.body);
    const idempotencyKey = parse(idempotencySchema, req.get('Idempotency-Key'));
    await limit(req, res, 'submission_widget', body.widget_id, config.widgetRateLimit);
    const result = await submitService.submit({ body, idempotencyKey, ip: ipOf(req) });
    res.status(result.replayed ? 200 : 201).json(result);
  });
  app.get('/api/submissions', async (req, res) => {
    const query = parse(querySchema, req.query);
    if (query.widget_id && !await repo.getWidget(req.user.tenant_id, query.widget_id)) throw notFound();
    res.json(await repo.listSubmissions(req.user.tenant_id, { widgetId: query.widget_id, limit: query.limit, offset: query.offset }));
  });
  app.get('/api/submissions/:id', async (req, res) => {
    const submission = await repo.getSubmission(req.user.tenant_id, req.params.id);
    if (!submission) throw notFound();
    res.json(submission);
  });
  app.get('/api/dashboard', async (req, res) => res.json(await repo.getDashboard(req.user.tenant_id)));
  app.get('/api/jobs', async (req, res) => res.json({ items: await repo.getJobs(req.user.tenant_id) }));
  app.get('/api/demo/failures', async (req, res) => {
    if (!config.demoControls) throw notFound();
    res.json(await repo.getDemoSettings(req.user.tenant_id));
  });
  app.put('/api/demo/failures', jsonOnly, async (req, res) => {
    if (!config.demoControls) throw notFound();
    res.json(await repo.setDemoSettings(req.user.tenant_id, parse(demoSchema, req.body)));
  });
  app.use(express.static(publicDir, { maxAge: 0, index: 'index.html' }));
  app.use((req, res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}
