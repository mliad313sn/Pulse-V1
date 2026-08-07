-- SPM Phase 2 (remainder) — working calendars, calendar exceptions and task
-- date constraints. A schedule that counts weekends and public holidays as
-- working time is wrong on every site; a plan that cannot express "this must
-- finish before the rains" cannot be trusted either.

CREATE TABLE calendars (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  -- ISO weekday numbers that are working days (1 = Monday … 7 = Sunday)
  working_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hours_per_day numeric(4,1) NOT NULL DEFAULT 8 CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  is_default boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX calendars_name_key ON calendars (lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX calendars_single_default ON calendars (is_default) WHERE is_default AND deleted_at IS NULL;

-- Named exceptions in both directions: a holiday (working = false) or a
-- recovery/shutdown weekend that IS worked (working = true).
CREATE TABLE calendar_exceptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calendar_id bigint NOT NULL REFERENCES calendars(id),
  exception_date date NOT NULL,
  working boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  UNIQUE (calendar_id, exception_date)
);

ALTER TABLE projects ADD COLUMN calendar_id bigint REFERENCES calendars(id);

-- Date constraints: ASAP is the default and preserves today's behaviour.
ALTER TABLE tasks
  ADD COLUMN constraint_type text NOT NULL DEFAULT 'ASAP'
    CHECK (constraint_type IN ('ASAP','START_NO_EARLIER_THAN','FINISH_NO_LATER_THAN',
                               'MUST_START_ON','MUST_FINISH_ON')),
  ADD COLUMN constraint_date date,
  ADD CONSTRAINT tasks_constraint_needs_date
    CHECK (constraint_type = 'ASAP' OR constraint_date IS NOT NULL);

-- The standard Monday–Friday calendar every project falls back to.
INSERT INTO calendars (name, working_days, hours_per_day, is_default, description)
VALUES ('Standard (Mon–Fri)', '{1,2,3,4,5}', 8, true, 'Default working week');
