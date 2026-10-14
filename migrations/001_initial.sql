CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_idx ON users(tenant_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(id, tenant_id)
);
CREATE INDEX widgets_tenant_idx ON widgets(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  widget_id uuid NOT NULL,
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  geo jsonb,
  ip_hash text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(widget_id, tenant_id) REFERENCES widgets(id, tenant_id),
  UNIQUE(widget_id, idempotency_key),
  UNIQUE(id, tenant_id)
);
CREATE INDEX submissions_tenant_time_idx ON submissions(tenant_id, created_at DESC, id);
CREATE INDEX submissions_widget_time_idx ON submissions(widget_id, created_at DESC, id);

CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  submission_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(submission_id, tenant_id) REFERENCES submissions(id, tenant_id),
  UNIQUE(id, tenant_id)
);
CREATE INDEX notification_jobs_pending_idx ON notification_jobs(available_at, created_at)
  WHERE status = 'pending';
CREATE INDEX notification_jobs_lease_idx ON notification_jobs(locked_at)
  WHERE status = 'processing';
CREATE INDEX notification_jobs_tenant_idx ON notification_jobs(tenant_id, created_at DESC);

CREATE TABLE failure_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_id uuid NOT NULL UNIQUE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(job_id, tenant_id) REFERENCES notification_jobs(id, tenant_id)
);
CREATE INDEX failure_alerts_tenant_idx ON failure_alerts(tenant_id, created_at DESC);

CREATE TABLE demo_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  geo_a_down boolean NOT NULL DEFAULT false,
  geo_b_down boolean NOT NULL DEFAULT false,
  notification_fail boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limit_counters (
  scope text NOT NULL,
  key text NOT NULL,
  hits bigint NOT NULL DEFAULT 1 CHECK (hits > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope, key)
);
CREATE INDEX rate_limit_expiry_idx ON rate_limit_counters(expires_at);
