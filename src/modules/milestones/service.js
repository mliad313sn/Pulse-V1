"use strict";
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { canEditItem, loadProjectAccess } = require("../../middleware/authz");
const rag = require("../rag/service");
const notifications = require("../notifications/service");

// Seeded SITE_READINESS checklist template (plan §2)
const READINESS_TEMPLATE = [
  "Power available", "Rack space", "LAN ready",
  "Local hands identified", "Access badge", "Change window agreed",
];

const FIELDS = [
  "title", "type", "owner_division_id", "owner_user_id", "co_owner_user_id",
  "site_id", "due_date", "status", "done_date", "order_index",
];

function canCreate(user, projectAccess, input) {
  if (projectAccess.access === "FULL") return true;
  if (projectAccess.access === "PARTIAL" && user.role === "DIVISION_LEAD") {
    // engaged/consulted lead may create milestones owned by own division
    return input.owner_division_id === user.division_id;
  }
  return false; // contributors don't create milestones (plan §1 matrix)
}

async function createMilestone(actor, projectAccess, input) {
  if (!canCreate(actor, projectAccess, input)) {
    throw forbidden("You cannot create milestones on this project");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO milestones (project_id, title, type, owner_division_id, owner_user_id,
         co_owner_user_id, site_id, due_date, status, order_index, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        projectAccess.project.id, input.title, input.type || "STANDARD",
        input.owner_division_id || null, input.owner_user_id || null,
        input.co_owner_user_id || null, input.site_id || null,
        input.due_date || null, input.status || "NOT_STARTED",
        input.order_index || 0, actor.id,
      ]
    );
    const milestone = rows[0];
    if (milestone.type === "SITE_READINESS") {
      for (const label of READINESS_TEMPLATE) {
        await client.query(
          `INSERT INTO readiness_items (milestone_id, label, created_by) VALUES ($1,$2,$3)`,
          [milestone.id, label, actor.id]
        );
      }
    }
    await audit.recordCreate(client, "milestone", milestone.id, actor.id);
    if (milestone.owner_user_id) {
      await notifications.create(client, {
        userId: milestone.owner_user_id, type: "MILESTONE_ASSIGNED",
        entity: "milestone", entityId: milestone.id,
        text: `Milestone assigned to you: ${milestone.title}`,
        createdBy: actor.id,
      });
    }
    await rag.recomputeProject(client, projectAccess.project.id, actor.id);
    return milestone;
  });
}

async function loadMilestone(id) {
  const { rows } = await query(`SELECT * FROM milestones WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Milestone not found");
  return rows[0];
}

async function updateMilestone(actor, id, patch, expectedUpdatedAt) {
  const before = await loadMilestone(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  if (!(await canEditItem(actor, projectAccess, before))) {
    throw forbidden("You cannot edit this milestone");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");

  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  if (after.status === "DONE" && !after.done_date) after.done_date = new Date().toISOString().slice(0, 10);
  if (after.status !== "DONE") after.done_date = null;

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE milestones SET title=$3, type=$4, owner_division_id=$5, owner_user_id=$6,
              co_owner_user_id=$7, site_id=$8, due_date=$9, status=$10, done_date=$11,
              order_index=$12, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz) AND deleted_at IS NULL RETURNING *`,
      [
        id, expectedUpdatedAt, after.title, after.type, after.owner_division_id,
        after.owner_user_id, after.co_owner_user_id, after.site_id, after.due_date,
        after.status, after.done_date, after.order_index,
      ]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM milestones WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Milestone not found");
      throw conflict("This milestone changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "milestone", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, FIELDS),
    });
    if (patch.owner_user_id && patch.owner_user_id !== before.owner_user_id) {
      await notifications.create(client, {
        userId: patch.owner_user_id, type: "MILESTONE_ASSIGNED",
        entity: "milestone", entityId: id,
        text: `Milestone assigned to you: ${after.title}`,
        createdBy: actor.id,
      });
    }
    await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

async function softDeleteMilestone(actor, id) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin can delete");
  const m = await loadMilestone(id);
  await withTransaction(async (client) => {
    await client.query(`UPDATE readiness_items SET deleted_at = now() WHERE milestone_id = $1 AND deleted_at IS NULL`, [id]);
    await client.query(`UPDATE milestones SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await audit.recordDelete(client, "milestone", id, actor.id);
    await rag.recomputeProject(client, m.project_id, actor.id);
  });
}

// Readiness checklist ticks: milestone editors + site staff of that site
async function setReadiness(actor, itemId, checked) {
  const { rows } = await query(
    `SELECT ri.*, m.project_id, m.site_id AS ms_site_id, m.owner_division_id, m.owner_user_id
       FROM readiness_items ri JOIN milestones m ON m.id = ri.milestone_id
      WHERE ri.id = $1 AND ri.deleted_at IS NULL AND m.deleted_at IS NULL`,
    [itemId]
  );
  const item = rows[0];
  if (!item) throw notFound("Readiness item not found");
  const projectAccess = await loadProjectAccess(item.project_id, actor);
  const canEdit =
    (await canEditItem(actor, projectAccess, {
      owner_division_id: item.owner_division_id,
      owner_user_id: item.owner_user_id,
    })) ||
    (actor.role !== "VIEWER" && actor.site_id && actor.site_id === item.ms_site_id);
  if (!canEdit) throw forbidden("You cannot update this checklist");
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE readiness_items SET checked=$2, checked_by=$3, checked_at=CASE WHEN $2 THEN now() ELSE NULL END,
              updated_at=now()
        WHERE id=$1 RETURNING *`,
      [itemId, checked, checked ? actor.id : null]
    );
    await audit.record(client, {
      entity: "readiness_item", entityId: itemId, userId: actor.id,
      changes: [{ field: "checked", old: String(item.checked), new: String(checked) }],
    });
    await rag.recomputeProject(client, item.project_id, actor.id);
    return res.rows[0];
  });
}

module.exports = { createMilestone, updateMilestone, softDeleteMilestone, setReadiness, READINESS_TEMPLATE };
