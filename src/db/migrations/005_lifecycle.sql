-- E05: 7-stage lifecycle + separate operating status (plan §12).
-- Data mapping from the previous 6-stage model:
--   DESIGN → PLANNING · BUILD → EXECUTION · DEPLOY → DEPLOYMENT
--   ON_HOLD (stage) → stage PLANNING + operating_status ON_HOLD
-- Historical stage_transitions rows keep their original names (immutable ledger).

ALTER TABLE projects ADD COLUMN operating_status text NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE projects ADD COLUMN hold_reason text;
ALTER TABLE projects ADD COLUMN cancel_reason text;

ALTER TABLE projects DROP CONSTRAINT projects_stage_check;

UPDATE projects SET stage = 'PLANNING', operating_status = 'ON_HOLD',
       hold_reason = coalesce(hold_reason, 'Migrated from ON_HOLD stage')
 WHERE stage = 'ON_HOLD';
UPDATE projects SET stage = 'PLANNING'  WHERE stage = 'DESIGN';
UPDATE projects SET stage = 'EXECUTION' WHERE stage = 'BUILD';
UPDATE projects SET stage = 'DEPLOYMENT' WHERE stage = 'DEPLOY';
UPDATE projects SET operating_status = 'COMPLETED' WHERE stage = 'CLOSED';

ALTER TABLE projects ADD CONSTRAINT projects_stage_check CHECK (stage IN
  ('IDEA','INITIATION','PLANNING','EXECUTION','DEPLOYMENT','RUN','CLOSED'));
ALTER TABLE projects ADD CONSTRAINT projects_operating_status_check CHECK (operating_status IN
  ('NOT_STARTED','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED'));

CREATE INDEX projects_operating_status_idx ON projects(operating_status);
