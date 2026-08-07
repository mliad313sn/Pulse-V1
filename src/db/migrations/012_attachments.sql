-- E24 — documents & attachments (plan §51): metadata in Postgres, bytes in a
-- pluggable storage adapter (local disk here; S3-compatible contract in the
-- adapter module). storage_key is random — never derived from the filename —
-- so key isolation holds even with hostile names.
CREATE TABLE attachments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  entity_type text NOT NULL DEFAULT 'project' CHECK (entity_type IN
    ('project','milestone','roadblock','decision','deliverable','meeting','task','capa','gate')),
  entity_id bigint,
  filename text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  storage_key text NOT NULL UNIQUE,
  version int NOT NULL DEFAULT 1,
  description text,
  classification text NOT NULL DEFAULT 'GENERAL' CHECK (classification IN ('GENERAL','CONFIDENTIAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE INDEX attachments_project_idx ON attachments (project_id) WHERE deleted_at IS NULL;
CREATE INDEX attachments_entity_idx ON attachments (entity_type, entity_id) WHERE deleted_at IS NULL;
