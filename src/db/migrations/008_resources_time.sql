-- E16: resource allocation + time tracking (plan §40-41)
CREATE TABLE resource_allocations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workstream_id bigint REFERENCES workstreams(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  percent int NOT NULL CHECK (percent BETWEEN 1 AND 100),
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  CHECK (end_date >= start_date)
);
CREATE INDEX resource_allocations_project_id_idx ON resource_allocations(project_id);
CREATE INDEX resource_allocations_user_id_idx ON resource_allocations(user_id);
CREATE INDEX resource_allocations_dates_idx ON resource_allocations(start_date, end_date);

CREATE TABLE time_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workstream_id bigint REFERENCES workstreams(id) ON DELETE RESTRICT,
  task_id bigint REFERENCES tasks(id) ON DELETE RESTRICT,
  entry_date date NOT NULL,
  hours numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz
);
CREATE INDEX time_entries_user_id_idx ON time_entries(user_id);
CREATE INDEX time_entries_project_id_idx ON time_entries(project_id);
CREATE INDEX time_entries_task_id_idx ON time_entries(task_id);
CREATE INDEX time_entries_entry_date_idx ON time_entries(entry_date);
