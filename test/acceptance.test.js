import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { before, after, describe, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createPool, migrate } from '../src/db.js';
import { createRepository } from '../src/repository.js';
import { hashPassword, verifyPassword, sha256 } from '../src/security.js';
import { createGeoService } from '../src/geo.js';
import { processOneJob } from '../src/jobs.js';

const schema = `test_${randomBytes(10).toString('hex')}`;
const password = `acceptance-${randomBytes(18).toString('hex')}`;
const aliceWidgetId = '11111111-1111-4111-8111-111111111111';
const bobWidgetId = '22222222-2222-4222-8222-222222222222';
const config = {
  publicBaseUrl: 'http://localhost:4000', bodyLimit: '16kb', ipRateLimit: 10,
  widgetRateLimit: 100, rateWindowSeconds: 60, demoControls: true, trustProxy: 0,
};
const noFailures = { geo_a_down: false, geo_b_down: false, notification_fail: false };
const widgetBody = (overrides = {}) => ({
  type: 'contact', title: 'Acceptance contact form', description: 'A local test form',
  button_text: 'Send message', active: true,
  fields: [
    { name: 'name', label: 'Your name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea', required: false },
  ],
  display: { accent: '#2563eb', position: 'inline' }, ...overrides,
});
const validFields = () => ({ name: 'Local visitor', email: 'visitor@example.test', message: 'Please contact me.' });

let adminPool, pool, repo, origin, alice, bob, ownedSchemaCreated = false;
let addressCounter = 1;
const servers = [];

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(path, { method = 'GET', token, body, headers = {}, base = origin } = {}) {
  const allHeaders = { 'x-test-ip': `198.18.${Math.floor(addressCounter / 250)}.${addressCounter++ % 250 + 1}`, ...headers };
  if (token) allHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined && !allHeaders['content-type']) allHeaders['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method, headers: allHeaders,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { response, status: response.status, data, text };
}

function expectError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  assert.match(result.response.headers.get('content-type') || '', /application\/json/);
  assert.equal(typeof result.data?.error?.code, 'string');
  assert.equal(typeof result.data?.error?.message, 'string');
  if (code) assert.equal(result.data.error.code, code);
}

async function createWidget(overrides = {}, token = alice.access_token) {
  const result = await request('/api/widgets', { method: 'POST', token, body: widgetBody(overrides) });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.match(result.data.id, /^[0-9a-f-]{36}$/);
  return result.data;
}

async function submit(widgetId, { fields = validFields(), key = randomUUID(), headers = {}, body = {}, base = origin } = {}) {
  return request('/submissions', {
    method: 'POST', base,
    headers: { 'idempotency-key': key, ...headers },
    body: { widget_id: widgetId, fields, website: '', ...body },
  });
}

async function setFailures(settings, token = alice.access_token) {
  const result = await request('/api/demo/failures', { method: 'PUT', token, body: { ...noFailures, ...settings } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
}

async function drainJobs() {
  for (let count = 0; count < 300; count++) {
    if (!await processOneJob({ repo, notify: async () => {}, retryDelayMs: 0, log: () => {} })) return;
  }
  assert.fail('The local test job queue did not drain');
}

describe('real PostgreSQL acceptance', { concurrency: false }, () => {
  before(async () => {
    const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    assert.ok(connectionString, 'Set TEST_DATABASE_URL or DATABASE_URL to a local PostgreSQL database before running npm test');
    assert.match(schema, /^test_[0-9a-f]{20}$/);
    adminPool = createPool(connectionString);
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    ownedSchemaCreated = true;
    pool = createPool(connectionString, { schema });
    await migrate(pool);
    repo = createRepository(pool);
    await repo.seedDemo({ passwordHash: await hashPassword(password) });
    origin = await listen(createApp({
      repo, config, geoService: createGeoService({ mode: 'mock' }),
      ipResolver: req => req.headers['x-test-ip'],
    }));
    for (const [email, assign] of [
      ['alice@example.test', value => { alice = value; }],
      ['bob@example.test', value => { bob = value; }],
    ]) {
      const result = await request('/api/auth/login', { method: 'POST', body: { email, password } });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(typeof result.data.access_token, 'string');
      assert.equal(result.data.user.email, email);
      assign(result.data);
    }
  });

  after(async () => {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
    await pool?.end();
    if (ownedSchemaCreated) {
      // This schema name is generated by this test, never read from user input.
      assert.match(schema, /^test_[0-9a-f]{20}$/);
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await adminPool?.end();
  });

  test('passwords use random salts and reject an incorrect password', async () => {
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    assert.notEqual(first, second);
    assert.ok(await verifyPassword(password, first));
    assert.equal(await verifyPassword('incorrect-password', first), false);
    assert.equal(await verifyPassword(password, 'invalid-stored-hash'), false);
  });

  test('health checks the database and authentication fails with structured JSON', async () => {
    assert.equal((await request('/health')).status, 200);
    expectError(await request('/api/widgets'), 401);
    expectError(await request('/api/widgets', { token: 'invented-token' }), 401);
    expectError(await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'wrong' } }), 401);
    expectError(await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test' } }), 400);
    const me = await request('/api/auth/me', { token: alice.access_token });
    assert.equal(me.status, 200);
    assert.ok(!JSON.stringify(me.data).includes('password_hash'));
  });

  test('owner can create, read, update, embed, and delete a widget', async () => {
    const widget = await createWidget({
      type: 'popover', description: 'Preserve this description', button_text: 'Join our waitlist',
      active: false, display: { accent: '#aa3366', position: 'bottom-right' },
    });
    const read = await request(`/api/widgets/${widget.id}`, { token: alice.access_token });
    assert.equal(read.status, 200);
    assert.equal(read.data.title, 'Acceptance contact form');
    const update = await request(`/api/widgets/${widget.id}`, {
      method: 'PATCH', token: alice.access_token, body: { title: 'Updated title' },
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.title, 'Updated title');
    assert.deepEqual(update.data.fields, widget.fields);
    for (const field of ['type', 'description', 'button_text', 'active', 'display']) {
      assert.deepEqual(update.data[field], widget[field], `Title-only PATCH changed ${field}`);
    }
    expectError(await request(`/api/widgets/${widget.id}`, {
      method: 'PATCH', token: alice.access_token, body: {},
    }), 400);
    const displayUpdate = await request(`/api/widgets/${widget.id}`, {
      method: 'PATCH', token: alice.access_token, body: { display: { accent: '#3366aa' } },
    });
    assert.equal(displayUpdate.status, 200);
    assert.deepEqual(displayUpdate.data.display, { accent: '#3366aa', position: 'bottom-right' });
    const embed = await request(`/api/widgets/${widget.id}/embed`, { token: alice.access_token });
    assert.equal(embed.status, 200);
    assert.ok(embed.data.snippet.includes('widget.v1.js'));
    assert.ok(embed.data.snippet.includes(widget.id));
    const removed = await request(`/api/widgets/${widget.id}`, { method: 'DELETE', token: alice.access_token });
    assert.equal(removed.status, 204);
    expectError(await request(`/api/widgets/${widget.id}`, { token: alice.access_token }), 404);
    expectError(await request(`/widgets/${widget.id}/config`), 404);
  });

  test('tenant A cannot list, read, edit, delete, or embed tenant B widgets', async () => {
    const listing = await request('/api/widgets', { token: alice.access_token });
    assert.equal(listing.status, 200);
    assert.ok(listing.data.items.some(widget => widget.id === aliceWidgetId));
    assert.ok(listing.data.items.every(widget => widget.id !== bobWidgetId));
    for (const options of [
      {}, { method: 'PATCH', body: { title: 'Unauthorized edit' } }, { method: 'DELETE' },
    ]) expectError(await request(`/api/widgets/${bobWidgetId}`, { token: alice.access_token, ...options }), 404);
    expectError(await request(`/api/widgets/${bobWidgetId}/embed`, { token: alice.access_token }), 404);
    const readAsBob = await request(`/api/widgets/${bobWidgetId}`, { token: bob.access_token });
    assert.equal(readAsBob.status, 200);
    assert.notEqual(readAsBob.data.title, 'Unauthorized edit');
  });

  test('widget schemas reject duplicate, reserved, unsupported, and unknown fields', async () => {
    const invalid = [
      { fields: [{ name: 'email', label: 'Email', type: 'email', required: true }, { name: 'email', label: 'Again', type: 'email', required: false }] },
      { fields: [{ name: 'website', label: 'Reserved', type: 'text', required: false }] },
      { fields: [{ name: 'x', label: 'Script', type: 'script', required: false }] },
      { display: { accent: 'javascript:alert(1)', position: 'inline' } },
      { unexpected_property: true },
    ];
    for (const value of invalid) expectError(await request('/api/widgets', {
      method: 'POST', token: alice.access_token, body: widgetBody(value),
    }), 400);
  });

  test('public configuration and the versioned script have cross-origin cache contracts', async () => {
    const widget = await createWidget();
    const result = await request(`/widgets/${widget.id}/config`, { headers: { origin: 'http://localhost:5500' } });
    assert.equal(result.status, 200);
    assert.equal(result.response.headers.get('access-control-allow-origin'), '*');
    assert.match(result.response.headers.get('cache-control'), /public.*max-age=60/);
    assert.ok(result.response.headers.get('etag'));
    assert.equal(result.data.id, widget.id);
    assert.equal(result.data.tenant_id, undefined);
    // Undici otherwise adds Cache-Control: no-cache to a conditional fetch,
    // intentionally forcing Express to send a full response.
    const conditional = await request(`/widgets/${widget.id}/config`, {
      headers: { 'if-none-match': result.response.headers.get('etag'), 'cache-control': 'max-age=0' },
    });
    assert.equal(conditional.status, 304);
    const script = await request('/widget.v1.js');
    assert.equal(script.status, 200);
    assert.match(script.response.headers.get('content-type'), /javascript/);
    assert.match(script.response.headers.get('cache-control'), /max-age=31536000.*immutable/);
    assert.ok(script.text.length > 100);
  });

  test('cross-origin preflight permits the idempotency header without credentials', async () => {
    const result = await request('/submissions', { method: 'OPTIONS', headers: {
      origin: 'http://localhost:5500', 'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,idempotency-key',
    } });
    assert.equal(result.status, 204);
    assert.equal(result.response.headers.get('access-control-allow-origin'), '*');
    assert.match(result.response.headers.get('access-control-allow-methods'), /POST/i);
    assert.match(result.response.headers.get('access-control-allow-headers'), /idempotency-key/i);
    assert.notEqual(result.response.headers.get('access-control-allow-credentials'), 'true');
  });

  test('malformed JSON, oversized bodies, invalid identifiers, and malformed pagination return JSON 4xx', async () => {
    expectError(await request('/submissions', { method: 'POST', body: '{"widget_id":' }), 400);
    expectError(await request('/submissions', { method: 'POST', body: { payload: 'x'.repeat(18 * 1024) } }), 413);
    expectError(await request('/submissions', {
      method: 'POST', body: {}, headers: { 'content-type': 'application/json; charset=iso-8859-1' },
    }), 415);
    expectError(await request('/submissions', {
      method: 'POST', body: {}, headers: { 'content-encoding': 'unsupported-test-encoding' },
    }), 415);
    expectError(await submit('not-a-uuid'), 400);
    expectError(await request('/api/submissions?limit=-2', { token: alice.access_token }), 400);
    expectError(await request('/api/submissions?offset=not-a-number', { token: alice.access_token }), 400);
  });

  test('submissions validate required, email, type, length, unknown, and configured custom fields', async () => {
    const widget = await createWidget({ fields: [
      ...widgetBody().fields, { name: 'company', label: 'Company', type: 'text', required: true },
    ] });
    const valid = { ...validFields(), company: 'Example Studio' };
    for (const fields of [
      { ...valid, name: '' }, { ...valid, email: 'invalid-email' },
      { ...valid, company: ' ' }, { ...valid, company: 123 },
      { ...valid, company: 'x'.repeat(255) }, { ...valid, unexpected: 'unconfigured' },
    ]) expectError(await submit(widget.id, { fields }), 400);
    const accepted = await submit(widget.id, { fields: valid });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    const stored = await request(`/api/submissions/${accepted.data.id}`, { token: alice.access_token });
    assert.equal(stored.status, 200);
    assert.equal(stored.data.fields.company, 'Example Studio');
  });

  test('honeypot and inactive widgets reject submissions without storing a lead', async () => {
    const widget = await createWidget();
    expectError(await submit(widget.id, { body: { website: 'https://spam.example' } }), 400);
    const listing = await request(`/api/submissions?widget_id=${widget.id}`, { token: alice.access_token });
    assert.equal(listing.data.total, 0);
    await request(`/api/widgets/${widget.id}`, { method: 'PATCH', token: alice.access_token, body: { active: false } });
    expectError(await submit(widget.id), 404);
  });

  test('geolocation tries A, falls back to B, and stores null while both providers are unavailable', async () => {
    const widget = await createWidget();
    try {
      let result = await submit(widget.id);
      assert.equal(result.status, 201);
      assert.equal(result.data.geo.provider, 'mock-a');
      await setFailures({ geo_a_down: true });
      result = await submit(widget.id);
      assert.equal(result.status, 201);
      assert.equal(result.data.geo.provider, 'mock-b');
      await setFailures({ geo_a_down: true, geo_b_down: true });
      result = await submit(widget.id);
      assert.equal(result.status, 201);
      assert.equal(result.data.geo, null);
      const stored = await request(`/api/submissions/${result.data.id}`, { token: alice.access_token });
      assert.equal(stored.status, 200);
      assert.equal(stored.data.geo, null);
      const bobSettings = await request('/api/demo/failures', { token: bob.access_token });
      assert.equal(bobSettings.data.geo_a_down, false);
      assert.equal(bobSettings.data.geo_b_down, false);
    } finally { await setFailures(noFailures); }
  });

  test('submissions require a key, replay exactly once, and reject changed content with the same key', async () => {
    const widget = await createWidget();
    expectError(await request('/submissions', { method: 'POST', body: { widget_id: widget.id, fields: validFields() } }), 400);
    const key = randomUUID();
    const first = await submit(widget.id, { key });
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    const replay = await submit(widget.id, { key });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.id, first.data.id);
    expectError(await submit(widget.id, { key, fields: { ...validFields(), message: 'Changed content' } }), 409);
    const listing = await request(`/api/submissions?widget_id=${widget.id}`, { token: alice.access_token });
    assert.equal(listing.data.total, 1);
    assert.equal(listing.data.items[0].fields.message, 'Please contact me.');
    const jobs = await pool.query('SELECT count(*)::int AS count FROM notification_jobs WHERE submission_id=$1', [first.data.id]);
    assert.equal(jobs.rows[0].count, 1);
  });

  test('concurrent requests with the same key create one lead and one notification job', async () => {
    const widget = await createWidget();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => submit(widget.id, { key })));
    assert.equal(results.filter(result => result.status === 201).length, 1, JSON.stringify(results.map(result => result.data)));
    assert.equal(results.filter(result => result.status === 200).length, 7);
    assert.equal(new Set(results.map(result => result.data.id)).size, 1);
    const rows = await pool.query('SELECT count(*)::int AS count FROM submissions WHERE widget_id=$1', [widget.id]);
    assert.equal(rows.rows[0].count, 1);
    const jobs = await pool.query('SELECT count(*)::int AS count FROM notification_jobs WHERE submission_id=$1', [results[0].data.id]);
    assert.equal(jobs.rows[0].count, 1);
  });

  test('a failed outbox insert rolls back the submission transaction', async () => {
    const widget = await createWidget();
    await pool.query(`CREATE FUNCTION reject_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Deliberate acceptance-test outbox failure'; END $$`);
    await pool.query('CREATE TRIGGER reject_test_outbox BEFORE INSERT ON notification_jobs FOR EACH ROW EXECUTE FUNCTION reject_test_outbox()');
    try {
      await assert.rejects(repo.createSubmission({
        tenantId: alice.user.tenant_id, widgetId: widget.id, fields: validFields(), geo: null,
        ipHash: 'test-ip-hash', idempotencyKey: randomUUID(), requestHash: 'test-request-hash',
      }), /Deliberate acceptance-test outbox failure/);
      const stored = await pool.query('SELECT count(*)::int AS count FROM submissions WHERE widget_id=$1', [widget.id]);
      assert.equal(stored.rows[0].count, 0);
    } finally {
      await pool.query('DROP TRIGGER reject_test_outbox ON notification_jobs');
      await pool.query('DROP FUNCTION reject_test_outbox()');
    }
  });

  test('database constraints reject mismatched widget and tenant ownership', async () => {
    await assert.rejects(repo.createSubmission({
      tenantId: bob.user.tenant_id, widgetId: aliceWidgetId, fields: validFields(), geo: null,
      ipHash: 'test-ip-hash', idempotencyKey: randomUUID(), requestHash: 'test-request-hash',
    }), error => error.code === '23503');
  });

  test('default trust-proxy ignores forged IP headers and still throttles the same client', async () => {
    const base = await listen(createApp({ repo, config: { ...config, ipRateLimit: 2 }, geoService: createGeoService({ mode: 'mock' }) }));
    const widget = await createWidget();
    const first = await submit(widget.id, { base, headers: { 'x-forwarded-for': '8.8.8.8' } });
    const second = await submit(widget.id, { base, headers: { 'x-forwarded-for': '1.1.1.1' } });
    const third = await submit(widget.id, { base, headers: { 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '9.9.9.9' } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    expectError(third, 429);
    assert.ok(Number(third.response.headers.get('retry-after')) > 0);
  });

  test('per-IP throttling preserves access for a different legitimate IP', async () => {
    const base = await listen(createApp({
      repo, config: { ...config, ipRateLimit: 2 }, geoService: createGeoService({ mode: 'mock' }),
      ipResolver: req => req.headers['x-test-ip'],
    }));
    const widget = await createWidget();
    const headers = { 'x-test-ip': '198.19.1.20' };
    assert.equal((await submit(widget.id, { base, headers })).status, 201);
    assert.equal((await submit(widget.id, { base, headers })).status, 201);
    expectError(await submit(widget.id, { base, headers }), 429);
    assert.equal((await submit(widget.id, { base, headers: { 'x-test-ip': '198.19.1.21' } })).status, 201);
  });

  test('per-widget throttling limits a burst distributed across different IPs', async () => {
    const base = await listen(createApp({
      repo, config: { ...config, widgetRateLimit: 2 }, geoService: createGeoService({ mode: 'mock' }),
      ipResolver: req => req.headers['x-test-ip'],
    }));
    const widget = await createWidget();
    assert.equal((await submit(widget.id, { base })).status, 201);
    assert.equal((await submit(widget.id, { base })).status, 201);
    const blocked = await submit(widget.id, { base });
    expectError(blocked, 429);
    assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
  });

  test('tenant A cannot read tenant B leads, filter by their widget, or see their jobs', async () => {
    const widget = await createWidget({}, bob.access_token);
    const lead = await submit(widget.id);
    assert.equal(lead.status, 201);
    expectError(await request(`/api/submissions/${lead.data.id}`, { token: alice.access_token }), 404);
    const filter = await request(`/api/submissions?widget_id=${widget.id}`, { token: alice.access_token });
    assert.ok([200, 404].includes(filter.status));
    if (filter.status === 200) assert.equal(filter.data.total, 0);
    const own = await request(`/api/submissions/${lead.data.id}`, { token: bob.access_token });
    assert.equal(own.status, 200);
    const jobs = await request('/api/jobs', { token: alice.access_token });
    assert.equal(jobs.status, 200);
    assert.ok(jobs.data.items.every(job => job.submission_id !== lead.data.id));
  });

  test('failed notifications retry, preserve the lead, and persist a terminal alert', async () => {
    await drainJobs();
    const widget = await createWidget();
    const lead = await submit(widget.id);
    assert.equal(lead.status, 201);
    let attempts = 0;
    const notify = async () => { attempts++; throw new Error('Deliberate local delivery failure'); };
    for (let index = 0; index < 3; index++) {
      assert.equal(await processOneJob({ repo, notify, maxAttempts: 3, retryDelayMs: 0, log: () => {} }), true);
      const rows = await pool.query('SELECT * FROM notification_jobs WHERE submission_id=$1', [lead.data.id]);
      assert.equal(rows.rows[0].attempts, index + 1);
      assert.equal(rows.rows[0].status, index === 2 ? 'failed' : 'pending');
    }
    assert.equal(attempts, 3);
    assert.equal(await processOneJob({ repo, notify, maxAttempts: 3, retryDelayMs: 0, log: () => {} }), false);
    const alerts = await pool.query('SELECT count(*)::int AS count FROM failure_alerts WHERE job_id IN (SELECT id FROM notification_jobs WHERE submission_id=$1)', [lead.data.id]);
    assert.equal(alerts.rows[0].count, 1);
    const stored = await request(`/api/submissions/${lead.data.id}`, { token: alice.access_token });
    assert.equal(stored.status, 200);
    assert.equal(stored.data.fields.email, 'visitor@example.test');
  });

  test('an interrupted worker lease can be recovered without creating another job', async () => {
    await drainJobs();
    const widget = await createWidget();
    const lead = await submit(widget.id);
    const claims = await Promise.all([repo.claimJob(), repo.claimJob()]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean);
    assert.equal(first.submission_id, lead.data.id);
    assert.equal(await repo.claimJob(), null);
    await pool.query("UPDATE notification_jobs SET locked_at=now()-interval '2 minutes' WHERE id=$1", [first.id]);
    const reclaimed = await repo.claimJob();
    assert.equal(reclaimed.id, first.id);
    assert.equal(reclaimed.attempts, first.attempts + 1);
    assert.equal(await repo.completeJob(first.id, first.attempts), null);
    assert.equal(await repo.failJob(first.id, 'Stale worker', 0, 3, first.attempts), null);
    await repo.completeJob(reclaimed.id, reclaimed.attempts);
    const rows = await pool.query('SELECT status FROM notification_jobs WHERE submission_id=$1', [lead.data.id]);
    assert.deepEqual(rows.rows.map(row => row.status), ['sent']);
  });

  test('dashboard aggregates equal the stored tenant-scoped leads and exclude other tenants', async () => {
    for (const token of [alice.access_token, bob.access_token]) {
      const list = await request('/api/submissions?limit=100', { token });
      const dashboard = await request('/api/dashboard', { token });
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.data.total, list.data.total);
      assert.equal(dashboard.data.by_day.reduce((sum, group) => sum + Number(group.count), 0), list.data.total);
      assert.equal(dashboard.data.by_widget.reduce((sum, group) => sum + Number(group.count), 0), list.data.total);
      assert.equal(dashboard.data.by_country.reduce((sum, group) => sum + Number(group.count), 0), list.data.total);
      const foreignWidget = token === alice.access_token ? bobWidgetId : aliceWidgetId;
      assert.ok(dashboard.data.by_widget.every(group => group.widget_id !== foreignWidget));
      assert.ok(['pending', 'processing', 'sent', 'failed'].every(status => Number.isInteger(dashboard.data.jobs[status])));
    }
  });

  test('demo controls require authentication and can be disabled in configuration', async () => {
    expectError(await request('/api/demo/failures'), 401);
    expectError(await request('/api/demo/failures', { method: 'PUT', body: noFailures }), 401);
    const base = await listen(createApp({ repo, config: { ...config, demoControls: false }, geoService: createGeoService({ mode: 'mock' }) }));
    expectError(await request('/api/demo/failures', { base, token: alice.access_token }), 404);
    expectError(await request('/api/demo/failures', { base, method: 'PUT', token: alice.access_token, body: noFailures }), 404);
  });

  test('session tokens are stored as hashes and expired sessions cannot authenticate', async () => {
    const login = await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password } });
    assert.equal(login.status, 200);
    const token = login.data.access_token;
    const rows = await pool.query('SELECT token_hash FROM sessions WHERE token_hash=$1', [sha256(token)]);
    assert.equal(rows.rows.length, 1);
    assert.notEqual(rows.rows[0].token_hash, token);
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [sha256(token)]);
    expectError(await request('/api/auth/me', { token }), 401);
  });

  test('logout invalidates the session token', async () => {
    const login = await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password } });
    assert.equal(login.status, 200);
    const token = login.data.access_token;
    assert.equal((await request('/api/auth/logout', { method: 'POST', token })).status, 204);
    expectError(await request('/api/auth/me', { token }), 401);
  });
});
