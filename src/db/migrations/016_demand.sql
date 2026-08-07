-- SPM Phase 1 — Demand/Idea management: every project can start life as a
-- scored, prioritized, formally decided demand. Scoring inputs live on the
-- record; scores are COMPUTED (never typed) and explainable. Conversion to a
-- project is a governed, audited act that links both records forever.
CREATE TABLE demands (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  problem text,                     -- what hurts today
  outcome_hypothesis text,          -- what gets better if we do it
  requester_id bigint REFERENCES users(id),
  division_id bigint REFERENCES divisions(id),
  site_id bigint REFERENCES sites(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED')),
  -- business case
  estimated_cost numeric(14,2),
  estimated_effort_weeks numeric(6,1),
  -- scoring inputs (1..10 scales unless noted)
  business_value int CHECK (business_value BETWEEN 1 AND 10),
  time_criticality int CHECK (time_criticality BETWEEN 1 AND 10),
  risk_reduction int CHECK (risk_reduction BETWEEN 1 AND 10),
  reach int CHECK (reach >= 0),                 -- people/sites affected (RICE)
  impact numeric(4,2) CHECK (impact >= 0),      -- RICE impact factor
  confidence int CHECK (confidence BETWEEN 0 AND 100),  -- percent
  cost_of_delay_week numeric(14,2) CHECK (cost_of_delay_week >= 0),
  -- compliance/mandatory override: pinned to the top regardless of score
  mandatory boolean NOT NULL DEFAULT false,
  mandatory_reason text,
  -- decision
  decided_by bigint REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  converted_project_id bigint REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  CHECK (NOT mandatory OR length(trim(coalesce(mandatory_reason, ''))) >= 10)
);
CREATE INDEX demands_status_idx ON demands(status) WHERE deleted_at IS NULL;
CREATE INDEX demands_division_idx ON demands(division_id) WHERE deleted_at IS NULL;

ALTER TABLE projects ADD COLUMN demand_id bigint REFERENCES demands(id);
