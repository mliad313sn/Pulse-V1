"use strict";
// E06 — change control + baselines (plan §15).
// Baselines are immutable snapshots (dates + approved budget + milestone plan).
// Version 1 is the original baseline; each APPROVED change request captures
// the next version automatically. Forecast changes never rewrite a baseline.
// Decisions on change requests need Steering Committee or Admin — the same
// authority tier that owns stage Gate 2.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const notifications = require("../notifications/service");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");

const canDecide = (u) => u.role === "ADMIN" || u.is_steering_committee === true;

async function snapshot(client, projectId, label, actorId, changeRequestId = null) {
  const { rows: pr } = await client.query(
    `SELECT start_date, target_date FROM projects WHERE id = $1 AND deleted_at IS NULL`, [projectId]);
  if (!pr.length) throw notFound("Project not found");
  const { rows: bud } = await client.query(
    `SELECT coalesce(sum(b.approved * fx.rate_to_base),0) AS approved
       FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
      WHERE b.project_id = $1 AND b.deleted_at IS NULL`, [projectId]);
  const { rows: ms } = await client.query(
    `SELECT id, title, type, due_date, status FROM milestones
      WHERE project_id = $1 AND deleted_at IS NULL ORDER BY order_index, due_date NULLS LAST`, [projectId]);
  const { rows: ver } = await client.query(
    `SELECT coalesce(max(version), 0) + 1 AS next FROM project_baselines WHERE project_id = $1`, [projectId]);
  const version = ver[0].next;
  const { rows } = await client.query(
    `INSERT INTO project_baselines
       (project_id, version, label, start_date, target_date, budget_approved, milestones_json, change_request_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, version, label, pr[0].start_date, pr[0].target_date,
     bud[0].approved, JSON.stringify(ms), changeRequestId, actorId]
  );
  await audit.recordCreate(client, "project_baseline", rows[0].id, actorId);
  return rows[0];
}

// Manual capture — v1 "Original baseline" or a re-baseline with explicit label.
async function captureBaseline(actor, projectAccess, label) {
  if (projectAccess.access !== "FULL") throw forbidden("Full project rights required to baseline");
  return withTransaction(async (client) =>
    snapshot(client, projectAccess.project.id,
      label || "Baseline", actor.id));
}

async function listBaselines(projectAccess) {
  const { rows } = await query(
    `SELECT b.*, u.name AS created_by_name, cr.title AS change_title
       FROM project_baselines b
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN change_requests cr ON cr.id = b.change_request_id
      WHERE b.project_id = $1 ORDER BY b.version`,
    [projectAccess.project.id]
  );
  // current forecast alongside — baseline vs forecast stays separate (§15)
  const p = projectAccess.project;
  return {
    baselines: rows,
    forecast: { start_date: p.start_date, target_date: p.target_date },
  };
}

const CR_FIELDS = ["type", "title", "rationale", "impact_analysis", "affected_milestones",
  "cost_impact", "schedule_impact_days", "risk_impact"];

async function createChangeRequest(actor, projectAccess, input) {
  if (actor.role === "VIEWER" || projectAccess.access === "READ") {
    throw forbidden("Write access to this project required");
  }
  if (!input.rationale || input.rationale.trim().length < 10) {
    throw badRequest("A change request needs a rationale of at least 10 characters");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO change_requests (project_id, type, title, rationale, impact_analysis,
         affected_milestones, cost_impact, schedule_impact_days, risk_impact, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [projectAccess.project.id, input.type, input.title, input.rationale,
       input.impact_analysis || null, input.affected_milestones || null,
       input.cost_impact ?? null, input.schedule_impact_days ?? null,
       input.risk_impact || null, actor.id]
    );
    await audit.recordCreate(client, "change_request", rows[0].id, actor.id);
    // Steering members get notified a decision is waiting
    const { rows: sc } = await client.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND active = true
        AND (is_steering_committee = true OR role = 'ADMIN')`);
    for (const u of sc) {
      await notifications.create(client, {
        userId: u.id, type: "CHANGE_REQUEST", entity: "change_request", entityId: rows[0].id,
        text: `Change request awaiting decision: ${input.title} (${input.type})`,
        createdBy: actor.id,
      });
    }
    return rows[0];
  });
}

async function listChangeRequests(projectAccess) {
  const { rows } = await query(
    `SELECT cr.*, cu.name AS created_by_name, au.name AS approver_name
       FROM change_requests cr
       LEFT JOIN users cu ON cu.id = cr.created_by
       LEFT JOIN users au ON au.id = cr.approver_id
      WHERE cr.project_id = $1 AND cr.deleted_at IS NULL
      ORDER BY cr.created_at DESC`,
    [projectAccess.project.id]
  );
  return rows;
}

// Decision: APPROVED captures the next baseline in the same transaction.
async function decideChangeRequest(actor, projectAccess, crId, decision, note, expectedUpdatedAt) {
  if (!canDecide(actor)) throw forbidden("Only Steering Committee or Admin decide change requests");
  if (!["APPROVED", "REJECTED"].includes(decision)) throw badRequest("Decision must be APPROVED or REJECTED");
  if (!note || note.trim().length < 5) throw badRequest("A decision note is required");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  return withTransaction(async (client) => {
    const { rows: cur } = await client.query(
      `SELECT * FROM change_requests WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [crId, projectAccess.project.id]);
    const cr = cur[0];
    if (!cr) throw notFound("Change request not found");
    if (cr.status !== "PENDING") throw badRequest(`Already decided: ${cr.status}`);
    const { rows } = await client.query(
      `UPDATE change_requests SET status=$3, decision_note=$4, approver_id=$5,
         decided_at=now(), updated_at=now()
       WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
       RETURNING *`,
      [crId, expectedUpdatedAt, decision, note, actor.id]
    );
    if (!rows.length) {
      throw conflict("This change request changed since you loaded it — review and retry", { current: cr });
    }
    await audit.record(client, {
      entity: "change_request", entityId: crId, userId: actor.id,
      changes: [{ field: "status", old: "PENDING", new: decision }],
    });
    let baseline = null;
    if (decision === "APPROVED") {
      baseline = await snapshot(client, projectAccess.project.id,
        `Re-baseline: ${cr.title}`, actor.id, crId);
    }
    if (cr.created_by) {
      await notifications.create(client, {
        userId: cr.created_by, type: "CHANGE_REQUEST", entity: "change_request", entityId: crId,
        text: `Change request ${decision.toLowerCase()}: ${cr.title} — ${note}`,
        createdBy: actor.id,
      });
    }
    return { changeRequest: rows[0], baseline };
  });
}

module.exports = {
  captureBaseline, listBaselines,
  createChangeRequest, listChangeRequests, decideChangeRequest,
};
