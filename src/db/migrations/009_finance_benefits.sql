-- E17 finance (plan §42, §145) + E18 benefits (plan §43)
-- Finance visibility is a server-side capability: users.finance_access (Admin-set)
-- or ADMIN role. It gates the API, summaries and any export path.
ALTER TABLE users ADD COLUMN finance_access boolean NOT NULL DEFAULT false;

CREATE TABLE budget_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN
    ('Hardware','Software','Professional Services','Telecom','Travel','Training',
     'Internal Resource','Contingency','Other')),
  capex_opex text NOT NULL DEFAULT 'CAPEX' CHECK (capex_opex IN ('CAPEX','OPEX')),
  currency char(3) NOT NULL DEFAULT 'USD',
  approved numeric(14,2) NOT NULL DEFAULT 0 CHECK (approved >= 0),
  committed numeric(14,2) NOT NULL DEFAULT 0 CHECK (committed >= 0),
  actual numeric(14,2) NOT NULL DEFAULT 0 CHECK (actual >= 0),
  forecast numeric(14,2) NOT NULL DEFAULT 0 CHECK (forecast >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX budget_lines_project_id_idx ON budget_lines(project_id);
CREATE INDEX budget_lines_category_idx ON budget_lines(category);

CREATE TABLE benefits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  baseline numeric(14,2),
  target numeric(14,2),
  unit text,
  measure_method text,
  target_date date,
  actual numeric(14,2),
  status text NOT NULL DEFAULT 'DEFINED' CHECK (status IN
    ('DEFINED','ON_TRACK','AT_RISK','ACHIEVED','MISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX benefits_project_id_idx ON benefits(project_id);
CREATE INDEX benefits_owner_user_id_idx ON benefits(owner_user_id);
CREATE INDEX benefits_target_date_idx ON benefits(target_date);
