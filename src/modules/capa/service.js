"use strict";
// E11 — CAPA (plan §29): corrective & preventive action with a verified lifecycle.
// OPEN → ANALYSIS → ACTION_PLANNED → IMPLEMENTATION → VERIFICATION → CLOSED.
// Closing requires a verifier, verification date and an effectiveness result.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { canEditItem, loadProjectAccess } = require("../../middleware/authz");
const rag = require("../rag/service");

const FIELDS = [
  "issue", "root_cause", "immediate_correction", "corrective_action", "preventive_action",
  "owner_user_id", "verifier_user_id", "due_date", "status", "evidence",
  "verification_date", "effectiveness",
];

const LIFECYCLE = ["OPEN", "ANALYSIS", "ACTION_PLANNED", "IMPLEMENTATION", "VERIFICATION", "CLOSED"];

function canCreate(user, projectAccess) {
  if (projectAccess.access === "FULL") return true;
  return projectAccess.access === "PARTIAL" && user.role !== "VIEWER";
}

async function createCapa(actor, projectAccess, input) {
  if (!canCreate(actor, projectAccess)) throw forbidden("You cannot create CAPA on this project");
  // source linkage integrity: a ROADBLOCK-sourced CAPA must reference a roadblock on the same project
  if (input.roadblock_id) {
    const { rows } = await query(
      `SELECT 1 FROM roadblocks WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.roadblock_id, projectAccess.project.id]
    );
    if (!rows.length) throw badRequest("Linked roadblock must belong to the same project");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO capas (project_id, source_type, roadblock_id, risk_id, issue, root_cause,
         immediate_correction, corrective_action, preventive_action, owner_user_id,
         verifier_user_id, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        projectAccess.project.id,
        input.source_type || (input.roadblock_id ? "ROADBLOCK" : input.risk_id ? "RISK" : "MANUAL"),
        input.roadblock_id || null, input.risk_id || null, input.issue,
        input.root_cause || null, input.immediate_correction || null,
        input.corrective_action || null, input.preventive_action || null,
        input.owner_user_id || null, input.verifier_user_id || null,
        input.due_date || null, actor.id,
      ]
    );
    await audit.recordCreate(client, "capa", rows[0].id, actor.id);
    await rag.recomputeProject(client, projectAccess.project.id, actor.id);
    return rows[0];
  });
}

async function loadCapa(id) {
  const { rows } = await query(`SELECT * FROM capas WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("CAPA not found");
  return rows[0];
}

async function updateCapa(actor, id, patch, expectedUpdatedAt) {
  const before = await loadCapa(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  const isVerifier = before.verifier_user_id === actor.id;
  if (!(await canEditItem(actor, projectAccess, before)) && !isVerifier) {
    throw forbidden("You cannot edit this CAPA");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");

  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];

  if (patch.status !== undefined && patch.status !== before.status) {
    if (!LIFECYCLE.includes(patch.status)) throw badRequest("Unknown CAPA status");
    // one step forward, or back for rework — never straight to CLOSED from early stages
    const from = LIFECYCLE.indexOf(before.status);
    const to = LIFECYCLE.indexOf(patch.status);
    if (to - from > 1) {
      throw badRequest(`CAPA lifecycle: ${before.status} cannot jump to ${patch.status}`);
    }
    if (patch.status === "CLOSED") {
      if (!after.verifier_user_id) throw badRequest("Closing a CAPA requires a verifier");
      if (!after.verification_date) after.verification_date = new Date().toISOString().slice(0, 10);
      if (!after.effectiveness) throw badRequest("Closing a CAPA requires an effectiveness result");
    }
  }

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE capas SET issue=$3, root_cause=$4, immediate_correction=$5, corrective_action=$6,
              preventive_action=$7, owner_user_id=$8, verifier_user_id=$9, due_date=$10,
              status=$11, evidence=$12, verification_date=$13, effectiveness=$14, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.issue, after.root_cause, after.immediate_correction,
       after.corrective_action, after.preventive_action, after.owner_user_id,
       after.verifier_user_id, after.due_date, after.status, after.evidence,
       after.verification_date, after.effectiveness]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM capas WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("CAPA not found");
      throw conflict("This CAPA changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "capa", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, FIELDS),
    });
    await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

async function listForProject(projectAccess) {
  const { rows } = await query(
    `SELECT c.*, ou.name AS owner_name, vu.name AS verifier_name, rb.title AS roadblock_title
       FROM capas c
       LEFT JOIN users ou ON ou.id = c.owner_user_id
       LEFT JOIN users vu ON vu.id = c.verifier_user_id
       LEFT JOIN roadblocks rb ON rb.id = c.roadblock_id
      WHERE c.project_id = $1 AND c.deleted_at IS NULL
      ORDER BY CASE c.status WHEN 'CLOSED' THEN 1 ELSE 0 END, c.due_date NULLS LAST, c.id`,
    [projectAccess.project.id]
  );
  return rows;
}

module.exports = { createCapa, updateCapa, listForProject, loadCapa };
