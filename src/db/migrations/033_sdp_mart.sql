-- PULSE ↔ SDP integration, PHASE 1 — the read interface and the mart.
--
-- ARCHITECTURE NOTE. Everything downstream reads from schema `sdp_fdw`. What
-- sits there depends on the deployment:
--
--   production  : foreign tables via postgres_fdw, created by
--                 scripts/setup_sdp_fdw.js using a SELECT-only role
--   dev / test  : the local staging tables created below, same shape, empty
--
-- The mart views, the import job, the API and the UI are identical either way,
-- so connecting the real SDP database is a configuration change and not a code
-- change. Nothing in PULSE ever writes to SDP: the staging tables here are
-- PULSE-local, and the production path grants SELECT only.
--
-- Column types mirror the pg_dump of sdp_dashboard 17.2. Only the columns this
-- programme actually reads are declared — importing 79 tables wholesale would
-- pull personal data we have no reason to hold (§3.3).

CREATE SCHEMA IF NOT EXISTS sdp_fdw;
CREATE SCHEMA IF NOT EXISTS mart;

-- ===== the SDP shape (read-only interface) =====

CREATE TABLE sdp_fdw.request_records (
  request_id     bigint PRIMARY KEY,
  display_id     text,
  created_time   timestamptz,
  assigned_time  timestamptz,
  resolved_time  timestamptz,
  technician     text,          -- free text, 76 distinct spellings
  tech_group     text,          -- THE workload key: who did the work
  site           text,          -- requester location, 120+ dirty values — NOT the workload key
  request_type   text,
  category       text,
  subcategory    text,
  priority       text,
  status         text,
  pending_status text,
  overdue_status int,
  reopen_count   int,           -- 0.3% populated — do not build a KPI on it
  is_escalated   int,           -- dead field, 0 rows in 2026
  time_elapsed_ms bigint        -- WALL-CLOCK LEAD TIME, NOT EFFORT. Never present as hours.
);
CREATE INDEX sdp_rr_created_idx ON sdp_fdw.request_records (created_time);
CREATE INDEX sdp_rr_tech_idx ON sdp_fdw.request_records (technician);
CREATE INDEX sdp_rr_group_idx ON sdp_fdw.request_records (tech_group);

-- Phase 3 target. Empty until syncWorklogData() runs on the SDP side.
CREATE TABLE sdp_fdw.request_worklogs (
  worklog_id         bigint PRIMARY KEY,
  request_id         bigint,
  technician         text,
  owner              text,
  start_time         timestamptz,
  end_time           timestamptz,
  time_spent_minutes int,
  description        text,
  fetched_at         timestamptz
);
CREATE INDEX sdp_wl_request_idx ON sdp_fdw.request_worklogs (request_id);
CREATE INDEX sdp_wl_tech_idx ON sdp_fdw.request_worklogs (technician, start_time);

CREATE TABLE sdp_fdw.change_records (
  change_id     bigint PRIMARY KEY,
  display_id    text,
  title         text,
  change_type   text,
  status        text,
  site          text,
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  completed_time  timestamptz,
  owner         text
);
CREATE INDEX sdp_cr_sched_idx ON sdp_fdw.change_records (scheduled_start);

CREATE TABLE sdp_fdw.md_meetings (
  meeting_id bigint PRIMARY KEY,
  site_code  text,
  meeting_date date,
  title      text
);
CREATE TABLE sdp_fdw.md_meeting_projects (
  meeting_id      bigint,
  ord             int,
  project_name    text,
  description     text,
  phase           text,   -- scoping / design / build / deploy
  it_involvement  text,   -- lead / support
  status          text,
  it_lead         text,   -- free text name — resolved through emid.person_alias
  business_sponsor text,
  start_date      date,
  target_end      date,
  PRIMARY KEY (meeting_id, ord)
);
CREATE TABLE sdp_fdw.md_issues (
  issue_id   bigint PRIMARY KEY,
  meeting_id bigint,
  site_code  text,
  title      text,
  description text,
  status     text,
  raised_by  text,
  raised_date date
);
CREATE TABLE sdp_fdw.md_actions (
  action_id  bigint PRIMARY KEY,
  meeting_id bigint,
  site_code  text,
  action     text,
  owner      text,
  due_date   date,
  status     text
);
CREATE TABLE sdp_fdw.insp_inspections (
  inspection_id bigint PRIMARY KEY,
  site_code     text,
  inspection_date date,
  overall_risk  text,
  inspector     text
);
CREATE TABLE sdp_fdw.insp_actions (
  action_id     bigint PRIMARY KEY,
  inspection_id bigint,
  site_code     text,
  finding       text,
  action        text,
  owner         text,
  due_date      date,
  status        text
);
CREATE TABLE sdp_fdw.tracker_inputs_v2 (
  id          bigint PRIMARY KEY,
  year        int,
  month       int,
  site_code   text,
  activity_code text,
  actual      numeric(10,2)
);
CREATE TABLE sdp_fdw.survey_results (
  survey_id     bigint PRIMARY KEY,
  request_id    bigint,
  request_display_id text,
  overall_score numeric(5,2),
  response_date timestamptz,
  site          text
);

-- ===== mart: helpdesk load per person per month =====
--
-- Attribution is by tech_group (who did the work), never by site (where the
-- requester sat — 41% of that column says London).
-- Hours prefer real worklogs; when there are none, ticket count × the effort
-- standard, and the row says MODELLED so nobody mistakes it for measurement.
CREATE MATERIALIZED VIEW mart.bau_helpdesk_load AS
SELECT
  pa.person_id,
  p.user_id,
  sa.code                                                      AS site_code,
  to_char(date_trunc('month', r.created_time), 'YYYY-MM')      AS period,
  count(*)::int                                                AS tickets,
  count(*) FILTER (WHERE r.request_type = 'Incident')::int      AS incidents,
  count(*) FILTER (WHERE r.request_type = 'Service Request')::int AS service_requests,
  count(*) FILTER (WHERE r.request_type IN ('Event','Events'))::int AS events,
  count(*) FILTER (WHERE r.overdue_status = 1)::int             AS sla_breached,
  round(coalesce(
    sum(w.time_spent_minutes) / 60.0,
    sum(coalesce(es.minutes, 30)) / 60.0
  ), 2)                                                        AS bau_hours,
  CASE WHEN sum(w.time_spent_minutes) IS NOT NULL THEN 'MEASURED' ELSE 'MODELLED' END
                                                               AS provenance
FROM sdp_fdw.request_records r
JOIN emid.person_alias pa
  ON pa.system = 'SDP_TECHNICIAN'
 AND pa.alias_norm = upper(regexp_replace(btrim(r.technician), '\s+', ' ', 'g'))
 AND pa.person_id IS NOT NULL
JOIN emid.person p
  ON p.person_id = pa.person_id
 AND p.deleted_at IS NULL
 AND p.employment IN ('STAFF','CONTRACTOR')     -- service accounts and vendors never consume capacity
JOIN emid.site_alias sa
  ON sa.system = 'SDP_TECH_GROUP' AND sa.alias = r.tech_group
LEFT JOIN sdp_fdw.request_worklogs w ON w.request_id = r.request_id
LEFT JOIN effort_standard es
  ON es.request_type = coalesce(nullif(r.request_type, 'Events'), 'Unclassified')
 AND es.category     = coalesce(r.category, 'Unclassified')
 AND es.valid_to IS NULL
WHERE r.technician IS NOT NULL
  AND r.tech_group IS NOT NULL
  AND r.created_time IS NOT NULL
GROUP BY 1, 2, 3, 4;

-- CONCURRENTLY refresh requires a unique index.
CREATE UNIQUE INDEX bau_helpdesk_load_pk ON mart.bau_helpdesk_load (person_id, period);
CREATE INDEX bau_helpdesk_load_site_idx ON mart.bau_helpdesk_load (site_code, period);

-- ===== mart: what could NOT be attributed =====
-- Anti-sandbagging. A site cannot look healthier by not recording tickets.
CREATE MATERIALIZED VIEW mart.bau_unattributed_mv AS
SELECT
  to_char(date_trunc('month', r.created_time), 'YYYY-MM') AS period,
  coalesce(sa.code, 'UNMAPPED')                           AS site_code,
  CASE
    WHEN r.technician IS NULL              THEN 'NO_TECHNICIAN'
    WHEN r.tech_group IS NULL              THEN 'NO_TECH_GROUP'
    WHEN pa.person_id IS NULL              THEN 'UNRESOLVED_ALIAS'
    ELSE 'NO_PULSE_USER'
  END                                                     AS reason,
  count(*)::int                                           AS tickets
FROM sdp_fdw.request_records r
LEFT JOIN emid.person_alias pa
  ON pa.system = 'SDP_TECHNICIAN'
 AND pa.alias_norm = upper(regexp_replace(btrim(r.technician), '\s+', ' ', 'g'))
 AND pa.person_id IS NOT NULL
LEFT JOIN emid.person p ON p.person_id = pa.person_id AND p.deleted_at IS NULL
LEFT JOIN emid.site_alias sa
  ON sa.system = 'SDP_TECH_GROUP' AND sa.alias = r.tech_group
WHERE r.created_time IS NOT NULL
  AND (r.technician IS NULL OR r.tech_group IS NULL OR pa.person_id IS NULL OR p.user_id IS NULL)
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX bau_unattributed_mv_pk ON mart.bau_unattributed_mv (period, site_code, reason);

-- ===== mart: tracker (non-helpdesk BAU) =====
CREATE MATERIALIZED VIEW mart.bau_tracker_load AS
SELECT
  sa.code                                            AS site_code,
  to_char(make_date(t.year, t.month, 1), 'YYYY-MM')  AS period,
  t.activity_code,
  sum(t.actual)                                      AS actual
FROM sdp_fdw.tracker_inputs_v2 t
JOIN emid.site_alias sa ON sa.system = 'TRACKER' AND sa.alias = t.site_code
WHERE t.year IS NOT NULL AND t.month BETWEEN 1 AND 12
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX bau_tracker_load_pk ON mart.bau_tracker_load (site_code, period, activity_code);
