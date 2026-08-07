"use strict";
// E11 — Risk register (plan §28): future uncertainty, distinct from roadblocks.
// Score = probability × impact (DB-computed). Same permission shape as roadblocks.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { canEditItem, loadProjectAccess } = require("../../middleware/authz");
const rag = require("../rag/service");

const FIELDS = [
  "title", "description", "category", "probability", "impact", "treatment",
  "owner_user_id", "target_date", "residual_probability", "residual_impact", "status",
];

function canCreate(user, projectAccess) {
  if (projectAccess.access === "FULL") return true;
  return projectAccess.access === "PARTIAL" && user.role !== "VIEWER";
}

async function createRisk(actor, projectAccess, input) {
  if (!canCreate(actor, projectAccess)) throw forbidden("You cannot raise risks on this project");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO risks (project_id, title, description, category, probability, impact,
         treatment, owner_user_id, target_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        projectAccess.project.id, input.title, input.description || null,
        input.category || "OTHER", input.probability, input.impact,
        input.treatment || null, input.owner_user_id || null, input.target_date || null, actor.id,
      ]
    );
    await audit.recordCreate(client, "risk", rows[0].id, actor.id);
    await rag.recomputeProject(client, projectAccess.project.id, actor.id);
    return rows[0];
  });
}

async function loadRisk(id) {
  const { rows } = await query(`SELECT * FROM risks WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Risk not found");
  return rows[0];
}

async function updateRisk(actor, id, patch, expectedUpdatedAt) {
  const before = await loadRisk(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  if (!(await canEditItem(actor, projectAccess, before))) throw forbidden("You cannot edit this risk");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE risks SET title=$3, description=$4, category=$5, probability=$6, impact=$7,
              treatment=$8, owner_user_id=$9, target_date=$10, residual_probability=$11,
              residual_impact=$12, status=$13, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.description, after.category, after.probability,
       after.impact, after.treatment, after.owner_user_id, after.target_date,
       after.residual_probability, after.residual_impact, after.status]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM risks WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Risk not found");
      throw conflict("This risk changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "risk", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, FIELDS),
    });
    await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

async function listForProject(projectAccess) {
  const { rows } = await query(
    `SELECT r.*, u.name AS owner_name FROM risks r
       LEFT JOIN users u ON u.id = r.owner_user_id
      WHERE r.project_id = $1 AND r.deleted_at IS NULL
      ORDER BY CASE r.status WHEN 'CLOSED' THEN 1 ELSE 0 END, r.score DESC, r.id`,
    [projectAccess.project.id]
  );
  return rows;
}

module.exports = { createRisk, updateRisk, listForProject, loadRisk };
