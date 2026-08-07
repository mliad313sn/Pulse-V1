-- E21: reminder/escalation engine (plan §54, §135, §176)
-- reminder_log's unique key is the idempotency guard: one reminder per
-- object × threshold × recipient, no matter how often the job runs.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('ROADBLOCK_ESCALATED','ACTION_ASSIGNED','MILESTONE_ASSIGNED','PROJECT_RED',
   'MEETING_SCHEDULED','PM_ASSIGNED','SYNC_HALTED','REMINDER'));

CREATE TABLE reminder_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL,
  entity_id bigint NOT NULL,
  threshold text NOT NULL CHECK (threshold IN ('T-14','T-7','T-2','T0','T+1','T+7')),
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, entity_id, threshold, user_id)
);
CREATE INDEX reminder_log_entity_idx ON reminder_log(entity, entity_id);
