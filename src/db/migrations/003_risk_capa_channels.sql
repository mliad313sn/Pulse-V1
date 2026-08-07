-- EPIC E11 (Risks + CAPA) and E20 (notification channel deliveries)
-- Master plan §28 (Risks), §29 (CAPA), §52-53 (notification channels)

CREATE TABLE risks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'OTHER' CHECK (category IN
    ('TECHNICAL','SECURITY','SCHEDULE','FINANCIAL','RESOURCE','VENDOR','OPERATIONAL','OTHER')),
  probability int NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact int NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score int GENERATED ALWAYS AS (probability * impact) STORED,
  treatment text CHECK (treatment IN ('AVOID','MITIGATE','TRANSFER','ACCEPT')),
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  target_date date,
  residual_probability int CHECK (residual_probability BETWEEN 1 AND 5),
  residual_impact int CHECK (residual_impact BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MITIGATING','CLOSED','REALISED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX risks_project_id_idx ON risks(project_id);
CREATE INDEX risks_owner_user_id_idx ON risks(owner_user_id);
CREATE INDEX risks_status_idx ON risks(status);
CREATE INDEX risks_target_date_idx ON risks(target_date);

CREATE TABLE capas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_type text NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN
    ('ROADBLOCK','RISK','AUDIT','INCIDENT','REVIEW','MANUAL')),
  roadblock_id bigint REFERENCES roadblocks(id) ON DELETE RESTRICT,
  risk_id bigint REFERENCES risks(id) ON DELETE RESTRICT,
  issue text NOT NULL,
  root_cause text,
  immediate_correction text,
  corrective_action text,
  preventive_action text,
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  verifier_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  due_date date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN
    ('OPEN','ANALYSIS','ACTION_PLANNED','IMPLEMENTATION','VERIFICATION','CLOSED')),
  evidence text,
  verification_date date,
  effectiveness text CHECK (effectiveness IN ('EFFECTIVE','PARTIALLY_EFFECTIVE','NOT_EFFECTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX capas_project_id_idx ON capas(project_id);
CREATE INDEX capas_roadblock_id_idx ON capas(roadblock_id);
CREATE INDEX capas_risk_id_idx ON capas(risk_id);
CREATE INDEX capas_owner_user_id_idx ON capas(owner_user_id);
CREATE INDEX capas_verifier_user_id_idx ON capas(verifier_user_id);
CREATE INDEX capas_status_idx ON capas(status);
CREATE INDEX capas_due_date_idx ON capas(due_date);

-- E20: per-channel delivery ledger (in-app rows live in notifications; email/Teams
-- go through adapters; the local sink CAPTURES instead of sending)
CREATE TABLE notification_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id bigint REFERENCES notifications(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('EMAIL','TEAMS','SINK')),
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('SENT','FAILED','CAPTURED')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_notification_id_idx ON notification_deliveries(notification_id);
CREATE INDEX notification_deliveries_status_idx ON notification_deliveries(status);

-- roadblock reopen support (plan §27: resolved cannot be escalated unless reopened with reason)
ALTER TABLE roadblocks ADD COLUMN reopen_reason text;
