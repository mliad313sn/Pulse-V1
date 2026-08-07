-- Ecosystem baseline (Pulse-V1 sync queue + ITPM360 stage gates + OpsPm360 RACI/War Room)
-- Additive: nothing existing changes shape. updated_at already serves as last_modified;
-- sync state lives client-side (IndexedDB queue) + server-side in the sync_ops ledger.

-- ITPM360: governance flags on users
ALTER TABLE users ADD COLUMN is_steering_committee boolean NOT NULL DEFAULT false;
-- OpsPm360: site isolation — false = user sees ONLY projects touching their own site
ALTER TABLE users ADD COLUMN enterprise_access boolean NOT NULL DEFAULT true;

-- ITPM360: auditable stage-gate ledger — every approved transition, who and when
CREATE TABLE stage_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  approved_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stage_transitions_project_id_idx ON stage_transitions(project_id);
CREATE INDEX stage_transitions_approved_by_idx ON stage_transitions(approved_by);

-- OpsPm360: deliverables + RACI matrix
CREATE TABLE deliverables (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  due_date date,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','DELIVERED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX deliverables_project_id_idx ON deliverables(project_id);
CREATE INDEX deliverables_due_date_idx ON deliverables(due_date);
CREATE INDEX deliverables_status_idx ON deliverables(status);

CREATE TABLE raci_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deliverable_id bigint NOT NULL REFERENCES deliverables(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  raci_role text NOT NULL CHECK (raci_role IN ('R','A','C','I')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  UNIQUE (deliverable_id, user_id, raci_role)
);
CREATE INDEX raci_assignments_deliverable_id_idx ON raci_assignments(deliverable_id);
CREATE INDEX raci_assignments_user_id_idx ON raci_assignments(user_id);

-- Pulse-V1 sync: a halted queue is worth its own notification type
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('ROADBLOCK_ESCALATED','ACTION_ASSIGNED','MILESTONE_ASSIGNED','PROJECT_RED',
   'MEETING_SCHEDULED','PM_ASSIGNED','SYNC_HALTED'));

-- Pulse-V1 sync: idempotency ledger — an offline op replayed twice applies once
CREATE TABLE sync_ops (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  op_id text NOT NULL UNIQUE,
  user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  method text NOT NULL,
  path text NOT NULL,
  status_code int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_ops_user_id_idx ON sync_ops(user_id);
