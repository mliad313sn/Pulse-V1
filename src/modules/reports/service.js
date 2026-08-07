"use strict";
const { query } = require("../../db/pool");

// All report queries accept an optional site code filter (plan §4.6 per-site breakdowns)
// and exclude confidential projects for non Admin/Division-Lead users.

function scopeClauses(user, siteCode, params) {
  const clauses = ["p.deleted_at IS NULL"];
  if (user.role === "CONTRIBUTOR" || user.role === "VIEWER") {
    params.push(user.id);
    clauses.push(`(p.confidential = false OR p.project_manager_id = $${params.length})`);
  }
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1, user.id);
    clauses.push(`(EXISTS (SELECT 1 FROM project_sites psi WHERE psi.project_id = p.id
                    AND psi.deleted_at IS NULL AND psi.site_id = $${params.length - 1})
                  OR p.project_manager_id = $${params.length})`);
  }
  if (siteCode) {
    params.push(siteCode);
    clauses.push(`EXISTS (SELECT 1 FROM project_sites ps JOIN sites s ON s.id = ps.site_id
                   WHERE ps.project_id = p.id AND ps.deleted_at IS NULL AND s.code = $${params.length})`);
  }
  return clauses.join(" AND ");
}

// Division workload: projects led / engaged per division
async function divisionWorkload(user, siteCode) {
  const params = [];
  const scope = scopeClauses(user, siteCode, params);
  const { rows } = await query(
    `SELECT d.code, d.name,
            count(*) FILTER (WHERE pd.role_in_project = 'LEAD')::int AS led,
            count(*) FILTER (WHERE pd.role_in_project = 'ENGAGED')::int AS engaged,
            count(*) FILTER (WHERE pd.role_in_project = 'CONSULTED')::int AS consulted
       FROM divisions d
       LEFT JOIN project_divisions pd ON pd.division_id = d.id AND pd.deleted_at IS NULL
       LEFT JOIN projects p ON p.id = pd.project_id AND p.stage <> 'CLOSED'
      WHERE d.deleted_at IS NULL AND (p.id IS NULL OR (${scope}))
      GROUP BY d.id, d.code, d.name ORDER BY d.code`,
    params
  );
  return rows;
}

// RAG trend from rag_history (weekly snapshots)
async function ragTrend(user, siteCode, weeks = 12) {
  const params = [];
  const scope = scopeClauses(user, siteCode, params);
  params.push(weeks);
  const { rows } = await query(
    `SELECT h.snapshot_date,
            count(*) FILTER (WHERE h.rag = 'G')::int AS g,
            count(*) FILTER (WHERE h.rag = 'A')::int AS a,
            count(*) FILTER (WHERE h.rag = 'R')::int AS r,
            round(avg(h.progress_pct))::int AS avg_progress
       FROM rag_history h JOIN projects p ON p.id = h.project_id
      WHERE ${scope}
        AND h.snapshot_date > (now() AT TIME ZONE 'utc')::date - ($${params.length}::int * 7)
      GROUP BY h.snapshot_date ORDER BY h.snapshot_date`,
    params
  );
  return rows;
}

// Roadblock aging: open roadblocks bucketed by age
async function roadblockAging(user, siteCode) {
  const params = [];
  const scope = scopeClauses(user, siteCode, params);
  const { rows } = await query(
    `SELECT r.severity,
            count(*) FILTER (WHERE now() - r.created_at < interval '7 days')::int AS "0_7",
            count(*) FILTER (WHERE now() - r.created_at >= interval '7 days' AND now() - r.created_at < interval '30 days')::int AS "7_30",
            count(*) FILTER (WHERE now() - r.created_at >= interval '30 days')::int AS "30_plus"
       FROM roadblocks r JOIN projects p ON p.id = r.project_id
      WHERE r.deleted_at IS NULL AND r.status <> 'RESOLVED' AND ${scope}
      GROUP BY r.severity
      ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END`,
    params
  );
  return rows;
}

// Action resolution rate per month (created vs done), last 6 months
async function actionResolution(user, siteCode) {
  const params = [];
  const scope = scopeClauses(user, siteCode, params);
  const { rows } = await query(
    `SELECT to_char(date_trunc('month', a.created_at), 'YYYY-MM') AS month,
            count(*)::int AS created,
            count(*) FILTER (WHERE a.status = 'DONE')::int AS done,
            count(*) FILTER (WHERE a.status = 'OPEN' AND a.due_date < (now() AT TIME ZONE 'utc')::date)::int AS overdue
       FROM actions a LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.deleted_at IS NULL AND a.status <> 'CANCELLED'
        AND a.created_at > now() - interval '6 months'
        AND (a.project_id IS NULL OR (${scope}))
      GROUP BY 1 ORDER BY 1`,
    params
  );
  return rows;
}

// Per-site breakdown: one row per site with project counts by RAG + open items
async function siteBreakdown(user) {
  const params = [];
  const scope = scopeClauses(user, null, params);
  const { rows } = await query(
    `SELECT s.code, s.name,
            count(DISTINCT p.id)::int AS projects,
            count(DISTINCT p.id) FILTER (WHERE coalesce(p.rag_override, p.rag_computed) = 'G')::int AS g,
            count(DISTINCT p.id) FILTER (WHERE coalesce(p.rag_override, p.rag_computed) = 'A')::int AS a,
            count(DISTINCT p.id) FILTER (WHERE coalesce(p.rag_override, p.rag_computed) = 'R')::int AS r,
            (SELECT count(*)::int FROM roadblocks rb
              WHERE rb.deleted_at IS NULL AND rb.status <> 'RESOLVED' AND rb.severity = 'CRITICAL'
                AND rb.project_id IN (SELECT ps2.project_id FROM project_sites ps2 WHERE ps2.site_id = s.id AND ps2.deleted_at IS NULL)) AS critical_roadblocks
       FROM sites s
       LEFT JOIN project_sites ps ON ps.site_id = s.id AND ps.deleted_at IS NULL
       LEFT JOIN projects p ON p.id = ps.project_id AND p.stage <> 'CLOSED' AND (${scope})
      WHERE s.deleted_at IS NULL
      GROUP BY s.id, s.code, s.name ORDER BY s.code`,
    params
  );
  return rows;
}

// Site Lens payload (plan §4.4): everything about one site beyond its project cards
// (cards come from the portfolio endpoint with ?site=).
async function siteLens(user, siteCode) {
  const params = [siteCode];
  let confidentiality = "TRUE";
  if (user.role === "CONTRIBUTOR" || user.role === "VIEWER") {
    params.push(user.id);
    confidentiality = `(p.confidential = false OR p.project_manager_id = $${params.length})`;
  }
  const [milestones, readiness, roadblocks, actions, goLives] = await Promise.all([
    // milestones tied to this site OR belonging to this site's projects, due soon
    query(
      `SELECT m.id, m.title, m.type, m.due_date, m.status, p.code AS project_code, m.updated_at
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         JOIN sites s ON s.code = $1
        WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND p.stage <> 'CLOSED' AND ${confidentiality}
          AND (m.site_id = s.id OR EXISTS (SELECT 1 FROM project_sites ps
                 WHERE ps.project_id = p.id AND ps.site_id = s.id AND ps.deleted_at IS NULL))
          AND m.status <> 'DONE'
          AND (m.due_date IS NULL OR m.due_date <= (now() AT TIME ZONE 'utc')::date + 60)
        ORDER BY m.due_date NULLS LAST LIMIT 50`,
      params
    ),
    query(
      `SELECT m.id AS milestone_id, m.title, p.code AS project_code,
              json_agg(json_build_object('id', ri.id, 'label', ri.label, 'checked', ri.checked) ORDER BY ri.id) AS items
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         JOIN sites s ON s.code = $1
         JOIN readiness_items ri ON ri.milestone_id = m.id AND ri.deleted_at IS NULL
        WHERE m.deleted_at IS NULL AND m.type = 'SITE_READINESS' AND p.deleted_at IS NULL
          AND p.stage <> 'CLOSED' AND ${confidentiality}
          AND (m.site_id = s.id OR EXISTS (SELECT 1 FROM project_sites ps
                 WHERE ps.project_id = p.id AND ps.site_id = s.id AND ps.deleted_at IS NULL))
        GROUP BY m.id, m.title, p.code LIMIT 20`,
      params
    ),
    query(
      `SELECT r.id, r.title, r.severity, r.status, r.due_date, p.code AS project_code, u.name AS owner_name, r.updated_at
         FROM roadblocks r
         JOIN projects p ON p.id = r.project_id
         JOIN sites s ON s.code = $1
         LEFT JOIN users u ON u.id = r.owner_user_id
        WHERE r.deleted_at IS NULL AND r.status <> 'RESOLVED' AND p.deleted_at IS NULL AND ${confidentiality}
          AND EXISTS (SELECT 1 FROM project_sites ps
                WHERE ps.project_id = p.id AND ps.site_id = s.id AND ps.deleted_at IS NULL)
        ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END LIMIT 50`,
      params
    ),
    // actions owned by staff based at this site
    query(
      `SELECT a.id, a.title, a.due_date, a.status, p.code AS project_code, u.name AS owner_name, a.updated_at,
              (a.due_date IS NOT NULL AND a.due_date < (now() AT TIME ZONE 'utc')::date) AS overdue
         FROM actions a
         JOIN users u ON u.id = a.owner_user_id
         JOIN sites s ON s.code = $1 AND u.site_id = s.id
         LEFT JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.status = 'OPEN'
        ORDER BY a.due_date NULLS LAST LIMIT 50`,
      [siteCode]
    ),
    query(
      `SELECT m.id, m.title, m.due_date, p.code AS project_code, p.title AS project_title
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         JOIN sites s ON s.code = $1
        WHERE m.deleted_at IS NULL AND m.type = 'GO_LIVE' AND m.status <> 'DONE'
          AND p.deleted_at IS NULL AND p.stage <> 'CLOSED' AND ${confidentiality}
          AND EXISTS (SELECT 1 FROM project_sites ps
                WHERE ps.project_id = p.id AND ps.site_id = s.id AND ps.deleted_at IS NULL)
        ORDER BY m.due_date NULLS LAST LIMIT 10`,
      params
    ),
  ]);
  return {
    milestones: milestones.rows,
    readiness: readiness.rows,
    roadblocks: roadblocks.rows,
    actions: actions.rows,
    goLives: goLives.rows,
  };
}

module.exports = { divisionWorkload, ragTrend, roadblockAging, actionResolution, siteBreakdown, siteLens };
