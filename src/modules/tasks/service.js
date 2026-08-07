"use strict";
// E07 — workstreams + tasks + dependencies. Permissions mirror actions:
// FULL project access manages everything; PARTIAL non-viewers create tasks and
// edit their own; a workstream lead manages their workstream's tasks.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { canEditItem, loadProjectAccess } = require("../../middleware/authz");
const rag = require("../rag/service");
const notifications = require("../notifications/service");
const schedule = require("./schedule");

const WS_FIELDS = ["title", "description", "lead_user_id", "start_date", "end_date", "status"];
const TASK_FIELDS = [
  "title", "description", "workstream_id", "milestone_id", "owner_user_id",
  "planned_start", "planned_finish", "actual_start", "actual_finish",
  "estimated_hours", "actual_hours", "priority", "status",
];

async function createWorkstream(actor, projectAccess, input) {
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to define workstreams");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO workstreams (project_id, title, description, lead_user_id, start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [projectAccess.project.id, input.title, input.description || null,
       input.lead_user_id || null, input.start_date || null, input.end_date || null, actor.id]
    );
    await audit.recordCreate(client, "workstream", rows[0].id, actor.id);
    return rows[0];
  });
}

async function updateWorkstream(actor, id, patch, expectedUpdatedAt) {
  const { rows } = await query(`SELECT * FROM workstreams WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const before = rows[0];
  if (!before) throw notFound("Workstream not found");
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  if (projectAccess.access !== "FULL" && before.lead_user_id !== actor.id) {
    throw forbidden("Only full project access or the workstream lead can edit this workstream");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of WS_FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE workstreams SET title=$3, description=$4, lead_user_id=$5, start_date=$6, end_date=$7,
              status=$8, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.description, after.lead_user_id,
       after.start_date, after.end_date, after.status]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM workstreams WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Workstream not found");
      throw conflict("This workstream changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "workstream", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, WS_FIELDS),
    });
    return res.rows[0];
  });
}

async function isWorkstreamLead(userId, workstreamId) {
  if (!workstreamId) return false;
  const { rows } = await query(
    `SELECT 1 FROM workstreams WHERE id = $1 AND lead_user_id = $2 AND deleted_at IS NULL`,
    [workstreamId, userId]
  );
  return rows.length > 0;
}

async function createTask(actor, projectAccess, input) {
  const allowed =
    projectAccess.access === "FULL" ||
    (projectAccess.access === "PARTIAL" && actor.role !== "VIEWER") ||
    (await isWorkstreamLead(actor.id, input.workstream_id));
  if (!allowed) throw forbidden("You cannot create tasks on this project");
  if (input.workstream_id) {
    const { rows } = await query(
      `SELECT 1 FROM workstreams WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.workstream_id, projectAccess.project.id]
    );
    if (!rows.length) throw badRequest("Workstream must belong to the same project");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tasks (project_id, workstream_id, milestone_id, title, description, owner_user_id,
         planned_start, planned_finish, estimated_hours, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [projectAccess.project.id, input.workstream_id || null, input.milestone_id || null,
       input.title, input.description || null, input.owner_user_id || null,
       input.planned_start || null, input.planned_finish || null,
       input.estimated_hours ?? null, input.priority || "P2", actor.id]
    );
    const task = rows[0];
    await audit.recordCreate(client, "task", task.id, actor.id);
    if (task.owner_user_id && task.owner_user_id !== actor.id) {
      await notifications.create(client, {
        userId: task.owner_user_id, type: "ACTION_ASSIGNED",
        entity: "task", entityId: task.id,
        text: `Task assigned to you: ${task.title}`, createdBy: actor.id,
      });
    }
    await rag.recomputeProject(client, projectAccess.project.id, actor.id);
    return task;
  });
}

async function loadTask(id) {
  const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Task not found");
  return rows[0];
}

async function updateTask(actor, id, patch, expectedUpdatedAt) {
  const before = await loadTask(id);
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  const editable =
    (await canEditItem(actor, projectAccess, before)) ||
    (await isWorkstreamLead(actor.id, before.workstream_id));
  if (!editable) throw forbidden("You cannot edit this task");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of TASK_FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  if (after.status === "DONE" && !after.actual_finish) after.actual_finish = new Date().toISOString().slice(0, 10);
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE tasks SET title=$3, description=$4, workstream_id=$5, milestone_id=$6, owner_user_id=$7,
              planned_start=$8, planned_finish=$9, actual_start=$10, actual_finish=$11,
              estimated_hours=$12, actual_hours=$13, priority=$14, status=$15, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.description, after.workstream_id, after.milestone_id,
       after.owner_user_id, after.planned_start, after.planned_finish, after.actual_start,
       after.actual_finish, after.estimated_hours, after.actual_hours, after.priority, after.status]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM tasks WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Task not found");
      throw conflict("This task changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "task", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, TASK_FIELDS),
    });
    await rag.recomputeProject(client, before.project_id, actor.id);
    return res.rows[0];
  });
}

// dependency add with server-side cycle rejection (plan §184)
async function addDependency(actor, projectAccess, { predecessor_task_id, successor_task_id, dep_type, lag_days }) {
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to manage dependencies");
  const pid = projectAccess.project.id;
  const tasks = (await query(`SELECT id, status, planned_start, planned_finish FROM tasks
    WHERE project_id = $1 AND deleted_at IS NULL`, [pid])).rows;
  const ids = new Set(tasks.map((t) => t.id));
  if (!ids.has(predecessor_task_id) || !ids.has(successor_task_id)) {
    throw badRequest("Both tasks must belong to this project");
  }
  const deps = (await query(
    `SELECT predecessor_task_id, successor_task_id FROM task_dependencies td
      WHERE td.deleted_at IS NULL AND td.predecessor_task_id IN (SELECT id FROM tasks WHERE project_id = $1 AND deleted_at IS NULL)`,
    [pid])).rows;
  if (schedule.wouldCycle(tasks, deps, predecessor_task_id, successor_task_id)) {
    throw badRequest("This dependency would create a cycle");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dep_type, lag_days, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (predecessor_task_id, successor_task_id)
         DO UPDATE SET dep_type=$3, lag_days=$4, deleted_at=NULL RETURNING *`,
      [predecessor_task_id, successor_task_id, dep_type || "FS", lag_days || 0, actor.id]
    );
    await audit.recordCreate(client, "task_dependency", rows[0].id, actor.id);
    return rows[0];
  });
}

async function removeDependency(actor, projectAccess, depId) {
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to manage dependencies");
  await withTransaction(async (client) => {
    await client.query(`UPDATE task_dependencies SET deleted_at = now() WHERE id = $1`, [depId]);
    await audit.recordDelete(client, "task_dependency", depId, actor.id);
  });
}

// Plan payload: workstreams + tasks + dependencies + critical path
async function getPlan(projectAccess) {
  const pid = projectAccess.project.id;
  const [ws, tasks, deps] = await Promise.all([
    query(`SELECT w.*, u.name AS lead_name FROM workstreams w
            LEFT JOIN users u ON u.id = w.lead_user_id
           WHERE w.project_id = $1 AND w.deleted_at IS NULL ORDER BY w.id`, [pid]),
    query(`SELECT t.*, u.name AS owner_name FROM tasks t
            LEFT JOIN users u ON u.id = t.owner_user_id
           WHERE t.project_id = $1 AND t.deleted_at IS NULL ORDER BY t.planned_start NULLS LAST, t.id`, [pid]),
    query(`SELECT td.* FROM task_dependencies td
            JOIN tasks t ON t.id = td.predecessor_task_id
           WHERE t.project_id = $1 AND td.deleted_at IS NULL AND t.deleted_at IS NULL`, [pid]),
  ]);
  let cp = { projectLength: 0, criticalIds: [] };
  try {
    const res = schedule.criticalPath(tasks.rows, deps.rows);
    cp = { projectLength: res.projectLength, criticalIds: res.criticalIds,
           slack: Object.fromEntries([...res.tasks].map(([id, v]) => [id, v.slack])) };
  } catch (err) {
    cp.error = err.message; // cycle already prevented at write time; belt and braces
  }
  return { workstreams: ws.rows, tasks: tasks.rows, dependencies: deps.rows, criticalPath: cp };
}

module.exports = {
  createWorkstream, updateWorkstream, createTask, updateTask,
  addDependency, removeDependency, getPlan,
};
