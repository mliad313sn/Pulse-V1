"use strict";
// SPM Phase 1 — objectives/OKRs. Progress is COMPUTED, never typed:
// KR % = (current − baseline) / (target − baseline), clamped 0..100 —
// works for decreasing targets too (e.g. incidents 40 → 10).
// Objective progress = mean of its KRs. Everything is explainable.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");

const canManage = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD";

function krProgress(kr) {
  if (kr.current == null) return { pct: null, explanation: "No measurement yet" };
  const span = Number(kr.target) - Number(kr.baseline);
  const raw = (Number(kr.current) - Number(kr.baseline)) / span;
  const pct = Math.round(Math.min(Math.max(raw, 0), 1) * 100);
  const n = (v) => Number(v).toString(); // "40.00" -> "40"
  return {
    pct,
    explanation: `${n(kr.current)}${kr.unit ? " " + kr.unit : ""} against ${n(kr.baseline)} → ${n(kr.target)}: ${pct}%`,
  };
}

async function createObjective(actor, input) {
  if (!canManage(actor)) throw forbidden("Only Admin or Division Leads define objectives");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO objectives (title, description, pillar_id, owner_user_id, period, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.title, input.description || null, input.pillar_id || null,
       input.owner_user_id || actor.id, input.period, actor.id]);
    await audit.recordCreate(client, "objective", rows[0].id, actor.id);
    return rows[0];
  });
}

async function addKeyResult(actor, objectiveId, input) {
  if (!canManage(actor)) throw forbidden("Only Admin or Division Leads define key results");
  const { rows: obj } = await query(
    `SELECT id FROM objectives WHERE id = $1 AND deleted_at IS NULL`, [objectiveId]);
  if (!obj.length) throw notFound("Objective not found");
  if (Number(input.target) === Number(input.baseline)) throw badRequest("Target must differ from baseline");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO key_results (objective_id, title, baseline, target, current, unit, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [objectiveId, input.title, input.baseline, input.target,
       input.current ?? null, input.unit || null, actor.id]);
    await audit.recordCreate(client, "key_result", rows[0].id, actor.id);
    return rows[0];
  });
}

// Measurement update: objective owner, Division Lead or Admin.
async function updateKeyResult(actor, id, patch, expectedUpdatedAt) {
  const { rows } = await query(
    `SELECT kr.*, o.owner_user_id AS objective_owner FROM key_results kr
       JOIN objectives o ON o.id = kr.objective_id
      WHERE kr.id = $1 AND kr.deleted_at IS NULL`, [id]);
  const before = rows[0];
  if (!before) throw notFound("Key result not found");
  if (!(canManage(actor) || before.objective_owner === actor.id)) {
    throw forbidden("Only the objective owner, a Division Lead or Admin update measurements");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of ["title", "baseline", "target", "current", "unit"]) {
    if (patch[f] !== undefined) after[f] = patch[f];
  }
  if (Number(after.target) === Number(after.baseline)) throw badRequest("Target must differ from baseline");
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE key_results SET title=$3, baseline=$4, target=$5, current=$6, unit=$7, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.baseline, after.target, after.current, after.unit]);
    if (!res.rows.length) {
      throw conflict("This key result changed since you loaded it — review and retry", { current: before });
    }
    await audit.record(client, {
      entity: "key_result", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, ["baseline", "target", "current", "title", "unit"]),
    });
    return res.rows[0];
  });
}

// Strategy board: objectives with KRs, computed progress and linked projects.
async function board(period) {
  const params = [];
  let where = "o.deleted_at IS NULL";
  if (period) { params.push(period); where += ` AND o.period = $${params.length}`; }
  const { rows: objectives } = await query(
    `SELECT o.*, sp.name AS pillar_name, u.name AS owner_name
       FROM objectives o
       LEFT JOIN strategic_pillars sp ON sp.id = o.pillar_id
       LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE ${where} ORDER BY o.period DESC, o.title`, params);
  for (const o of objectives) {
    const { rows: krs } = await query(
      `SELECT * FROM key_results WHERE objective_id = $1 AND deleted_at IS NULL ORDER BY id`, [o.id]);
    o.key_results = krs.map((kr) => ({ ...kr, progress: krProgress(kr) }));
    const measured = o.key_results.filter((kr) => kr.progress.pct != null);
    o.progress_pct = measured.length
      ? Math.round(measured.reduce((s, kr) => s + kr.progress.pct, 0) / measured.length)
      : null;
    const { rows: projects } = await query(
      `SELECT p.id, p.code, p.title, coalesce(p.rag_override, p.rag_computed) AS rag
         FROM project_objectives po JOIN projects p ON p.id = po.project_id
        WHERE po.objective_id = $1 AND p.deleted_at IS NULL ORDER BY p.code`, [o.id]);
    o.projects = projects;
  }
  return objectives;
}

// Link/unlink a project to an objective — needs FULL access on the project.
async function linkProject(actor, projectAccess, objectiveId, unlink = false) {
  if (projectAccess.access !== "FULL") throw forbidden("Full project rights required to link objectives");
  const { rows: obj } = await query(
    `SELECT id FROM objectives WHERE id = $1 AND deleted_at IS NULL`, [objectiveId]);
  if (!obj.length) throw notFound("Objective not found");
  await withTransaction(async (client) => {
    if (unlink) {
      await client.query(
        `DELETE FROM project_objectives WHERE project_id = $1 AND objective_id = $2`,
        [projectAccess.project.id, objectiveId]);
    } else {
      await client.query(
        `INSERT INTO project_objectives (project_id, objective_id, created_by)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [projectAccess.project.id, objectiveId, actor.id]);
    }
    await audit.record(client, {
      entity: "project", entityId: projectAccess.project.id, userId: actor.id,
      changes: [{ field: "objective_link", old: unlink ? String(objectiveId) : null, new: unlink ? null : String(objectiveId) }],
    });
  });
}

module.exports = { createObjective, addKeyResult, updateKeyResult, board, linkProject, krProgress };
