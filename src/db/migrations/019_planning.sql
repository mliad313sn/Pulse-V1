-- SPM Phase 2 — advanced planning: WBS parent/summary tasks, remaining
-- effort, task-level baselines (immutable snapshots for variance), and
-- first-class CROSS-PROJECT dependencies for blast-radius analysis.
ALTER TABLE tasks ADD COLUMN parent_task_id bigint REFERENCES tasks(id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD COLUMN remaining_hours numeric(8,2) CHECK (remaining_hours IS NULL OR remaining_hours >= 0);
CREATE INDEX tasks_parent_idx ON tasks(parent_task_id) WHERE deleted_at IS NULL;

CREATE TABLE task_baselines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version int NOT NULL,
  label text NOT NULL,
  tasks_json jsonb NOT NULL,           -- [{id,title,planned_start,planned_finish,estimated_hours}]
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  UNIQUE (project_id, version)
);

CREATE TABLE project_dependencies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  predecessor_project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  successor_project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  UNIQUE (predecessor_project_id, successor_project_id),
  CHECK (predecessor_project_id <> successor_project_id)
);
CREATE INDEX project_deps_succ_idx ON project_dependencies(successor_project_id) WHERE deleted_at IS NULL;
