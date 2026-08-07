"use strict";
// E16 — resource allocation, workload/overload explanation, time tracking.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { loadProjectAccess } = require("../../middleware/authz");

async function allocate(actor, projectAccess, input) {
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to allocate resources");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO resource_allocations (project_id, workstream_id, user_id, start_date, end_date, percent, role, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [projectAccess.project.id, input.workstream_id || null, input.user_id,
       input.start_date, input.end_date, input.percent, input.role || null, actor.id]
    );
    await audit.recordCreate(client, "resource_allocation", rows[0].id, actor.id);
    return rows[0];
  });
}

async function updateAllocation(actor, id, patch, expectedUpdatedAt) {
  const { rows } = await query(`SELECT * FROM resource_allocations WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const before = rows[0];
  if (!before) throw notFound("Allocation not found");
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to change allocations");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const FIELDS = ["workstream_id", "user_id", "start_date", "end_date", "percent", "role"];
  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE resource_allocations SET workstream_id=$3, user_id=$4, start_date=$5, end_date=$6,
              percent=$7, role=$8, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.workstream_id, after.user_id, after.start_date,
       after.end_date, after.percent, after.role]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM resource_allocations WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Allocation not found");
      throw conflict("This allocation changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "resource_allocation", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, FIELDS),
    });
    return res.rows[0];
  });
}

// Workload today: per-user total allocation % across active projects, with the
// per-project breakdown that explains any overload (plan §40, §117).
async function workload(user, { overloadedOnly = false } = {}) {
  const params = [];
  let scope = "TRUE";
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1);
    scope = `u.site_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name, s.code AS site_code, d.code AS division_code,
            coalesce(sum(ra.percent), 0)::int AS total_percent,
            json_agg(json_build_object('project', p.code, 'title', p.title, 'percent', ra.percent, 'role', ra.role)
                     ORDER BY ra.percent DESC)
              FILTER (WHERE ra.id IS NOT NULL) AS breakdown
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN divisions d ON d.id = u.division_id
       LEFT JOIN resource_allocations ra ON ra.user_id = u.id AND ra.deleted_at IS NULL
            AND (now() AT TIME ZONE 'utc')::date BETWEEN ra.start_date AND ra.end_date
       LEFT JOIN projects p ON p.id = ra.project_id AND p.deleted_at IS NULL
            AND p.stage <> 'CLOSED' AND p.operating_status NOT IN ('CANCELLED')
      WHERE u.deleted_at IS NULL AND u.active AND ${scope}
      GROUP BY u.id, u.name, s.code, d.code
      HAVING coalesce(sum(ra.percent), 0) > 0
      ORDER BY total_percent DESC`,
    params
  );
  const list = rows.map((r) => ({
    ...r,
    overloaded: r.total_percent > 100,
    explanation: r.total_percent > 100
      ? `${r.total_percent}% allocated across ${r.breakdown.length} project(s): ` +
        r.breakdown.map((b) => `${b.project} ${b.percent}%`).join(", ")
      : null,
  }));
  return overloadedOnly ? list.filter((r) => r.overloaded) : list;
}

// Time tracking: users log their OWN hours on projects they can see.
async function logTime(actor, input) {
  if (actor.role === "VIEWER") throw forbidden("Viewers cannot log time");
  await loadProjectAccess(input.project_id, actor); // visibility check (throws 404 if hidden)
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO time_entries (user_id, project_id, workstream_id, task_id, entry_date, hours, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$1) RETURNING *`,
      [actor.id, input.project_id, input.workstream_id || null, input.task_id || null,
       input.entry_date, input.hours, input.description || null]
    );
    await audit.recordCreate(client, "time_entry", rows[0].id, actor.id);
    return rows[0];
  });
}

// Planned vs actual hours per project (tasks estimated vs time entries logged)
async function timeSummary(projectAccess) {
  const pid = projectAccess.project.id;
  const [byUser, totals] = await Promise.all([
    query(
      `SELECT u.name, sum(te.hours)::float AS hours
         FROM time_entries te JOIN users u ON u.id = te.user_id
        WHERE te.project_id = $1 AND te.deleted_at IS NULL
        GROUP BY u.name ORDER BY hours DESC`,
      [pid]
    ),
    query(
      `SELECT
         (SELECT coalesce(sum(estimated_hours), 0)::float FROM tasks
           WHERE project_id = $1 AND deleted_at IS NULL AND status <> 'CANCELLED') AS estimated,
         (SELECT coalesce(sum(hours), 0)::float FROM time_entries
           WHERE project_id = $1 AND deleted_at IS NULL) AS actual`,
      [pid]
    ),
  ]);
  return { byUser: byUser.rows, ...totals.rows[0] };
}

module.exports = { allocate, updateAllocation, workload, logTime, timeSummary };
