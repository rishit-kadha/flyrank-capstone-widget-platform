# Build log

## 14 October 2026 — design

The user selected this PDF capstone and asked for a new repository. Created the dedicated public repository before implementation, with README, ignore rules, and MIT license; committed the design separately. Chose Node/Express, PostgreSQL, and plain browser JavaScript. Runtime AI is not used, so there are no AI API calls, tokens, or costs to budget.

## Phase 2 — hardened submissions

AI assistance wrote the initial HTTP/services code, database migrations/repositories, and deterministic tests. Work was split into independent database, frontend, and acceptance reviews. The implementation includes strict boundary schemas, wildcard public CORS without credentials, atomic Postgres rate counters, honeypot checks, tenant scoping, and submission/outbox idempotency.

The first Docker startup did not recover the engine. After the user reported a Docker error, restarted Docker Desktop; its engine recovered and the new Postgres service started. Real migrations and seed succeeded.

Review caught a concrete AI implementation mistake: Zod defaults were retained by a partial schema, so a title-only PATCH could reset a widget's type, display options, and active state. Replaced it with explicit default-free PATCH fields and merged nested display values; added a preservation regression.

Review also found that body-parser's unsupported charset/encoding errors were accidentally converted to500. Added explicit415 JSON handling and regression coverage. These are meaningful fixes, not claims that the initial generated code was correct.

Phase 2 live gate: OPTIONS from http://localhost:5500 returned204 with public CORS headers; POST /submissions returned201 with a persisted lead and mock-a geo. A notification job was enqueued in the same transaction. Mock geo is labeled as simulated, not real visitor location.

## Phase 3 — embed, owner dashboard, and verification

Built the Relay owner interface and a separate Studio June customer site in plain JavaScript/CSS. The embed loads public configuration, renders inside Shadow DOM, validates browser inputs, retains idempotency keys across ambiguous failures, and displays submission outcomes. The owner can manage widget fields and appearance, copy an embed, inspect submissions and analytics, and simulate dependency failures.

Independent acceptance review exercised a real PostgreSQL database: 30 tests passed, zero skipped. The suite tests observable boundaries and persistence failures, including concurrent requests, transaction rollback, stale worker leases, foreign-tenant access, throttling, and fallback behavior. CI runs the same suite in a disposable PostgreSQL service.

A real test found another integration mistake: Express sendFile rejected an absolute asset path beneath the local .codex directory as a hidden path. Changed it to a filename with an explicit public root, keeping dotfile protections. Added a sanitized idle-pool error listener so a database connection interruption cannot trigger an unhandled pool error.

Browser verification on ports 5500 and 4000 confirmed the embedded form renders, a fictional submission succeeds, and the owner sees its saved fields and location. Enabled both geo failures and notification failure, submitted again, observed success followed by a failed outbox job after three attempts, then restored all failure switches. Saved customer, submissions, and reliability screenshots. The notification sink remains a local console demonstration; no actual email was sent.

A development lookup of the public address 8.8.8.8 reached the live fallback provider and returned United States / San Jose / ipwho.is. This did not send any visitor's address. Deterministic acceptance still defaults to mock enrichment.

Docker Desktop's engine stopped again during final packaging after the browser checks had passed. Restarted it and brought the same four services up successfully. The recovered API retained all three demonstration leads, two completed jobs, one failed job with its alert, and restored failure settings. Saved the credential-free responses in docs/live-evidence.json. This verified volume persistence across a real engine restart.

## Ownership and limitations

The code and tests were AI-assisted; this log does not claim manual authorship. The owner should be ready to explain tenant predicates, request hashing/idempotency, CORS, the outbox transaction, and worker retry/lease behavior. No real emails were sent, no API keys or paid accounts were used, and no lead data was sent to an AI service.
