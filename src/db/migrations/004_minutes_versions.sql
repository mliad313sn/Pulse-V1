-- E14: versioned meeting minutes (plan §39, §147). A closed minutes version is a
-- snapshot; re-closing after correcting the underlying objects creates the next
-- version. Prior versions remain readable. No update/delete path exists.
CREATE TABLE meeting_minutes_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id bigint NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
  version int NOT NULL,
  minutes_json jsonb NOT NULL,
  closed_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, version)
);
CREATE INDEX meeting_minutes_versions_meeting_id_idx ON meeting_minutes_versions(meeting_id);

-- backfill: existing closed meetings become version 1
INSERT INTO meeting_minutes_versions (meeting_id, version, minutes_json, closed_by)
SELECT m.id, 1, m.minutes_json, coalesce(m.created_by, (SELECT min(id) FROM users))
  FROM meetings m
 WHERE m.minutes_json IS NOT NULL AND m.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM users);
