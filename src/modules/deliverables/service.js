"use strict";
// OpsPm360: deliverables + RACI matrix + War Room aggregation.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { conflict, notFound, forbidden, badRequest } = require("../../middleware/errors");
const { loadProjectAccess } = require("../../middleware/authz");
const gates = require("../projects/gates");

async function createDeliverable(actor, projectAccess, input) {
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to define deliverables");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO deliverables (project_id, title, description, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [projectAccess.project.id, input.title, input.description || null, input.due_date || null, actor.id]
    );
    await audit.recordCreate(client, "deliverable", rows[0].id, actor.id);
    return rows[0];
  });
}

async function loadDeliverable(id) {
  const { rows } = await query(`SELECT * FROM deliverables WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Deliverable not found");
  return rows[0];
}

async function updateDeliverable(actor, id, patch, expectedUpdatedAt) {
  const before = await loadDeliverable(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  // FULL access, or a user RACI-tagged R/A on this deliverable, may update it
  const tagged = await query(
    `SELECT 1 FROM raci_assignments WHERE deliverable_id = $1 AND user_id = $2
      AND raci_role IN ('R','A') AND deleted_at IS NULL`,
    [id, actor.id]
  );
  if (projectAccess.access !== "FULL" && tagged.rows.length === 0) {
    throw forbidden("You cannot edit this deliverable");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of ["title", "description", "due_date", "status"]) {
    if (patch[f] !== undefined) after[f] = patch[f];
  }
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE deliverables SET title=$3, description=$4, due_date=$5, status=$6, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.description, after.due_date, after.status]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM deliverables WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Deliverable not found");
      throw conflict("This deliverable changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "deliverable", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, ["title", "description", "due_date", "status"]),
    });
    return res.rows[0];
  });
}

// RACI tagging: FULL access sets the matrix
async function setRaci(actor, deliverableId, assignments /* [{user_id, raci_role}] */) {
  const d = await loadDeliverable(deliverableId);
  const projectAccess = await loadProjectAccess(d.project_id, actor);
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to assign RACI");
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE raci_assignments SET deleted_at = now() WHERE deliverable_id = $1 AND deleted_at IS NULL`,
      [deliverableId]
    );
    for (const a of assignments) {
      await client.query(
        `INSERT INTO raci_assignments (deliverable_id, user_id, raci_role, created_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (deliverable_id, user_id, raci_role)
           DO UPDATE SET deleted_at = NULL, updated_at = now()`,
        [deliverableId, a.user_id, a.raci_role, actor.id]
      );
    }
    await audit.record(client, {
      entity: "deliverable", entityId: deliverableId, userId: actor.id,
      changes: [{ field: "raci", old: null, new: assignments.map((a) => `${a.user_id}:${a.raci_role}`).join(",") || "cleared" }],
    });
  });
}

async function listForProject(projectAccess) {
  const { rows } = await query(
    `SELECT d.*,
            (SELECT json_agg(json_build_object('user_id', ra.user_id, 'name', u.name, 'role', ra.raci_role) ORDER BY ra.raci_role)
               FROM raci_assignments ra JOIN users u ON u.id = ra.user_id
              WHERE ra.deliverable_id = d.id AND ra.deleted_at IS NULL) AS raci
       FROM deliverables d
      WHERE d.project_id = $1 AND d.deleted_at IS NULL
      ORDER BY d.due_date NULLS LAST, d.id`,
    [projectAccess.project.id]
  );
  return rows;
}

// War Room: active projects + gate status + caller's RACI duties + recent gate approvals.
// Site isolation is inherited from the same scope rules as the portfolio.
async function warRoom(user) {
  const params = [];
  const scope = [];
  if (!(user.role === "ADMIN" || user.role === "DIVISION_LEAD")) {
    params.push(user.id);
    scope.push(`(p.confidential = false OR p.project_manager_id = $${params.length})`);
  }
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1, user.id);
    scope.push(`(EXISTS (SELECT 1 FROM project_sites psi WHERE psi.project_id = p.id
                  AND psi.deleted_at IS NULL AND psi.site_id = $${params.length - 1})
                OR p.project_manager_id = $${params.length})`);
  }
  const where = ["p.deleted_at IS NULL", "p.stage <> 'CLOSED'", ...scope].join(" AND ");

  const projects = await query(
    `SELECT p.id, p.code, p.title, p.stage, p.priority, p.description, p.sponsor,
            p.target_date, p.actual_end_date, p.progress_pct,
            coalesce(p.rag_override, p.rag_computed) AS rag,
            pm.name AS pm_name,
            (SELECT count(*)::int FROM milestones m WHERE m.project_id = p.id AND m.deleted_at IS NULL) AS milestone_count,
            (SELECT count(*)::int FROM milestones m WHERE m.project_id = p.id AND m.deleted_at IS NULL
              AND m.type = 'GO_LIVE' AND m.status = 'DONE') AS golive_done,
            (SELECT json_agg(s.code) FROM project_sites ps JOIN sites s ON s.id = ps.site_id
              WHERE ps.project_id = p.id AND ps.deleted_at IS NULL) AS sites,
            (SELECT count(*)::int FROM deliverables d WHERE d.project_id = p.id AND d.deleted_at IS NULL) AS deliverable_count,
            (SELECT count(*)::int FROM deliverables d WHERE d.project_id = p.id AND d.deleted_at IS NULL
              AND d.status = 'DELIVERED') AS delivered_count
       FROM projects p LEFT JOIN users pm ON pm.id = p.project_manager_id
      WHERE ${where}
      ORDER BY CASE coalesce(p.rag_override, p.rag_computed) WHEN 'R' THEN 0 WHEN 'A' THEN 1 ELSE 2 END,
               p.target_date NULLS LAST
      LIMIT 200`,
    params
  );

  const rows = projects.rows.map((p) => ({
    ...p,
    governance: gates.GOVERNANCE_LABEL[p.stage],
    gate: gates.gateStatus(p, { milestoneCount: p.milestone_count, goLiveDone: p.golive_done > 0 }, user),
  }));

  const myRaci = await query(
    `SELECT d.id AS deliverable_id, d.title, d.due_date, d.status, ra.raci_role,
            p.code AS project_code, p.id AS project_id
       FROM raci_assignments ra
       JOIN deliverables d ON d.id = ra.deliverable_id AND d.deleted_at IS NULL
       JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
      WHERE ra.user_id = $1 AND ra.deleted_at IS NULL AND d.status <> 'DELIVERED'
      ORDER BY d.due_date NULLS LAST LIMIT 100`,
    [user.id]
  );

  const transitions = await query(
    `SELECT st.*, p.code AS project_code, u.name AS approved_by_name
       FROM stage_transitions st
       JOIN projects p ON p.id = st.project_id
       JOIN users u ON u.id = st.approved_by
      ORDER BY st.created_at DESC LIMIT 15`
  );

  return { projects: rows, myRaci: myRaci.rows, transitions: transitions.rows };
}

module.exports = { createDeliverable, updateDeliverable, setRaci, listForProject, warRoom };
