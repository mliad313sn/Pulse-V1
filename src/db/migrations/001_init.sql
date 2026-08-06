-- PULSE schema v1 — PostgreSQL 16 (master plan §2)
-- Conventions: bigint identity PKs, timestamptz, text+CHECK enums, FKs ON DELETE RESTRICT,
-- soft delete via deleted_at (no hard DELETE), index every FK + due/status/date column.

-- ===== reference tables =====
CREATE TABLE divisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint,
  deleted_at timestamptz
);

CREATE TABLE sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint,
  deleted_at timestamptz
);

CREATE TABLE sequences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  next_value bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint,
  deleted_at timestamptz
);

-- ===== users =====
CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN','DIVISION_LEAD','CONTRIBUTOR','VIEWER')),
  division_id bigint REFERENCES divisions(id) ON DELETE RESTRICT,
  site_id bigint REFERENCES sites(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE INDEX users_division_id_idx ON users(division_id);
CREATE INDEX users_site_id_idx ON users(site_id);
CREATE INDEX users_created_by_idx ON users(created_by);

-- ===== projects =====
CREATE TABLE projects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  lead_division_id bigint NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  project_manager_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  sponsor text,
  stage text NOT NULL DEFAULT 'IDEA' CHECK (stage IN ('IDEA','DESIGN','BUILD','DEPLOY','RUN','CLOSED','ON_HOLD')),
  priority text NOT NULL DEFAULT 'P2' CHECK (priority IN ('P1','P2','P3')),
  start_date date,
  target_date date,
  actual_end_date date,
  budget_note text,
  roadmap_pillar text CHECK (roadmap_pillar IN ('Network','BizPartnering','Risk','People','Other')),
  confidential boolean NOT NULL DEFAULT false,
  rag_override text CHECK (rag_override IN ('G','A','R')),
  rag_override_reason text,
  exec_commentary text,
  rag_computed text NOT NULL DEFAULT 'G' CHECK (rag_computed IN ('G','A','R')),
  rag_signals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress_pct int NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  CONSTRAINT rag_override_reason_min CHECK (rag_override IS NULL OR char_length(coalesce(rag_override_reason,'')) >= 30)
);
CREATE INDEX projects_lead_division_id_idx ON projects(lead_division_id);
CREATE INDEX projects_project_manager_id_idx ON projects(project_manager_id);
CREATE INDEX projects_created_by_idx ON projects(created_by);
CREATE INDEX projects_stage_idx ON projects(stage);
CREATE INDEX projects_target_date_idx ON projects(target_date);
CREATE INDEX projects_rag_computed_idx ON projects(rag_computed);

CREATE TABLE project_divisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  division_id bigint NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  role_in_project text NOT NULL CHECK (role_in_project IN ('LEAD','ENGAGED','CONSULTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  UNIQUE (project_id, division_id)
);
CREATE INDEX project_divisions_project_id_idx ON project_divisions(project_id);
CREATE INDEX project_divisions_division_id_idx ON project_divisions(division_id);

CREATE TABLE project_sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  site_id bigint NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  UNIQUE (project_id, site_id)
);
CREATE INDEX project_sites_project_id_idx ON project_sites(project_id);
CREATE INDEX project_sites_site_id_idx ON project_sites(site_id);

-- ===== milestones =====
CREATE TABLE milestones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'STANDARD' CHECK (type IN ('STANDARD','SECURITY_GATE','SITE_READINESS','UAT','GO_LIVE')),
  owner_division_id bigint REFERENCES divisions(id) ON DELETE RESTRICT,
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  co_owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  site_id bigint REFERENCES sites(id) ON DELETE RESTRICT,
  due_date date,
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','DONE','SLIPPED')),
  done_date date,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX milestones_project_id_idx ON milestones(project_id);
CREATE INDEX milestones_owner_division_id_idx ON milestones(owner_division_id);
CREATE INDEX milestones_owner_user_id_idx ON milestones(owner_user_id);
CREATE INDEX milestones_co_owner_user_id_idx ON milestones(co_owner_user_id);
CREATE INDEX milestones_site_id_idx ON milestones(site_id);
CREATE INDEX milestones_due_date_idx ON milestones(due_date);
CREATE INDEX milestones_status_idx ON milestones(status);

-- ===== roadblocks =====
CREATE TABLE roadblocks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  severity text NOT NULL CHECK (severity IN ('CRITICAL','MAJOR','MINOR')),
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  raised_by_division_id bigint REFERENCES divisions(id) ON DELETE RESTRICT,
  due_date date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','ESCALATED')),
  resolution_note text,
  escalated_to bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX roadblocks_project_id_idx ON roadblocks(project_id);
CREATE INDEX roadblocks_owner_user_id_idx ON roadblocks(owner_user_id);
CREATE INDEX roadblocks_raised_by_division_id_idx ON roadblocks(raised_by_division_id);
CREATE INDEX roadblocks_escalated_to_idx ON roadblocks(escalated_to);
CREATE INDEX roadblocks_due_date_idx ON roadblocks(due_date);
CREATE INDEX roadblocks_status_idx ON roadblocks(status);
CREATE INDEX roadblocks_severity_idx ON roadblocks(severity);

-- ===== meetings =====
CREATE TABLE meetings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('INFRA_OPS_SYNC','PROJECT_REVIEW','ADHOC')),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','LIVE','CLOSED')),
  site_id bigint REFERENCES sites(id) ON DELETE RESTRICT,   -- optional site scope (§4.3)
  minutes_json jsonb,                                        -- structured minutes snapshot at close
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX meetings_site_id_idx ON meetings(site_id);
CREATE INDEX meetings_date_idx ON meetings(date);
CREATE INDEX meetings_status_idx ON meetings(status);
CREATE INDEX meetings_created_by_idx ON meetings(created_by);

CREATE TABLE meeting_attendees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id bigint NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  present boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  UNIQUE (meeting_id, user_id)
);
CREATE INDEX meeting_attendees_meeting_id_idx ON meeting_attendees(meeting_id);
CREATE INDEX meeting_attendees_user_id_idx ON meeting_attendees(user_id);

CREATE TABLE meeting_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id bigint NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  project_id bigint REFERENCES projects(id) ON DELETE RESTRICT,   -- nullable: ad-hoc items
  order_index int NOT NULL DEFAULT 0,
  notes text,
  reason text,                                                     -- which auto-agenda rule added it
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX meeting_items_meeting_id_idx ON meeting_items(meeting_id);
CREATE INDEX meeting_items_project_id_idx ON meeting_items(project_id);

CREATE TABLE decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  meeting_id bigint REFERENCES meetings(id) ON DELETE RESTRICT,
  text text NOT NULL,
  decided_by text,
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX decisions_project_id_idx ON decisions(project_id);
CREATE INDEX decisions_meeting_id_idx ON decisions(meeting_id);
CREATE INDEX decisions_date_idx ON decisions(date);

-- ===== actions =====
CREATE TABLE actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE RESTRICT,   -- nullable: general action
  meeting_id bigint REFERENCES meetings(id) ON DELETE RESTRICT,
  title text NOT NULL,
  owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
  done_date date,
  source text NOT NULL DEFAULT 'PROJECT' CHECK (source IN ('MEETING','PROJECT','ROADBLOCK')),
  roadblock_id bigint REFERENCES roadblocks(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX actions_project_id_idx ON actions(project_id);
CREATE INDEX actions_meeting_id_idx ON actions(meeting_id);
CREATE INDEX actions_owner_user_id_idx ON actions(owner_user_id);
CREATE INDEX actions_roadblock_id_idx ON actions(roadblock_id);
CREATE INDEX actions_due_date_idx ON actions(due_date);
CREATE INDEX actions_status_idx ON actions(status);

-- ===== status updates =====
CREATE TABLE status_updates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  author_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mood text NOT NULL CHECK (mood IN ('ON_TRACK','WATCH','AT_RISK')),
  summary text NOT NULL CHECK (char_length(summary) <= 400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX status_updates_project_id_idx ON status_updates(project_id);
CREATE INDEX status_updates_author_id_idx ON status_updates(author_id);
CREATE INDEX status_updates_date_idx ON status_updates(date);

-- ===== readiness =====
CREATE TABLE readiness_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  milestone_id bigint NOT NULL REFERENCES milestones(id) ON DELETE RESTRICT,
  label text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  checked_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX readiness_items_milestone_id_idx ON readiness_items(milestone_id);
CREATE INDEX readiness_items_checked_by_idx ON readiness_items(checked_by);

-- ===== notifications =====
CREATE TABLE notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('ROADBLOCK_ESCALATED','ACTION_ASSIGNED','MILESTONE_ASSIGNED','PROJECT_RED','MEETING_SCHEDULED','PM_ASSIGNED')),
  entity text NOT NULL,
  entity_id bigint NOT NULL,
  text text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX notifications_user_id_idx ON notifications(user_id);
CREATE INDEX notifications_read_at_idx ON notifications(read_at);

-- ===== rag history =====
CREATE TABLE rag_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  snapshot_date date NOT NULL,
  rag text NOT NULL CHECK (rag IN ('G','A','R')),
  progress_pct int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, snapshot_date)
);
CREATE INDEX rag_history_project_id_idx ON rag_history(project_id);
CREATE INDEX rag_history_snapshot_date_idx ON rag_history(snapshot_date);

-- ===== audit log =====
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL,
  entity_id bigint,
  field text,
  old_value text,
  new_value text,
  user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity, entity_id);
CREATE INDEX audit_log_user_id_idx ON audit_log(user_id);
CREATE INDEX audit_log_timestamp_idx ON audit_log(timestamp);

-- ===== sessions (connect-pg-simple) =====
CREATE TABLE session (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session(expire);

-- deferred FKs (reference tables created before users)
ALTER TABLE divisions ADD CONSTRAINT divisions_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE sites ADD CONSTRAINT sites_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE sequences ADD CONSTRAINT sequences_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
