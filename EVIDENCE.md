# Acceptance evidence

Verified on 14 October 2026. All names, emails, and messages below are fictional demonstration data. Passwords and session tokens are excluded. The database tests use real PostgreSQL 16 in an isolated, automatically cleaned schema; provider faults are deterministic test doubles. Browser checks use the separate Docker customer site and API.

## Reproduce

Follow the [README](README.md) quickstart, then run:

```sh
docker compose exec api npm test
```

The full recorded test output is [docs/test-output.txt](docs/test-output.txt). Final result:

```text
tests 30
suites 1
pass 30
fail 0
cancelled 0
skipped 0
todo 0
```

The documented Docker test command was also run successfully inside the final Node 24 Alpine image: `tests 30`, `pass 30`, `fail 0`, `skipped 0` (1,216.97 ms).

## Section 6 checklist

Each item maps to the actual output, browser proof, or response recorded below.

- [x] Authenticated widget CRUD; invalid auth rejected — CRUD and authentication tests.
- [x] Tenant A cannot read/modify tenant B widgets or submissions — both tenant-isolation tests.
- [x] Embed snippet generated per widget — CRUD test verifies snippet and URL.
- [x] Small public config with HTTP cache headers — cache-contract test verifies ETag/304 and max-age=60.
- [x] Versioned widget JavaScript — cache-contract test plus live script status200 and immutable cache header.
- [x] Render on another origin — customer browser screenshot on port5500 with API on4000.
- [x] Cross-origin submissions/preflight — successful browser submission and recorded OPTIONS204.
- [x] Boundary validation and malformed/oversized JSON4xx — validation and payload-error tests.
- [x] Correctly linked persisted submissions — database constraint test and saved live responses.
- [x] Burst429 while legitimate traffic succeeds — per-IP, independent-IP and per-widget tests.
- [x] Spam blocked — honeypot test asserts no stored row.
- [x] Provider A unavailable → B enrichment — fallback test with mock-b result.
- [x] All providers unavailable → successful storage without geo — fallback test and Resilience Demo row.
- [x] Notification failure does not prevent storage — retries/alert test and real browser failure demonstration.
- [x] Documentation and submission pack — README architecture/setup/API/limitations, DESIGN.md, capstone.yaml, EVIDENCE.md, BUILDLOG.md, .env.example and MIT LICENSE are included.

## Design and hardened-path gates

- Repository was created before implementation: `50d7309`.
- Design was committed before the working API: `6c79136` ([DESIGN.md](DESIGN.md)).
- Hardened request path was committed as `9f1e4ee` after real migrations and seed succeeded.

Actual local cross-origin checkpoint:

```text
OPTIONS /submissions
Origin: http://localhost:5500
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,idempotency-key

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Idempotency-Key
```

The following fictional body was sent with a unique Idempotency-Key and JSON Content-Type:

```json
{"widget_id":"11111111-1111-4111-8111-111111111111","fields":{"name":"Capstone proof","email":"proof@example.test","message":"Cross-origin curl gate"},"website":""}
```

Recorded response (201 Created):

```json
{"id":"21474729-39d8-4f07-b7f6-988f34ad82d1","replayed":false,"geo":{"city":"Mumbai","country":"India","provider":"mock-a"}}
```

The owner subsequently saw this row in the browser submission list. Its notification job was processed by the separate worker. Mock location is deliberately labeled `mock-a`.

## Core product checks

| Check | Executed evidence |
| --- | --- |
| Authenticated widget create/read/update/delete | Passing test: `owner can create, read, update, embed, and delete a widget`. Includes a title-only PATCH preserving inactive/popover settings, nested display merge, and empty PATCH rejection. |
| Tenant isolation | Passing tests: `tenant A cannot list, read, edit, delete, or embed tenant B widgets` and `tenant A cannot read tenant B leads, filter by their widget, or see their jobs`. Authentication errors are JSON 401; foreign owner resources return 404. |
| Copyable embed code and public config | CRUD test verifies generated snippet and script URL; `public configuration and the versioned script have cross-origin cache contracts` verifies public shape, ETag/304, 60-second config cache, and immutable versioned script cache. |
| Embed rendered on a second origin | Browser opened `http://localhost:5500`, rendered a Shadow DOM form from `http://localhost:4000/widget.v1.js`, and submitted Jordan Demo / jordan@example.test. It displayed “You’re all set. Thanks for reaching out!” See [customer screenshot](docs/screenshots/customer.png). |
| POST submissions, validation, JSON errors and size cap | Passing tests: `malformed JSON, oversized bodies, invalid identifiers, and malformed pagination return JSON 4xx` and `submissions validate required, email, type, length, unknown, and configured custom fields`. Includes 16 KiB cap/413, malformed JSON/400, wrong charset and encoding/415. |
| Browser preflight and headers | Passing `cross-origin preflight permits the idempotency header without credentials`; live OPTIONS proof above; successful browser submission from port 5500. No owner session is sent by the embed. |
| Per-IP and per-widget throttling | Passing `per-IP throttling preserves access for a different legitimate IP`, `per-widget throttling limits a burst distributed across different IPs`, and `default trust-proxy ignores forged IP headers and still throttles the same client`. Assertions verify 429 and positive Retry-After. |
| Spam honeypot | Passing `honeypot and inactive widgets reject submissions without storing a lead`. The test verifies stored counts remain unchanged. |
| Geo A → B → null | Passing `geolocation tries A, falls back to B, and stores null while both providers are unavailable`. Five additional geo tests cover live-format responses, malformed replies, transport failure, private IP exclusion, and disabled mode. |
| Persist enriched submissions and show owner list | Browser owner login displayed Jordan Demo and Capstone proof with Mumbai/India, provider mock-a. See [submission screenshot](docs/screenshots/submissions.png). Repository tests verify stored fields, geo, ownership and timestamps. |
| Dashboard totals, dates, widgets and geo | Passing `dashboard aggregates equal the stored tenant-scoped leads and exclude other tenants`. Browser Overview showed 2 submissions, 2 notifications processed, 0 pending, India 2, and daily activity for 14 October. |

## Reliability and shared requirements

| Check | Executed evidence |
| --- | --- |
| Durable background work | New lead and notification job share one PostgreSQL transaction. Passing `a failed outbox insert rolls back the submission transaction` proves all-or-nothing persistence. |
| Bounded retries and visible failure alert | Passing `failed notifications retry, preserve the lead, and persist a terminal alert` asserts retry count, retained lead, unique persisted failure alert, and emitted alert event. Browser Failure lab additionally produced status `failed`, attempts `3`, “Notification delivery failed.” See [reliability screenshot](docs/screenshots/reliability.png). |
| No lead loss on dependency failure | In the real browser, all three simulation switches were enabled. Resilience Demo / resilience@example.test submitted successfully while both geo providers and notifications were unavailable. The worker exhausted three attempts. All switches were subsequently restored to false. |
| Idempotency and concurrency | Passing `submissions require a key, replay exactly once, and reject changed content with the same key` and `concurrent requests with the same key create one lead and one notification job`. Same content returns 200/replayed; changed content returns 409. |
| Worker interruption and concurrent claims | Passing `an interrupted worker lease can be recovered without creating another job` checks lease recovery and fencing of stale completions. Parallel claims in the retry test prove only one worker obtains the job. |
| Migrations, indexes and database integrity | Every integration run applies the real migration. Composite foreign keys reject mismatched tenant/widget relationships; index definitions are in [001_initial.sql](migrations/001_initial.sql). Migration checksums and advisory locks prevent inconsistent reapplication. |
| Layered architecture | HTTP/auth/validation in `src/app.js`; capture orchestration in `src/services.js`; provider adapter in `src/geo.js`; durable jobs in `src/jobs.js`/`src/worker.js`; parameterized persistence in `src/repository.js`. See DESIGN and README for the flow. |
| Session safety | Passing tests for random password salts, rejected wrong password, hashed session storage, expiry and immediate logout invalidation. Owner queries always derive tenant ID from the verified session. |
| Secrets and operations | `.env` is ignored and generated locally, `.env.example` has placeholders, Docker build excludes local secrets, and CI uses only an isolated disposable database. No runtime AI, paid services, real outbound email, or API keys are required. |

## Real external provider check

The live adapter was also called once using the public test address `8.8.8.8`, not a visitor's address, with a 4-second timeout per provider. Actual result:

```json
{"publicTestIp":"8.8.8.8","result":{"country":"United States","city":"San Jose","provider":"ipwho.is"}}
```

The fallback provider returned usable geo. This is a development smoke check, not a promise of provider availability. Reproducible acceptance uses mock providers. Loopback/private addresses intentionally return null in live mode.

## Persistence across the Docker restart

After restarting Docker Desktop and starting the same Compose stack, the API still returned all three demonstration leads and their durable jobs. Credential-free responses are saved in [docs/live-evidence.json](docs/live-evidence.json), recorded at 11:15 UTC (16:45 IST):

```json
{"total":3,"jobs":{"pending":0,"processing":0,"sent":2,"failed":1},"settings":{"geo_a_down":false,"geo_b_down":false,"notification_fail":false},"preflight":204,"script":{"status":200,"cache_control":"public, max-age=31536000, immutable"}}
```

The failed job retains a `failure_alert` and points to the saved Resilience Demo submission with `geo: null`. This confirms the browser outage result survived a real process/engine restart.

## Scope of these proofs

These results demonstrate a local capstone, not production readiness or a load test. Notifications use a console sink and do not send actual email. The owner UI and embedded form were checked in a desktop browser; automated tests primarily exercise HTTP/database behavior. The immutable script must receive a new filename/version for future behavior changes. Docker Desktop itself encountered host errors during setup; recovery and limitations are recorded in [BUILDLOG.md](BUILDLOG.md).
