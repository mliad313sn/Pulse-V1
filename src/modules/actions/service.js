"use strict";
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { canEditItem, loadProjectAccess } = require("../../middleware/authz");
const rag = require("../rag/service");
const notifications = require("../notifications/service");

const FIELDS = ["title", "owner_user_id", "due_date", "status", "done_date", "source", "roadblock_id"];

function canCreateOnProject(user, projectAccess) {
  if (projectAccess.access === "FULL") return true;
  return projectAccess.access === "PARTIAL" && user.role !== "VIEWER";
}

async function createAction(actor, input, projectAccess /* null for general actions */) {
  if (projectAccess) {
    if (!canCreateOnProject(actor, projectAccess)) {
      throw forbidden("You cannot create actions on this project");
    }
  } else if (actor.role === "VIEWER") {
    throw forbidden("Viewers cannot create actions");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO actions (project_id, meeting_id, title, owner_user_id, due_date, status, source, roadblock_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'OPEN',$6,$7,$8) RETURNING *`,
      [
        projectAccess ? projectAccess.project.id : null, input.meeting_id || null,
        input.title, input.owner_user_id, input.due_date || null,
        input.source || (input.meeting_id ? "MEETING" : input.roadblock_id ? "ROADBLOCK" : "PROJECT"),
        input.roadblock_id || null, actor.id,
      ]
    );
    const action = rows[0];
    await audit.recordCreate(client, "action", action.id, actor.id);
    if (action.owner_user_id && action.owner_user_id !== actor.id) {
      await notifications.create(client, {
        userId: action.owner_user_id, type: "ACTION_ASSIGNED",
        entity: "action", entityId: action.id,
        text: `Action assigned to you: ${action.title}`,
        createdBy: actor.id,
      });
    }
    if (action.project_id) await rag.recomputeProject(client, action.project_id, actor.id);
    return action;
  });
}

async function loadAction(id) {
  const { rows } = await query(`SELECT * FROM actions WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Action not found");
  return rows[0];
}

async function updateAction(actor, id, patch, expectedUpdatedAt) {
  const before = await loadAction(id);
  let editable;
  if (before.project_id) {
    const projectAccess = await loadProjectAccess(before.project_id, actor);
    editable = await canEditItem(actor, projectAccess, before);
  } else {
    // general action: owner or admin
    editable = actor.role === "ADMIN" || before.owner_user_id === actor.id || before.created_by === actor.id;
  }
  if (!editable) throw forbidden("You cannot edit this action");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");

  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  if (after.status === "DONE" && !after.done_date) after.done_date = new Date().toISOString().slice(0, 10);
  if (after.status === "OPEN") after.done_date = null;

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE actions SET title=$3, owner_user_id=$4, due_date=$5, status=$6, done_date=$7,
              source=$8, roadblock_id=$9, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz) AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.owner_user_id, after.due_date,
       after.status, after.done_date, after.source, after.roadblock_id]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM actions WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Action not found");
      throw conflict("This action changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "action", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, FIELDS),
    });
    if (patch.owner_user_id && patch.owner_user_id !== before.owner_user_id) {
      await notifications.create(client, {
        userId: patch.owner_user_id, type: "ACTION_ASSIGNED",
        entity: "action", entityId: id,
        text: `Action assigned to you: ${after.title}`,
        createdBy: actor.id,
      });
    }
    if (before.project_id) await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

async function softDeleteAction(actor, id) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin can delete");
  const a = await loadAction(id);
  await withTransaction(async (client) => {
    await client.query(`UPDATE actions SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await audit.recordDelete(client, "action", id, actor.id);
    if (a.project_id) await rag.recomputeProject(client, a.project_id, actor.id);
  });
}

// My Actions page (plan §4.5): my open actions + owned roadblocks + milestones due <=30d + PM projects
async function myWork(user) {
  const [actions, roadblocks, milestones, pmProjects] = await Promise.all([
    query(
      `SELECT a.*, p.code AS project_code, p.title AS project_title
         FROM actions a LEFT JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
        WHERE a.owner_user_id = $1 AND a.status = 'OPEN' AND a.deleted_at IS NULL
        ORDER BY a.due_date NULLS LAST LIMIT 200`,
      [user.id]
    ),
    query(
      `SELECT r.*, p.code AS project_code, p.title AS project_title
         FROM roadblocks r JOIN projects p ON p.id = r.project_id
        WHERE r.owner_user_id = $1 AND r.status <> 'RESOLVED' AND r.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY r.due_date NULLS LAST LIMIT 100`,
      [user.id]
    ),
    query(
      `SELECT m.*, p.code AS project_code, p.title AS project_title
         FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE (m.owner_user_id = $1 OR m.co_owner_user_id = $1)
          AND m.status NOT IN ('DONE') AND m.deleted_at IS NULL AND p.deleted_at IS NULL
          AND m.due_date IS NOT NULL
          AND m.due_date <= (now() AT TIME ZONE 'utc')::date + 30
        ORDER BY m.due_date LIMIT 100`,
      [user.id]
    ),
    query(
      `SELECT p.id, p.code, p.title, p.stage, p.priority, p.progress_pct, p.target_date,
              coalesce(p.rag_override, p.rag_computed) AS rag
         FROM projects p
        WHERE p.project_manager_id = $1 AND p.deleted_at IS NULL AND p.stage <> 'CLOSED'
        ORDER BY CASE coalesce(p.rag_override, p.rag_computed) WHEN 'R' THEN 0 WHEN 'A' THEN 1 ELSE 2 END`,
      [user.id]
    ),
  ]);
  return {
    actions: actions.rows,
    roadblocks: roadblocks.rows,
    milestones: milestones.rows,
    pmProjects: pmProjects.rows,
  };
}

module.exports = { createAction, updateAction, softDeleteAction, myWork };
