-- E30/RA-16 — scheduled report dispatch ledger: one digest per report, period
-- and recipient, no matter how often the job runs. Content is computed per
-- recipient through the same authorization predicate as the dashboards.
CREATE TABLE report_dispatch_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_key text NOT NULL,
  period text NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_key, period, user_id)
);

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('ROADBLOCK_ESCALATED','ACTION_ASSIGNED','MILESTONE_ASSIGNED','PROJECT_RED',
   'MEETING_SCHEDULED','PM_ASSIGNED','SYNC_HALTED','REMINDER','CHANGE_REQUEST','REPORT'));
