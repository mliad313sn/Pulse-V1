-- SPM Phase 10 — platform webhooks with a durable outbox.
-- A domain event is enqueued as delivery rows IN THE SAME TRANSACTION as the
-- change that caused it (nothing is lost on crash), then a worker delivers
-- with retry/backoff; exhausted deliveries land in DEAD (a DLQ that Admins
-- can inspect and redrive).
CREATE TABLE webhook_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',            -- empty array = all events
  active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);

CREATE TABLE webhook_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id bigint NOT NULL REFERENCES webhook_subscriptions(id),
  event text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FAILED','DELIVERED','DEAD')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries (next_attempt_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX webhook_deliveries_sub_idx ON webhook_deliveries (subscription_id);
