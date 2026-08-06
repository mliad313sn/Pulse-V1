"use strict";
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { canEditItem, loadProjectAccess } = require("../../middleware/authz");
const rag = require("../rag/service");
const notifications = require("../notifications/service");

const FIELDS = [
  "title", "description", "severity", "owner_user_id", "raised_by_division_id",
  "due_date", "status", "resolution_note", "escalated_to",
];

function canCreate(user, projectAccess) {
  if (projectAccess.access === "FULL") return true;
  // Division Lead engaged/consulted and Contributor on touching projects can raise roadblocks
  return projectAccess.access === "PARTIAL" && user.role !== "VIEWER";
}

async function createRoadblock(actor, projectAccess, input) {
  if (!canCreate(actor, projectAccess)) throw forbidden("You cannot raise roadblocks on this project");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO roadblocks (project_id, title, description, severity, owner_user_id,
         raised_by_division_id, due_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8) RETURNING *`,
      [
        projectAccess.project.id, input.title, input.description || null, input.severity,
        input.owner_user_id || null, input.raised_by_division_id || actor.division_id || null,
        input.due_date || null, actor.id,
      ]
    );
    await audit.recordCreate(client, "roadblock", rows[0].id, actor.id);
    await rag.recomputeProject(client, projectAccess.project.id, actor.id);
    return rows[0];
  });
}

async function loadRoadblock(id) {
  const { rows } = await query(`SELECT * FROM roadblocks WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Roadblock not found");
  return rows[0];
}

async function updateRoadblock(actor, id, patch, expectedUpdatedAt) {
  const before = await loadRoadblock(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  const editable = await canEditItem(actor, projectAccess, {
    owner_division_id: before.raised_by_division_id,
    owner_user_id: before.owner_user_id,
  });
  if (!editable) throw forbidden("You cannot edit this roadblock");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");

  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE roadblocks SET title=$3, description=$4, severity=$5, owner_user_id=$6,
              raised_by_division_id=$7, due_date=$8, status=$9, resolution_note=$10,
              escalated_to=$11, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz) AND deleted_at IS NULL RETURNING *`,
      [
        id, expectedUpdatedAt, after.title, after.description, after.severity,
        after.owner_user_id, after.raised_by_division_id, after.due_date,
        after.status, after.resolution_note, after.escalated_to,
      ]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM roadblocks WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Roadblock not found");
      throw conflict("This roadblock changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "roadblock", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, FIELDS),
    });
    await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

// Escalate: status -> ESCALATED + notify Admin + Division Leads of engaged divisions (plan §2)
async function escalateRoadblock(actor, id) {
  const before = await loadRoadblock(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  const allowed =
    projectAccess.access === "FULL" ||
    (await canEditItem(actor, projectAccess, {
      owner_division_id: before.raised_by_division_id,
      owner_user_id: before.owner_user_id,
    }));
  if (!allowed) throw forbidden("You cannot escalate this roadblock");
  if (before.status === "RESOLVED") throw badRequest("A resolved roadblock cannot be escalated");

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE roadblocks SET status='ESCALATED', updated_at=now() WHERE id=$1 RETURNING *`,
      [id]
    );
    await audit.record(client, {
      entity: "roadblock", entityId: id, userId: actor.id,
      changes: [{ field: "status", old: before.status, new: "ESCALATED" }],
    });
    // notify Admins + Division Leads of all engaged (non-deleted) divisions on the project
    const targets = new Set();
    const admins = await client.query(
      `SELECT id FROM users WHERE role='ADMIN' AND active AND deleted_at IS NULL`
    );
    admins.rows.forEach((r) => targets.add(r.id));
    const leads = await client.query(
      `SELECT u.id FROM users u
        WHERE u.role = 'DIVISION_LEAD' AND u.active AND u.deleted_at IS NULL
          AND u.division_id IN (
            SELECT division_id FROM project_divisions
             WHERE project_id = $1 AND deleted_at IS NULL)`,
      [before.project_id]
    );
    leads.rows.forEach((r) => targets.add(r.id));
    for (const userId of targets) {
      await notifications.create(client, {
        userId, type: "ROADBLOCK_ESCALATED", entity: "roadblock", entityId: id,
        text: `Roadblock escalated: ${before.title}`,
        createdBy: actor.id,
      });
    }
    await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

async function softDeleteRoadblock(actor, id) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin can delete");
  const r = await loadRoadblock(id);
  await withTransaction(async (client) => {
    await client.query(`UPDATE roadblocks SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await audit.recordDelete(client, "roadblock", id, actor.id);
    await rag.recomputeProject(client, r.project_id, actor.id);
  });
}

module.exports = { createRoadblock, updateRoadblock, escalateRoadblock, softDeleteRoadblock };
