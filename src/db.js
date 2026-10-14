import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const migrationDirectory = new URL('../migrations/', import.meta.url);

/** A separate schema keeps integration tests isolated from the demo database. */
export function createPool(connectionString, options = {}) {
  const { schema, ...poolOptions } = options;
  if (schema !== undefined && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('Database schema must be a lowercase PostgreSQL identifier.');
  }
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ...poolOptions,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  // Broken idle connections are discarded by pg; avoid an unhandled event crash.
  pool.on('error', error => console.error(JSON.stringify({ event: 'database_pool_error', code: error.code || 'connection_error' })));
  return pool;
}

/** Apply ordered migrations once; a schema-local lock serializes concurrent starts. */
export async function migrate(pool) {
  const files = (await readdir(migrationDirectory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext(current_database() || ':' || current_schema() || ':lead-capture-migrations'))",
    );
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Map((await client.query('SELECT filename, checksum FROM schema_migrations')).rows
      .map((row) => [row.filename, row.checksum]));
    for (const filename of files) {
      const sql = await readFile(new URL(filename, migrationDirectory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(filename)) {
        if (applied.get(filename) !== checksum) throw new Error(`Applied migration has changed: ${filename}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)', [filename, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
