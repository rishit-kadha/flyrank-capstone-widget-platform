const DEMO_TENANTS = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice Studio', userId: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'alice@example.test', widgetId: '11111111-1111-4111-8111-111111111111' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob Workshop', userId: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'bob@example.test', widgetId: '22222222-2222-4222-8222-222222222222' },
];
const DEFAULT_DEMO_SETTINGS = { geo_a_down: false, geo_b_down: false, notification_fail: false };

function widgetFromRow(row) {
  if (!row) return null;
  return { ...row.config, id: row.id, tenant_id: row.tenant_id, created_at: row.created_at, updated_at: row.updated_at };
}

function submissionFromRow(row) {
  if (!row) return null;
  const { ip_hash, idempotency_key, request_hash, ...submission } = row;
  return submission;
}

async function transaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createRepository(pool) {
  return {
    async health() {
      await pool.query('SELECT 1');
      return true;
    },

    async getUserByEmail(email) {
      const result = await pool.query(`SELECT u.id, u.tenant_id, u.password_hash, u.email, t.name AS tenant_name
        FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = $1`, [email.toLowerCase()]);
      return result.rows[0] ?? null;
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      await pool.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
    },

    async getSession(tokenHash) {
      const result = await pool.query(`SELECT u.id, u.tenant_id, u.email, t.name AS tenant_name
        FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = u.tenant_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash]);
      return result.rows[0] ?? null;
    },

    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },

    async listWidgets(tenantId) {
      return (await pool.query(`SELECT * FROM widgets WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id`, [tenantId])).rows.map(widgetFromRow);
    },

    async getWidget(tenantId, id) {
      return widgetFromRow((await pool.query('SELECT * FROM widgets WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL', [tenantId, id])).rows[0]);
    },

    async getPublicWidget(id) {
      return widgetFromRow((await pool.query(`SELECT * FROM widgets WHERE id = $1 AND deleted_at IS NULL
        AND config ->> 'active' = 'true'`, [id])).rows[0]);
    },

    async createWidget(tenantId, config) {
      return widgetFromRow((await pool.query('INSERT INTO widgets(tenant_id, config) VALUES ($1, $2) RETURNING *', [tenantId, config])).rows[0]);
    },

    async updateWidget(tenantId, id, config) {
      return widgetFromRow((await pool.query(`UPDATE widgets SET config = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING *`, [tenantId, id, config])).rows[0]);
    },

    async deleteWidget(tenantId, id) {
      const result = await pool.query(`UPDATE widgets SET deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
      return result.rowCount > 0;
    },

    async listSubmissions(tenantId, { widgetId, limit = 50, offset = 0 } = {}) {
      const parameters = [tenantId, widgetId ?? null];
      const where = 's.tenant_id = $1 AND ($2::uuid IS NULL OR s.widget_id = $2)';
      const [items, count] = await Promise.all([
        pool.query(`SELECT s.*, w.config ->> 'title' AS widget_title FROM submissions s
          JOIN widgets w ON w.id = s.widget_id AND w.tenant_id = s.tenant_id
          WHERE ${where} ORDER BY s.created_at DESC, s.id LIMIT $3 OFFSET $4`, [...parameters, limit, offset]),
        pool.query(`SELECT count(*) AS total FROM submissions s WHERE ${where}`, parameters),
      ]);
      return { items: items.rows.map(submissionFromRow), total: Number(count.rows[0].total) };
    },

    async getSubmission(tenantId, id) {
      return submissionFromRow((await pool.query(`SELECT s.*, w.config ->> 'title' AS widget_title FROM submissions s
        JOIN widgets w ON w.id = s.widget_id AND w.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, id])).rows[0]);
    },

    async getDashboard(tenantId) {
      const [total, byDay, byWidget, byCountry, jobs] = await Promise.all([
        pool.query('SELECT count(*) AS count FROM submissions WHERE tenant_id = $1', [tenantId]),
        pool.query(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, count(*) AS count
          FROM submissions WHERE tenant_id = $1 GROUP BY 1 ORDER BY 1`, [tenantId]),
        pool.query(`SELECT w.id AS widget_id, w.config ->> 'title' AS title, count(s.id) AS count
          FROM widgets w LEFT JOIN submissions s ON s.widget_id = w.id AND s.tenant_id = w.tenant_id
          WHERE w.tenant_id = $1 AND (w.deleted_at IS NULL OR s.id IS NOT NULL)
          GROUP BY w.id ORDER BY count(s.id) DESC, w.id`, [tenantId]),
        pool.query(`SELECT COALESCE(NULLIF(geo ->> 'country', ''), 'Unknown') AS country, count(*) AS count
          FROM submissions WHERE tenant_id = $1 GROUP BY 1 ORDER BY count(*) DESC, 1`, [tenantId]),
        pool.query('SELECT status, count(*) AS count FROM notification_jobs WHERE tenant_id = $1 GROUP BY status', [tenantId]),
      ]);
      return {
        total: Number(total.rows[0].count),
        by_day: byDay.rows.map((row) => ({ ...row, count: Number(row.count) })),
        by_widget: byWidget.rows.map((row) => ({ ...row, count: Number(row.count) })),
        by_country: byCountry.rows.map((row) => ({ ...row, count: Number(row.count) })),
        jobs: { pending: 0, processing: 0, sent: 0, failed: 0, ...Object.fromEntries(jobs.rows.map((row) => [row.status, Number(row.count)])) },
      };
    },

    async findSubmissionByKey(widgetId, key) {
      const row = (await pool.query('SELECT * FROM submissions WHERE widget_id = $1 AND idempotency_key = $2', [widgetId, key])).rows[0];
      return row ? { ...submissionFromRow(row), request_hash: row.request_hash } : null;
    },

    async createSubmission({ tenantId, widgetId, fields, geo, ipHash, idempotencyKey, requestHash }) {
      return transaction(pool, async (client) => {
        const inserted = await client.query(`INSERT INTO submissions(tenant_id, widget_id, fields, geo, ip_hash, idempotency_key, request_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(widget_id, idempotency_key) DO NOTHING RETURNING *`,
        [tenantId, widgetId, fields, geo ?? null, ipHash, idempotencyKey, requestHash]);
        if (!inserted.rowCount) {
          const existing = (await client.query(`SELECT * FROM submissions
            WHERE tenant_id = $1 AND widget_id = $2 AND idempotency_key = $3`, [tenantId, widgetId, idempotencyKey])).rows[0];
          // A mismatched tenant can never receive another tenant's existing submission.
          if (!existing || existing.request_hash !== requestHash) return { submission: null, replayed: false, conflict: true };
          return { submission: submissionFromRow(existing), replayed: true, conflict: false };
        }
        const submission = inserted.rows[0];
        await client.query('INSERT INTO notification_jobs(tenant_id, submission_id) VALUES ($1, $2)', [tenantId, submission.id]);
        return { submission: submissionFromRow(submission), replayed: false, conflict: false };
      });
    },

    async consumeRateLimit(scope, key, limit, windowSeconds) {
      if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
        throw new Error('Rate limit and window must be positive.');
      }
      const result = await pool.query(`INSERT INTO rate_limit_counters(scope, key, hits, expires_at)
        VALUES ($1, $2, 1, now() + $4 * interval '1 second')
        ON CONFLICT(scope, key) DO UPDATE SET
          hits = CASE WHEN rate_limit_counters.expires_at <= now() THEN 1 ELSE LEAST(rate_limit_counters.hits + 1, $3::bigint + 1) END,
          expires_at = CASE WHEN rate_limit_counters.expires_at <= now() THEN EXCLUDED.expires_at ELSE rate_limit_counters.expires_at END
        RETURNING hits, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now())))) AS retry_after`, [scope, key, limit, windowSeconds]);
      const hits = Number(result.rows[0].hits);
      return { allowed: hits <= limit, retryAfter: Number(result.rows[0].retry_after), remaining: Math.max(0, limit - hits) };
    },

    async getDemoSettings(tenantId) {
      const row = (await pool.query('SELECT geo_a_down, geo_b_down, notification_fail FROM demo_settings WHERE tenant_id = $1', [tenantId])).rows[0];
      return row ?? { ...DEFAULT_DEMO_SETTINGS };
    },

    async setDemoSettings(tenantId, settings) {
      const current = await this.getDemoSettings(tenantId);
      const next = { ...current, ...settings };
      return (await pool.query(`INSERT INTO demo_settings(tenant_id, geo_a_down, geo_b_down, notification_fail)
        VALUES ($1, $2, $3, $4) ON CONFLICT(tenant_id) DO UPDATE SET
          geo_a_down = EXCLUDED.geo_a_down, geo_b_down = EXCLUDED.geo_b_down,
          notification_fail = EXCLUDED.notification_fail, updated_at = now()
        RETURNING geo_a_down, geo_b_down, notification_fail`,
      [tenantId, next.geo_a_down, next.geo_b_down, next.notification_fail])).rows[0];
    },

    async getJobs(tenantId) {
      return (await pool.query(`SELECT j.*, s.widget_id, w.config ->> 'title' AS widget_title,
          CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'message', a.message, 'created_at', a.created_at) END AS failure_alert
        FROM notification_jobs j JOIN submissions s ON s.id = j.submission_id AND s.tenant_id = j.tenant_id
        JOIN widgets w ON w.id = s.widget_id AND w.tenant_id = s.tenant_id
        LEFT JOIN failure_alerts a ON a.job_id = j.id AND a.tenant_id = j.tenant_id
        WHERE j.tenant_id = $1 ORDER BY j.created_at DESC, j.id LIMIT 100`, [tenantId])).rows;
    },

    async claimJob() {
      return transaction(pool, async (client) => {
        const result = await client.query(`WITH candidate AS (
          SELECT id FROM notification_jobs
          WHERE (status = 'pending' AND available_at <= now())
            OR (status = 'processing' AND locked_at < now() - interval '60 seconds')
          ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE notification_jobs j SET status = 'processing', attempts = attempts + 1,
          locked_at = now(), updated_at = now() FROM candidate WHERE j.id = candidate.id RETURNING j.*`);
        if (!result.rowCount) return null;
        const job = result.rows[0];
        const detail = (await client.query(`SELECT s.fields, s.widget_id, w.config ->> 'title' AS widget_title
          FROM submissions s JOIN widgets w ON w.id = s.widget_id AND w.tenant_id = s.tenant_id
          WHERE s.id = $1 AND s.tenant_id = $2`, [job.submission_id, job.tenant_id])).rows[0];
        return { ...job, ...detail };
      });
    },

    async completeJob(id, expectedAttempt = null) {
      return (await pool.query(`UPDATE notification_jobs SET status = 'sent', locked_at = NULL,
        last_error = NULL, updated_at = now() WHERE id = $1 AND status = 'processing'
        AND ($2::integer IS NULL OR attempts = $2) RETURNING *`, [id, expectedAttempt])).rows[0] ?? null;
    },

    async failJob(id, errorMessage, delayMs, maxAttempts, expectedAttempt = null) {
      return transaction(pool, async (client) => {
        const message = String(errorMessage).slice(0, 1000);
        const result = await client.query(`UPDATE notification_jobs SET
          status = CASE WHEN attempts >= $4 THEN 'failed' ELSE 'pending' END,
          available_at = now() + $3 * interval '1 millisecond', locked_at = NULL,
          last_error = $2, updated_at = now() WHERE id = $1 AND status = 'processing'
          AND ($5::integer IS NULL OR attempts = $5) RETURNING *`,
        [id, message, Math.max(0, delayMs), maxAttempts, expectedAttempt]);
        const job = result.rows[0];
        if (!job) return null;
        if (job.status === 'failed') {
          await client.query(`INSERT INTO failure_alerts(tenant_id, job_id, message) VALUES ($1, $2, $3)
            ON CONFLICT(job_id) DO NOTHING`, [job.tenant_id, job.id, message]);
        }
        return job;
      });
    },

    async cleanup() {
      const [sessions, counters] = await Promise.all([
        pool.query('DELETE FROM sessions WHERE expires_at <= now()'),
        pool.query('DELETE FROM rate_limit_counters WHERE expires_at <= now()'),
      ]);
      return { sessions: sessions.rowCount, rateCounters: counters.rowCount };
    },

    async seedDemo({ passwordHash }) {
      return transaction(pool, async (client) => {
        const users = [];
        const widgets = [];
        for (const tenant of DEMO_TENANTS) {
          await client.query('INSERT INTO tenants(id, name) VALUES ($1, $2) ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name', [tenant.id, tenant.name]);
          const user = (await client.query(`INSERT INTO users(id, tenant_id, email, password_hash) VALUES ($1, $2, $3, $4)
            ON CONFLICT(id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash
            RETURNING id, tenant_id, email`, [tenant.userId, tenant.id, tenant.email, passwordHash])).rows[0];
          users.push({ ...user, tenant_name: tenant.name });
          const config = {
            type: 'contact',
            title: tenant.email.startsWith('alice') ? 'Let’s build something great' : 'Stay in the loop',
            description: 'Tell us a little about yourself. We’ll get back to you soon.',
            button_text: 'Send message',
            fields: [
              { name: 'name', label: 'Your name', type: 'text', required: false },
              { name: 'email', label: 'Email address', type: 'email', required: true },
              { name: 'message', label: 'How can we help?', type: 'textarea', required: false },
            ],
            display: { accent: '#165dff', position: 'inline' },
            active: true,
          };
          const widget = (await client.query(`INSERT INTO widgets(id, tenant_id, config) VALUES ($1, $2, $3)
            ON CONFLICT(id) DO UPDATE SET config = EXCLUDED.config, deleted_at = NULL, updated_at = now() RETURNING *`,
          [tenant.widgetId, tenant.id, config])).rows[0];
          widgets.push(widgetFromRow(widget));
          await client.query('INSERT INTO demo_settings(tenant_id) VALUES ($1) ON CONFLICT(tenant_id) DO NOTHING', [tenant.id]);
        }
        return { users, widgets };
      });
    },
  };
}
