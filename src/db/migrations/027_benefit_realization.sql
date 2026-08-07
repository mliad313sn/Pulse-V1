-- SPM Phase 4 (remainder) — benefit realization.
-- A benefit with a single "actual" column cannot answer the only question
-- that matters after go-live: is the value actually arriving, month after
-- month, and did it hold once the project team left? Measurements are
-- time-phased and explicitly allowed to continue AFTER the project closes.

ALTER TABLE benefits
  ADD COLUMN realization_start date,
  ADD COLUMN realization_end date,
  ADD COLUMN measurement_frequency text NOT NULL DEFAULT 'MONTHLY'
    CHECK (measurement_frequency IN ('MONTHLY','QUARTERLY','ANNUAL')),
  ADD COLUMN monetary boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT benefits_realization_window
    CHECK (realization_end IS NULL OR realization_start IS NULL OR realization_end >= realization_start);

CREATE TABLE benefit_measurements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  benefit_id bigint NOT NULL REFERENCES benefits(id),
  period char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),  -- YYYY-MM
  planned numeric(14,2),
  actual numeric(14,2),
  note text,
  -- true when recorded after the project closed: the honest test of whether
  -- a benefit was real or just a business-case number
  post_closure boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  UNIQUE (benefit_id, period)
);
CREATE INDEX benefit_measurements_benefit_idx ON benefit_measurements (benefit_id);
