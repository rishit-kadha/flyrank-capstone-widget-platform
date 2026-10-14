# Acceptance tests

`npm test` runs HTTP integration tests against a real PostgreSQL database. Set
`TEST_DATABASE_URL` (or `DATABASE_URL` in `.env`) to a local database whose role can
create schemas. Each run creates a random `test_<hex>` schema, applies the real
migrations, and seeds two unrelated tenants. Cleanup drops only that exact,
validated schema. No existing application rows are modified.

The suite covers:

- Authentication, logout, tenant-scoped widget CRUD, leads, and dashboard totals.
- Public CORS preflight, versioned embed caching, and public configuration.
- Malformed and oversized JSON, widget-specific fields, unknown fields, and spam.
- Default proxy-header handling, per-IP throttling, and per-widget throttling.
- Primary/fallback geolocation and continued acceptance when both providers fail.
- Submission persistence, required idempotency keys, replay conflicts, and races.
- Transactional notification jobs, retries, terminal failure alerts, and recovery
  of a worker lease after a simulated process crash.

HTTP calls use ephemeral local ports. Geolocation uses deterministic mock
providers and notifications use an injected sink, so the suite needs no external
API account or network access beyond the local PostgreSQL connection.
