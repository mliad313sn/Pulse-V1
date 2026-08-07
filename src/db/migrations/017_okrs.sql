-- SPM Phase 1 — objectives & key results: the strategy layer above the
-- portfolio hierarchy. Objectives hang off strategic pillars; key results are
-- measurable (baseline → target, current tracked); projects link to the
-- objectives they serve — the first edge of the decision graph
-- (Strategy → … → Outcome).
CREATE TABLE objectives (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  description text,
  pillar_id bigint REFERENCES strategic_pillars(id) ON DELETE RESTRICT,
  owner_user_id bigint REFERENCES users(id),
  period text NOT NULL,                -- e.g. '2026', '2026-H2'
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ACHIEVED','DROPPED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);

CREATE TABLE key_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  objective_id bigint NOT NULL REFERENCES objectives(id) ON DELETE RESTRICT,
  title text NOT NULL,
  baseline numeric(14,2) NOT NULL,
  target numeric(14,2) NOT NULL,
  current numeric(14,2),
  unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  CHECK (target <> baseline)
);
CREATE INDEX key_results_objective_idx ON key_results(objective_id) WHERE deleted_at IS NULL;

CREATE TABLE project_objectives (
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  objective_id bigint NOT NULL REFERENCES objectives(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  PRIMARY KEY (project_id, objective_id)
);
