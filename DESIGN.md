# Design: embeddable lead-capture platform

## Problem and scope

An owner defines a widget, copies one script tag to an external site, and receives validated leads in a private dashboard. Node.js/Express separates HTTP validation from services and parameterized PostgreSQL repositories. Plain JS renders the embed in an isolated shadow root. No hosting or paid accounts. Explicit non-goal: a general-purpose drag-and-drop form builder or production email service.

## Data and isolation

`tenants` owns users and widgets. Passwords use scrypt with random salts; opaque session tokens are stored only as SHA-256 hashes with expiry. Every owner repository query includes tenant_id. `widgets` stores a validated JSON config; `submissions` references (widget_id, tenant_id) with a composite foreign key, indexed by tenant/time and widget/time. The unique (widget_id, idempotency_key) constraint prevents repeated submissions. A request hash rejects key reuse with changed content. Submission insert and notification-outbox insert share a transaction. A leased PostgreSQL job queue uses SKIP LOCKED, bounded retries, terminal failed status, and a persisted failure alert. Rate-limit counters are atomic Postgres rows, shared across processes.

## Request paths

```text
Owner browser -> /api/auth/login -> opaque bearer session
              -> /api/widgets CRUD -> tenant-scoped repository -> Postgres
Customer :5500 -> /widget.v1.js?id=UUID -> /widgets/:id/config
Visitor        -> POST /submissions (CORS, body cap, validation, honeypot,
                  per-IP + per-widget rate limits, geo A -> B -> null)
               -> transaction: submission + notification job
Worker         -> claim outbox -> console notification -> retry/failure alert
Owner          -> /api/submissions + /api/dashboard + /api/jobs
```

## API contracts

All errors are JSON `{error:{code,message,details?}}`. Public CORS uses `*` without credentials; owner endpoints are same-origin with bearer tokens. Malformed JSON 400; schema errors400; missing/invalid auth401; missing/non-owned resources404; oversized body413; idempotency conflict409; spam400; rate429 + Retry-After. Public submissions return201 `{id,replayed:false,geo}` or200 replay. Geo data is approximate, nullable, and identifies its provider. No client-supplied IP is accepted; trust-proxy defaults off.

- POST `/api/auth/login` {email,password} -> {access_token,user:{email,tenant_id}}; POST `/api/auth/logout` ->204; GET `/api/auth/me`.
- GET/POST `/api/widgets`; GET/PATCH/DELETE `/api/widgets/:id`; GET `/api/widgets/:id/embed` -> {snippet,script_url}.
- Widget body: {type:signup|contact|popover,title,description,button_text,fields:[{name,label,type:text|email|textarea,required}],display:{accent,position:inline|bottom-right},active}. PATCH is partial. Names are plain identifiers, unique, and exclude reserved names.
- GET `/widgets/:id/config` -> public widget {id,type,title,description,button_text,fields,display}; Cache-Control public,max-age=60 and ETag. Versioned `/widget.v1.js` has public,max-age=31536000,immutable.
- POST `/submissions` {widget_id,fields:{name:string,...},website?:string}; header Idempotency-Key required. Validate fields against the current widget config, including unknown fields. Honeypot website must be empty.
- GET `/api/submissions?widget_id=&limit=&offset=` -> {items,total}; GET `/api/submissions/:id`.
- GET `/api/dashboard` -> {total,by_day:[{date,count}],by_widget:[{widget_id,title,count}],by_country:[{country,count}],jobs:{pending,processing,sent,failed}}.
- GET `/api/jobs` -> {items}; GET/PUT `/api/demo/failures` -> {geo_a_down,geo_b_down,notification_fail}. Demo controls are tenant scoped, authenticated, and disabled by DEMO_CONTROLS=false.
- GET `/health` checks database reachability. Owner UI at `/`; separate customer page on5500, seeded widget id11111111-1111-4111-8111-111111111111.

## Defaults and dependencies

API4000, customer5500, Postgres5433 on host. GEO_MODE=mock is deterministic; optional live uses two free providers with timeouts and validates their responses. Mock data is labeled. Notification is a console sink with no contact data logged. Worker runs separately; queued work survives process restart. No runtime AI is used, so AI API cost is zero. BUILDLOG records AI-assisted implementation. Local env initialization generates random DB/demo passwords; nothing real is committed.
