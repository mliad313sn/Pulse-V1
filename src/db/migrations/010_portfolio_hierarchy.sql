-- E04 — portfolio hierarchy (plan §10): Strategic Pillar → Portfolio → Program
-- (optional) → Project. Projects may attach directly to a Portfolio; when a
-- Program is set its Portfolio must match the project's (enforced in service).
CREATE TABLE strategic_pillars (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX strategic_pillars_name_ux ON strategic_pillars (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE portfolios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  description text,
  objective text,
  pillar_id bigint REFERENCES strategic_pillars(id) ON DELETE RESTRICT,
  owner_user_id bigint REFERENCES users(id),
  horizon_start date,
  horizon_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX portfolios_title_ux ON portfolios (lower(title)) WHERE deleted_at IS NULL;

CREATE TABLE programs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  objective text,
  portfolio_id bigint NOT NULL REFERENCES portfolios(id) ON DELETE RESTRICT,
  owner_user_id bigint REFERENCES users(id),
  horizon_start date,
  horizon_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE INDEX programs_portfolio_idx ON programs (portfolio_id);

ALTER TABLE projects ADD COLUMN portfolio_id bigint REFERENCES portfolios(id) ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN program_id bigint REFERENCES programs(id) ON DELETE RESTRICT;
CREATE INDEX projects_portfolio_idx ON projects (portfolio_id) WHERE deleted_at IS NULL;
CREATE INDEX projects_program_idx ON projects (program_id) WHERE deleted_at IS NULL;
