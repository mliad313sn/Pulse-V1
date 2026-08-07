-- E07: workstreams, tasks, dependencies (plan §17-18, §20, §184)
CREATE TABLE workstreams (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  lead_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','DONE','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX workstreams_project_id_idx ON workstreams(project_id);
CREATE INDEX workstreams_lead_user_id_idx ON workstreams(lead_user_id);

CREATE TABLE tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workstream_id bigint REFERENCES workstreams(id) ON DELETE RESTRICT,
  milestone_id bigint REFERENCES milestones(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  estimated_hours numeric(8,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  actual_hours numeric(8,2) CHECK (actual_hours IS NULL OR actual_hours >= 0),
  priority text NOT NULL DEFAULT 'P2' CHECK (priority IN ('P1','P2','P3')),
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  CHECK (planned_finish IS NULL OR planned_start IS NULL OR planned_finish >= planned_start)
);
CREATE INDEX tasks_project_id_idx ON tasks(project_id);
CREATE INDEX tasks_workstream_id_idx ON tasks(workstream_id);
CREATE INDEX tasks_milestone_id_idx ON tasks(milestone_id);
CREATE INDEX tasks_owner_user_id_idx ON tasks(owner_user_id);
CREATE INDEX tasks_status_idx ON tasks(status);
CREATE INDEX tasks_planned_finish_idx ON tasks(planned_finish);

CREATE TABLE task_dependencies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  predecessor_task_id bigint NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  successor_task_id bigint NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  dep_type text NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS','SS','FF','SF')),
  lag_days int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  UNIQUE (predecessor_task_id, successor_task_id),
  CHECK (predecessor_task_id <> successor_task_id)
);
CREATE INDEX task_dependencies_pred_idx ON task_dependencies(predecessor_task_id);
CREATE INDEX task_dependencies_succ_idx ON task_dependencies(successor_task_id);
