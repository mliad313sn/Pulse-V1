-- SPM Phase 10 (remainder) — external system integration.
-- The identity mapping is the part that must never rot: once a Pulse record is
-- tied to a Jira issue or a ServiceNow task, that pairing has to survive
-- renames on either side. The mapping is therefore keyed on the EXTERNAL ID
-- (which is immutable in the source system), never on a title.

CREATE TABLE external_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system text NOT NULL,                 -- adapter key: jira, ado, servicenow, …
  external_id text NOT NULL,            -- immutable id in the source system
  external_key text,                    -- human-facing key (PROJ-123) — may change
  external_url text,
  entity text NOT NULL,                 -- pulse entity: project, task, risk, …
  entity_id bigint NOT NULL,
  last_synced_at timestamptz,
  sync_state text NOT NULL DEFAULT 'LINKED'
    CHECK (sync_state IN ('LINKED','ERROR','ORPHANED')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  -- one external record maps to one Pulse record of a given kind, and vice versa
  UNIQUE (system, external_id, entity),
  UNIQUE (system, entity, entity_id)
);
CREATE INDEX external_links_entity_idx ON external_links (entity, entity_id);
