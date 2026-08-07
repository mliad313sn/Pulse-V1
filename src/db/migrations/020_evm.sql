-- SPM Phase 4 — time-phased cost plans (planned value by fiscal month, in the
-- USD base currency) powering earned-value metrics. One row per project+month.
CREATE TABLE cost_plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  period char(7) NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  planned numeric(14,2) NOT NULL CHECK (planned >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  UNIQUE (project_id, period)
);
CREATE INDEX cost_plans_project_idx ON cost_plans(project_id);
