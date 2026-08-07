-- SPM Phase 6 — first-class scenario objects: named what-ifs over the
-- portfolio (defer/stop/budget moves), decided by Steering, and promotable
-- into governed change requests — simulation never mutates real data.
CREATE TABLE scenarios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  description text,
  moves_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','REJECTED','PROMOTED')),
  decided_by bigint REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
