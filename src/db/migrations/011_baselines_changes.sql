-- E06 — change control + baselines (plan §15): material changes go through a
-- Change Request; every approved change captures a new immutable baseline
-- snapshot. The original baseline (version 1) and all later versions are
-- retained forever — forecast edits never touch them.
CREATE TABLE project_baselines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version int NOT NULL,
  label text NOT NULL,
  start_date date,
  target_date date,
  budget_approved numeric(14,2),
  milestones_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_request_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  UNIQUE (project_id, version)
);

CREATE TABLE change_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('SCOPE','SCHEDULE','BUDGET','BENEFIT','RESOURCE','CANCELLATION')),
  title text NOT NULL,
  rationale text NOT NULL,
  impact_analysis text,
  affected_milestones text,
  cost_impact numeric(14,2),
  schedule_impact_days int,
  risk_impact text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decision_note text,
  approver_id bigint REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE INDEX change_requests_project_idx ON change_requests (project_id) WHERE deleted_at IS NULL;

ALTER TABLE project_baselines
  ADD CONSTRAINT project_baselines_cr_fk FOREIGN KEY (change_request_id) REFERENCES change_requests(id);

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('ROADBLOCK_ESCALATED','ACTION_ASSIGNED','MILESTONE_ASSIGNED','PROJECT_RED',
   'MEETING_SCHEDULED','PM_ASSIGNED','SYNC_HALTED','REMINDER','CHANGE_REQUEST'));
