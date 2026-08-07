-- PULSE ↔ SDP — correction to 033.
--
-- BUG: mart.bau_helpdesk_load joined request_records directly to
-- emid.person_alias on alias_norm. A person with two confirmed spellings —
-- "Fatou THIAM" and "Fatou Thiam", both normalising to FATOU THIAM — matched
-- BOTH alias rows, so every one of their tickets was counted twice and their
-- modelled hours doubled.
--
-- That is precisely the failure mode this programme exists to prevent: an
-- identity problem quietly inflating a capacity number. The fix collapses the
-- alias table to one row per normalised spelling before joining.

DROP MATERIALIZED VIEW IF EXISTS mart.bau_helpdesk_load;

CREATE MATERIALIZED VIEW mart.bau_helpdesk_load AS
WITH resolved_alias AS (
  -- exactly one person per normalised spelling
  SELECT DISTINCT ON (alias_norm) alias_norm, person_id
    FROM emid.person_alias
   WHERE system = 'SDP_TECHNICIAN' AND person_id IS NOT NULL
   ORDER BY alias_norm, confirmed_at DESC NULLS LAST, person_id
),
worklog_effort AS (
  -- one row per ticket, so a ticket with several worklog entries is summed
  -- once rather than multiplying the ticket
  SELECT request_id, sum(time_spent_minutes) AS minutes
    FROM sdp_fdw.request_worklogs
   WHERE request_id IS NOT NULL
   GROUP BY request_id
)
SELECT
  ra.person_id,
  p.user_id,
  sa.code                                                      AS site_code,
  to_char(date_trunc('month', r.created_time), 'YYYY-MM')      AS period,
  count(*)::int                                                AS tickets,
  count(*) FILTER (WHERE r.request_type = 'Incident')::int      AS incidents,
  count(*) FILTER (WHERE r.request_type = 'Service Request')::int AS service_requests,
  count(*) FILTER (WHERE r.request_type IN ('Event','Events'))::int AS events,
  count(*) FILTER (WHERE r.overdue_status = 1)::int             AS sla_breached,
  round(coalesce(
    sum(we.minutes) / 60.0,
    sum(coalesce(es.minutes, 30)) / 60.0
  ), 2)                                                        AS bau_hours,
  CASE WHEN sum(we.minutes) IS NOT NULL THEN 'MEASURED' ELSE 'MODELLED' END
                                                               AS provenance
FROM sdp_fdw.request_records r
JOIN resolved_alias ra
  ON ra.alias_norm = upper(regexp_replace(btrim(r.technician), '\s+', ' ', 'g'))
JOIN emid.person p
  ON p.person_id = ra.person_id
 AND p.deleted_at IS NULL
 AND p.employment IN ('STAFF','CONTRACTOR')   -- service accounts and vendors never consume capacity
JOIN emid.site_alias sa
  ON sa.system = 'SDP_TECH_GROUP' AND sa.alias = r.tech_group
LEFT JOIN worklog_effort we ON we.request_id = r.request_id
LEFT JOIN effort_standard es
  ON es.request_type = coalesce(nullif(r.request_type, 'Events'), 'Unclassified')
 AND es.category     = coalesce(r.category, 'Unclassified')
 AND es.valid_to IS NULL
WHERE r.technician IS NOT NULL
  AND r.tech_group IS NOT NULL
  AND r.created_time IS NOT NULL
GROUP BY 1, 2, 3, 4;

CREATE UNIQUE INDEX bau_helpdesk_load_pk ON mart.bau_helpdesk_load (person_id, period);
CREATE INDEX bau_helpdesk_load_site_idx ON mart.bau_helpdesk_load (site_code, period);

-- The same duplicate-alias hazard applies to the unattributed view: a ticket
-- must not appear as unattributed merely because one of several alias rows is
-- unconfirmed.
DROP MATERIALIZED VIEW IF EXISTS mart.bau_unattributed_mv;

CREATE MATERIALIZED VIEW mart.bau_unattributed_mv AS
WITH resolved_alias AS (
  SELECT DISTINCT ON (alias_norm) alias_norm, person_id
    FROM emid.person_alias
   WHERE system = 'SDP_TECHNICIAN' AND person_id IS NOT NULL
   ORDER BY alias_norm, confirmed_at DESC NULLS LAST, person_id
)
SELECT
  to_char(date_trunc('month', r.created_time), 'YYYY-MM') AS period,
  coalesce(sa.code, 'UNMAPPED')                           AS site_code,
  CASE
    WHEN r.technician IS NULL  THEN 'NO_TECHNICIAN'
    WHEN r.tech_group IS NULL  THEN 'NO_TECH_GROUP'
    WHEN ra.person_id IS NULL  THEN 'UNRESOLVED_ALIAS'
    ELSE 'NO_PULSE_USER'
  END                                                     AS reason,
  count(*)::int                                           AS tickets
FROM sdp_fdw.request_records r
LEFT JOIN resolved_alias ra
  ON ra.alias_norm = upper(regexp_replace(btrim(r.technician), '\s+', ' ', 'g'))
LEFT JOIN emid.person p ON p.person_id = ra.person_id AND p.deleted_at IS NULL
LEFT JOIN emid.site_alias sa
  ON sa.system = 'SDP_TECH_GROUP' AND sa.alias = r.tech_group
WHERE r.created_time IS NOT NULL
  AND (r.technician IS NULL OR r.tech_group IS NULL OR ra.person_id IS NULL OR p.user_id IS NULL)
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX bau_unattributed_mv_pk ON mart.bau_unattributed_mv (period, site_code, reason);
