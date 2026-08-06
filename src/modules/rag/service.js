"use strict";
// Recomputes rag_computed / rag_signals_json / progress_pct / last_activity_at for a
// project and stores them on the projects row (plan §3). Called after ANY write
// touching a project or its children. Accepts a client (inside a transaction) or
// falls back to the pool.
const { pool } = require("../../db/pool");
const { computeRag, gmtToday } = require("./compute");
const notifications = require("../notifications/service");

async function recomputeProject(db, projectId, actingUserId) {
  const q = (text, params) => db.query(text, params);

  const projRes = await q(
    `SELECT id, stage, created_at, updated_at, rag_computed, rag_override, project_manager_id, lead_division_id, title, code
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId]
  );
  const project = projRes.rows[0];
  if (!project) return null;

  const [msRes, rbRes, acRes, suRes, actRes] = await Promise.all([
    q(`SELECT status, due_date FROM milestones WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]),
    q(`SELECT severity, status FROM roadblocks WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]),
    q(`SELECT status, due_date FROM actions WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]),
    q(`SELECT max(created_at) AS last FROM status_updates WHERE project_id = $1 AND deleted_at IS NULL`, [projectId]),
    // last activity of ANY kind = latest write on the project row or any child
    q(
      `SELECT greatest(
         (SELECT max(updated_at) FROM milestones WHERE project_id = $1 AND deleted_at IS NULL),
         (SELECT max(updated_at) FROM roadblocks WHERE project_id = $1 AND deleted_at IS NULL),
         (SELECT max(updated_at) FROM actions WHERE project_id = $1 AND deleted_at IS NULL),
         (SELECT max(updated_at) FROM status_updates WHERE project_id = $1 AND deleted_at IS NULL),
         (SELECT max(updated_at) FROM decisions WHERE project_id = $1 AND deleted_at IS NULL),
         (SELECT updated_at FROM projects WHERE id = $1)
       ) AS last`,
      [projectId]
    ),
  ]);

  const lastActivityAt = actRes.rows[0].last || project.created_at;
  const { rag, signals, progressPct } = computeRag({
    stage: project.stage,
    milestones: msRes.rows.map((m) => ({ status: m.status, dueDate: m.due_date })),
    roadblocks: rbRes.rows,
    actions: acRes.rows.map((a) => ({ status: a.status, dueDate: a.due_date })),
    lastActivityAt,
    lastStatusUpdateAt: suRes.rows[0].last,
    createdAt: project.created_at,
    today: gmtToday(),
  });

  const flat = {};
  for (const [k, v] of Object.entries(signals)) flat[k] = { value: v.value, detail: v.detail };

  // NOTE: does not touch updated_at — this is a system write, and updated_at is the
  // optimistic-locking token for USER edits.
  await q(
    `UPDATE projects
        SET rag_computed = $2, rag_signals_json = $3, progress_pct = $4, last_activity_at = $5
      WHERE id = $1`,
    [projectId, rag, JSON.stringify(flat), progressPct, lastActivityAt]
  );

  // Project turns RED -> notify PM + Division Lead of the lead division (plan §2)
  const effectiveBefore = project.rag_override || project.rag_computed;
  const effectiveAfter = project.rag_override || rag;
  if (effectiveAfter === "R" && effectiveBefore !== "R") {
    const targets = new Set();
    if (project.project_manager_id) targets.add(project.project_manager_id);
    const dlRes = await q(
      `SELECT id FROM users
        WHERE role = 'DIVISION_LEAD' AND division_id = $1 AND deleted_at IS NULL AND active = true`,
      [project.lead_division_id]
    );
    for (const r of dlRes.rows) targets.add(r.id);
    for (const userId of targets) {
      await notifications.create(db, {
        userId,
        type: "PROJECT_RED",
        entity: "project",
        entityId: projectId,
        text: `${project.code} ${project.title} turned RED`,
        createdBy: actingUserId || null,
      });
    }
  }

  return { rag, signals: flat, progressPct };
}

// convenience wrapper when not already in a transaction
async function recompute(projectId, actingUserId) {
  return recomputeProject(pool, projectId, actingUserId);
}

module.exports = { recomputeProject, recompute };
