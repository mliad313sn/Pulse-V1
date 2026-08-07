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
  "estimated_hours", "actual_hours", "remaining_hours", "parent_task_id", "priority", "status",
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
  if (input.parent_task_id) await assertValidParent(projectAccess.project.id, null, input.parent_task_id);
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
         planned_start, planned_finish, estimated_hours, remaining_hours, parent_task_id, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [projectAccess.project.id, input.workstream_id || null, input.milestone_id || null,
       input.title, input.description || null, input.owner_user_id || null,
       input.planned_start || null, input.planned_finish || null,
       input.estimated_hours ?? null, input.remaining_hours ?? input.estimated_hours ?? null,
       input.parent_task_id || null, input.priority || "P2", actor.id]
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
  if (patch.parent_task_id !== undefined && patch.parent_task_id !== before.parent_task_id) {
    await assertValidParent(before.project_id, id, patch.parent_task_id);
  }
  if (after.status === "DONE") { if (!after.actual_finish) after.actual_finish = new Date().toISOString().slice(0, 10); after.remaining_hours = 0; }
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE tasks SET title=$3, description=$4, workstream_id=$5, milestone_id=$6, owner_user_id=$7,
              planned_start=$8, planned_finish=$9, actual_start=$10, actual_finish=$11,
              estimated_hours=$12, actual_hours=$13, remaining_hours=$14, parent_task_id=$15,
              priority=$16, status=$17, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.description, after.workstream_id, after.milestone_id,
       after.owner_user_id, after.planned_start, after.planned_finish, after.actual_start,
       after.actual_finish, after.estimated_hours, after.actual_hours, after.remaining_hours,
       after.parent_task_id, after.priority, after.status]
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
  const rollups = schedule.rollupSummaries(tasks.rows);
  const quality = schedule.qualityChecks(tasks.rows, deps.rows);
  return {
    workstreams: ws.rows, tasks: tasks.rows, dependencies: deps.rows, criticalPath: cp,
    summaries: Object.fromEntries(rollups), quality,
  };
}

// ===== Phase 2: WBS parent validation (same project, no self/descendant loops)
async function assertValidParent(projectId, taskId, parentId) {
  if (parentId == null) return;
  if (parentId === taskId) throw badRequest("A task cannot be its own parent");
  const { rows } = await query(
    `SELECT id, parent_task_id FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]);
  const byId = new Map(rows.map((t) => [t.id, t]));
  if (!byId.has(parentId)) throw badRequest("Parent task must belong to the same project");
  let cur = parentId, hops = 0;
  while (cur != null && hops++ < 200) {
    if (cur === taskId) throw badRequest("Parent chain would create a WBS loop");
    cur = byId.get(cur)?.parent_task_id ?? null;
  }
}

// ===== Phase 2: task baselines — immutable snapshots for schedule variance
async function captureTaskBaseline(actor, projectAccess, label) {
  if (projectAccess.access !== "FULL") throw forbidden("Full project rights required to baseline the plan");
  const pid = projectAccess.project.id;
  const { rows: tasks } = await query(
    `SELECT id, title, planned_start, planned_finish, estimated_hours FROM tasks
      WHERE project_id = $1 AND deleted_at IS NULL ORDER BY id`, [pid]);
  if (!tasks.length) throw badRequest("Nothing to baseline — the plan has no tasks");
  return withTransaction(async (client) => {
    const { rows: ver } = await client.query(
      `SELECT coalesce(max(version),0)+1 AS next FROM task_baselines WHERE project_id = $1`, [pid]);
    const { rows } = await client.query(
      `INSERT INTO task_baselines (project_id, version, label, tasks_json, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pid, ver[0].next, label || `Plan baseline v${ver[0].next}`, JSON.stringify(tasks), actor.id]);
    await audit.recordCreate(client, "task_baseline", rows[0].id, actor.id);
    return rows[0];
  });
}

// Variance of the CURRENT plan against a baseline version (latest by default).
async function planVariance(projectAccess, version) {
  const pid = projectAccess.project.id;
  const params = [pid];
  let vWhere = "";
  if (version) { params.push(Number(version)); vWhere = " AND version = $2"; }
  const { rows: bl } = await query(
    `SELECT * FROM task_baselines WHERE project_id = $1${vWhere} ORDER BY version DESC LIMIT 1`, params);
  if (!bl.length) return { baseline: null, variances: [] };
  const { rows: current } = await query(
    `SELECT id, title, planned_start, planned_finish, status FROM tasks
      WHERE project_id = $1 AND deleted_at IS NULL`, [pid]);
  const curById = new Map(current.map((t) => [t.id, t]));
  const dayDiff = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;
  const variances = [];
  for (const b of bl[0].tasks_json) {
    const cur = curById.get(b.id);
    if (!cur) { variances.push({ task_id: b.id, title: b.title, change: "removed" }); continue; }
    const slipDays = dayDiff(b.planned_finish, cur.planned_finish);
    if (slipDays) {
      variances.push({
        task_id: b.id, title: cur.title, change: slipDays > 0 ? "slipped" : "pulled_in",
        days: slipDays,
        detail: `${cur.title}: finish ${b.planned_finish ? String(b.planned_finish).slice(0,10) : "—"} → ${cur.planned_finish ? String(cur.planned_finish).slice(0,10) : "—"} (${slipDays > 0 ? "+" : ""}${slipDays}d)`,
      });
    }
  }
  const baselineIds = new Set(bl[0].tasks_json.map((t) => t.id));
  for (const t of current) {
    if (!baselineIds.has(t.id)) variances.push({ task_id: t.id, title: t.title, change: "added" });
  }
  return { baseline: { version: bl[0].version, label: bl[0].label, created_at: bl[0].created_at }, variances };
}

// ===== Phase 2: cross-project dependencies + blast radius
async function addProjectDependency(actor, successorAccess, predecessorProjectId, note) {
  if (successorAccess.access !== "FULL") throw forbidden("Full rights on the dependent project required");
  const { loadProjectAccess } = require("../../middleware/authz");
  await loadProjectAccess(predecessorProjectId, actor); // visibility check (concealed 404)
  if (predecessorProjectId === successorAccess.project.id) throw badRequest("A project cannot depend on itself");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO project_dependencies (predecessor_project_id, successor_project_id, note, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (predecessor_project_id, successor_project_id)
       DO UPDATE SET deleted_at = NULL, note = $3 RETURNING *`,
      [predecessorProjectId, successorAccess.project.id, note || null, actor.id]);
    await audit.recordCreate(client, "project_dependency", rows[0].id, actor.id);
    return rows[0];
  });
}

// Downstream blast radius: which projects are affected if THIS project slips,
// walked breadth-first with depth. Only projects visible to the user appear;
// concealed ones are counted namelessly so totals stay honest without leaking.
async function blastRadius(user, projectAccess) {
  const { rows: edges } = await query(
    `SELECT predecessor_project_id, successor_project_id FROM project_dependencies WHERE deleted_at IS NULL`);
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.predecessor_project_id)) out.set(e.predecessor_project_id, []);
    out.get(e.predecessor_project_id).push(e.successor_project_id);
  }
  const seen = new Set([projectAccess.project.id]);
  const queue = [[projectAccess.project.id, 0]];
  const affected = [];
  while (queue.length) {
    const [id, depth] = queue.shift();
    for (const next of out.get(id) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      affected.push({ id: next, depth: depth + 1 });
      queue.push([next, depth + 1]);
    }
  }
  const { loadProjectAccess } = require("../../middleware/authz");
  const visible = [];
  let concealed = 0;
  for (const a of affected) {
    try {
      const pa = await loadProjectAccess(a.id, user);
      visible.push({
        id: a.id, depth: a.depth, code: pa.project.code, title: pa.project.title,
        stage: pa.project.stage, rag: pa.project.rag_override || pa.project.rag_computed,
      });
    } catch { concealed++; }
  }
  return { affected: visible, concealedCount: concealed, total: affected.length };
}

module.exports = {
  createWorkstream, updateWorkstream, createTask, updateTask,
  addDependency, removeDependency, getPlan,
  assertValidParent, captureTaskBaseline, planVariance,
  addProjectDependency, blastRadius,
};
