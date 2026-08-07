-- SPM Phase 3 — resource & capacity intelligence.
-- Three additions, none destructive:
--   1. a skills catalogue with per-person proficiency/certification,
--   2. allocation TYPE (project work vs BAU vs leave) and COMMITMENT
--      (committed vs tentative) so capacity reflects reality, not just
--      project bookings,
--   3. role-based resource requests — demand for a skill/role raised and
--      approved BEFORE anyone is named.

CREATE TABLE skills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX skills_name_key ON skills (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE user_skills (
  user_id bigint NOT NULL REFERENCES users(id),
  skill_id bigint NOT NULL REFERENCES skills(id),
  proficiency int NOT NULL CHECK (proficiency BETWEEN 1 AND 5),
  years_experience numeric(4,1) CHECK (years_experience >= 0),
  certified boolean NOT NULL DEFAULT false,
  certification_name text,
  certification_expires date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  PRIMARY KEY (user_id, skill_id)
);

-- Non-project time is real capacity consumption: BAU and LEAVE rows carry no
-- project, so project_id becomes nullable and is required only for PROJECT.
ALTER TABLE resource_allocations ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE resource_allocations
  ADD COLUMN allocation_type text NOT NULL DEFAULT 'PROJECT'
    CHECK (allocation_type IN ('PROJECT','BAU','LEAVE')),
  ADD COLUMN commitment text NOT NULL DEFAULT 'COMMITTED'
    CHECK (commitment IN ('COMMITTED','TENTATIVE')),
  ADD CONSTRAINT resource_allocations_project_required
    CHECK (allocation_type <> 'PROJECT' OR project_id IS NOT NULL);

CREATE TABLE resource_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id),
  role text NOT NULL,
  skill_id bigint REFERENCES skills(id),
  min_proficiency int CHECK (min_proficiency BETWEEN 1 AND 5),
  percent int NOT NULL CHECK (percent BETWEEN 1 AND 100),
  start_date date NOT NULL,
  end_date date NOT NULL,
  site_id bigint REFERENCES sites(id),
  notes text,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','FILLED')),
  fulfilled_user_id bigint REFERENCES users(id),
  allocation_id bigint REFERENCES resource_allocations(id),
  decided_by bigint REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  CHECK (end_date >= start_date)
);
CREATE INDEX resource_requests_project_idx ON resource_requests (project_id);
CREATE INDEX resource_requests_status_idx ON resource_requests (status);
