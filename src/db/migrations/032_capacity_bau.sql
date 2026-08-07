-- PULSE ↔ SDP integration, PHASE 1 — capacity in HOURS, and imported BAU load.
--
-- PULSE already models project commitment as a percentage (resource_allocations)
-- and forecasts it (P3 capacity kernel). What it has never had is a denominator:
-- how many hours a person actually has. Without that, "50% allocated" is a
-- number with no units and headroom cannot be computed at all.
--
-- This migration adds the three missing pieces:
--   person_capacity   how many hours this person has this month (an HR fact)
--   bau_load          how much non-project work landed on them (imported)
--   effort_standard   how long a ticket of a given kind takes (a management
--                     decision, deliberately NOT derived from the data)
--
-- Defect D1 is fixed here. D2 and D3 are fixed in the service layer.

CREATE TABLE person_capacity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  -- fte, leave and training are HR facts. Column names are chosen so an HR
  -- feed can populate them later without a schema change.
  fte numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (fte > 0 AND fte <= 1.5),
  standard_hours numeric(6,2) NOT NULL DEFAULT 173 CHECK (standard_hours > 0),
  leave_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (leave_hours >= 0),
  training_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (training_hours >= 0),
  available_hours numeric(6,2) GENERATED ALWAYS AS
    (fte * standard_hours - leave_hours - training_hours) STORED,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  UNIQUE (user_id, period)
);
CREATE INDEX person_capacity_user_idx ON person_capacity (user_id) WHERE deleted_at IS NULL;
CREATE INDEX person_capacity_period_idx ON person_capacity (period);

-- Local copy of imported load. PULSE renders from THIS table, never from a
-- foreign table, so the capacity view still works when SDP is unreachable —
-- with a visible "as of" stamp so nobody mistakes stale for current.
CREATE TABLE bau_load (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  source text NOT NULL CHECK (source IN ('HELPDESK','TRACKER','INSPECTION','MEETING')),
  tickets int NOT NULL DEFAULT 0 CHECK (tickets >= 0),
  hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
  -- MEASURED  = real worklogs exist
  -- MODELLED  = ticket count × an effort standard set by management
  -- ESTIMATED = a human's judgement
  provenance text NOT NULL CHECK (provenance IN ('MEASURED','MODELLED','ESTIMATED')),
  source_system text NOT NULL DEFAULT 'SDP',
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, source)
);
CREATE INDEX bau_load_period_idx ON bau_load (period);
CREATE INDEX bau_load_user_idx ON bau_load (user_id);

-- Load that could NOT be attributed to a person. Kept deliberately visible:
-- a site cannot improve its headroom by failing to record tickets.
CREATE TABLE bau_unattributed (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  site_code text,
  reason text NOT NULL CHECK (reason IN ('NO_TECHNICIAN','UNRESOLVED_ALIAS','NO_TECH_GROUP','NO_PULSE_USER')),
  tickets int NOT NULL DEFAULT 0 CHECK (tickets >= 0),
  source_system text NOT NULL DEFAULT 'SDP',
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, site_code, reason)
);
CREATE INDEX bau_unattributed_period_idx ON bau_unattributed (period);

-- How long a ticket of a given type and category takes. Set by IT management
-- with a written rationale — never inferred from time_elapsed_ms, which is
-- wall-clock lead time and would produce absurd utilisation figures.
CREATE TABLE effort_standard (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_type text NOT NULL,
  category text NOT NULL,
  minutes int NOT NULL CHECK (minutes BETWEEN 5 AND 480),
  valid_from date NOT NULL,
  valid_to date,
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) >= 20),
  set_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_type, category, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX effort_standard_lookup_idx ON effort_standard (request_type, category) WHERE valid_to IS NULL;

-- Capacity overload is a real notification type.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('ROADBLOCK_ESCALATED','ACTION_ASSIGNED','MILESTONE_ASSIGNED','PROJECT_RED',
   'MEETING_SCHEDULED','PM_ASSIGNED','SYNC_HALTED','REMINDER','CHANGE_REQUEST','REPORT',
   'CAPACITY_OVERLOAD'));

-- Actions can now come from the helpdesk, an inspection or a department meeting.
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_source_check;
ALTER TABLE actions ADD CONSTRAINT actions_source_check CHECK (source IN
  ('MEETING','PROJECT','ROADBLOCK','HELPDESK','INSPECTION','DEPT_MEETING'));

-- Demand provenance: which meeting, which row, so re-import is idempotent and
-- an auditor can trace a funded project back to the conversation that started it.
ALTER TABLE demands ADD COLUMN source text
  CHECK (source IN ('PULSE','DEPT_MEETING','INSPECTION','HELPDESK'));
ALTER TABLE demands ADD COLUMN source_ref text;
CREATE UNIQUE INDEX demands_source_ref_ux ON demands (source, source_ref)
  WHERE source_ref IS NOT NULL AND deleted_at IS NULL;

-- ===== effort standards: the seed =====
-- Every value below is a PLACEHOLDER pending the owner named in decision Q3.
-- They are deliberately conservative and uniform so nobody mistakes them for
-- measured fact; the rationale text says so on every row.
INSERT INTO effort_standard (request_type, category, minutes, valid_from, rationale) VALUES
  ('Service Request','Software and Applications',30,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','ERP Support',45,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','IT Infrastructure',45,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','User Accounts and Access Permissions',15,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Accounts and Access',15,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Email',20,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','IT Hardware and Communication Devices',40,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Network & Internet Access',35,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Printing Services',25,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Hardware and Accessories',30,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Mobile & Communication Services',25,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Employee Movements',60,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Onboarding/offboarding is multi-step.'),
  ('Service Request','Enterprise Applications',45,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Badge d''accès site / Site Access Badge',20,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','IT Administrative task',30,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.'),
  ('Service Request','Unclassified',30,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Median service request assumption.'),

  ('Incident','IT Infrastructure',60,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests.'),
  ('Incident','Network & Internet Access',60,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests.'),
  ('Incident','Software and Applications',45,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests.'),
  ('Incident','ERP Support',60,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests.'),
  ('Incident','IT Hardware and Communication Devices',50,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests.'),
  ('Incident','Security Issues',90,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Security incidents assumed to require investigation.'),
  ('Incident','infosec',90,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Security incidents assumed to require investigation.'),
  ('Incident','Unclassified',45,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Median incident assumption.'),

  ('Event','Unclassified',15,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Events are largely automated notifications.'),
  ('Problem','Unclassified',120,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Problem records imply root-cause analysis.'),
  ('Change','Unclassified',90,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Change implementation plus CAB paperwork.'),
  ('Request For Information','Unclassified',15,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Informational responses assumed short.'),
  ('Security Incident','Unclassified',120,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Security incidents assumed to require investigation.'),
  ('Major Incident','Unclassified',240,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Major incidents involve multiple responders.'),
  ('Periodic System Access Audit','Periodic IT System Access Audit',180,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Access audits are scheduled bulk work.'),
  ('IT Inspection','Inspection',240,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Site inspection is a half-day activity.'),
  ('Unclassified','Unclassified',30,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Applies to the 6,704 rows with no request type.'),
  ('Unclassified','IT Policy Deviation',45,'2026-01-01','Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.')
ON CONFLICT (request_type, category, valid_from) DO NOTHING;
