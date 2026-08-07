"use strict";
// SPM Phase 1 — demand lifecycle: DRAFT → SUBMITTED → APPROVED/REJECTED →
// CONVERTED. Anyone except Viewers can raise an idea (democratized intake);
// decisions are Steering/Admin; conversion creates a governed IDEA-stage
// project with a permanent two-way audit link.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const notifications = require("../notifications/service");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const scoring = require("./scoring");
const projects = require("../projects/service");

const canDecide = (u) => u.role === "ADMIN" || u.is_steering_committee === true;

const FIELDS = ["title", "problem", "outcome_hypothesis", "division_id", "site_id",
  "estimated_cost", "estimated_effort_weeks", "business_value", "time_criticality",
  "risk_reduction", "reach", "impact", "confidence", "cost_of_delay_week",
  "mandatory", "mandatory_reason"];

async function create(actor, input) {
  if (actor.role === "VIEWER") throw forbidden("Viewers cannot raise demands");
  if (input.mandatory && (!input.mandatory_reason || input.mandatory_reason.trim().length < 10)) {
    throw badRequest("A mandatory/compliance demand needs a reason of at least 10 characters");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO demands (title, problem, outcome_hypothesis, requester_id, division_id, site_id,
         estimated_cost, estimated_effort_weeks, business_value, time_criticality, risk_reduction,
         reach, impact, confidence, cost_of_delay_week, mandatory, mandatory_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$4)
       RETURNING *`,
      [input.title, input.problem || null, input.outcome_hypothesis || null, actor.id,
       input.division_id ?? actor.division_id, input.site_id ?? actor.site_id,
       input.estimated_cost ?? null, input.estimated_effort_weeks ?? null,
       input.business_value ?? null, input.time_criticality ?? null, input.risk_reduction ?? null,
       input.reach ?? null, input.impact ?? null, input.confidence ?? null,
       input.cost_of_delay_week ?? null, input.mandatory === true, input.mandatory_reason || null]
    );
    await audit.recordCreate(client, "demand", rows[0].id, actor.id);
    return rows[0];
  });
}

async function loadDemand(id) {
  const { rows } = await query(`SELECT * FROM demands WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows.length) throw notFound("Demand not found");
  return rows[0];
}

async function update(actor, id, patch, expectedUpdatedAt) {
  const before = await loadDemand(id);
  const owns = before.requester_id === actor.id;
  if (!(owns || actor.role === "ADMIN" || actor.role === "DIVISION_LEAD")) {
    throw forbidden("Only the requester, a Division Lead or Admin edit a demand");
  }
  if (["CONVERTED"].includes(before.status)) throw badRequest("A converted demand is frozen");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  if (after.mandatory && (!after.mandatory_reason || String(after.mandatory_reason).trim().length < 10)) {
    throw badRequest("A mandatory/compliance demand needs a reason of at least 10 characters");
  }
  if (patch.status !== undefined && patch.status !== before.status) {
    if (patch.status === "SUBMITTED" && before.status === "DRAFT") {
      after.status = "SUBMITTED";
    } else {
      throw badRequest("Status changes use submit/decide/convert endpoints");
    }
  }
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE demands SET title=$3, problem=$4, outcome_hypothesis=$5, division_id=$6, site_id=$7,
         estimated_cost=$8, estimated_effort_weeks=$9, business_value=$10, time_criticality=$11,
         risk_reduction=$12, reach=$13, impact=$14, confidence=$15, cost_of_delay_week=$16,
         mandatory=$17, mandatory_reason=$18, status=$19, updated_at=now()
       WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
         AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.problem, after.outcome_hypothesis,
       after.division_id, after.site_id, after.estimated_cost, after.estimated_effort_weeks,
       after.business_value, after.time_criticality, after.risk_reduction, after.reach,
       after.impact, after.confidence, after.cost_of_delay_week, after.mandatory,
       after.mandatory_reason, after.status]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM demands WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Demand not found");
      throw conflict("This demand changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "demand", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, [...FIELDS, "status"]),
    });
    return res.rows[0];
  });
}

// Ranked backlog under a chosen model — SUBMITTED demands only.
async function ranked(model = "wsjf") {
  const { rows } = await query(
    `SELECT d.*, u.name AS requester_name, dv.code AS division_code, s.code AS site_code
       FROM demands d
       LEFT JOIN users u ON u.id = d.requester_id
       LEFT JOIN divisions dv ON dv.id = d.division_id
       LEFT JOIN sites s ON s.id = d.site_id
      WHERE d.deleted_at IS NULL AND d.status = 'SUBMITTED'`);
  return scoring.rank(rows, model);
}

async function list(statusFilter) {
  const params = [];
  let where = "d.deleted_at IS NULL";
  if (statusFilter) { params.push(statusFilter); where += ` AND d.status = $${params.length}`; }
  const { rows } = await query(
    `SELECT d.*, u.name AS requester_name, dv.code AS division_code, s.code AS site_code,
            p.code AS project_code
       FROM demands d
       LEFT JOIN users u ON u.id = d.requester_id
       LEFT JOIN divisions dv ON dv.id = d.division_id
       LEFT JOIN sites s ON s.id = d.site_id
       LEFT JOIN projects p ON p.id = d.converted_project_id
      WHERE ${where} ORDER BY d.created_at DESC`, params);
  return rows;
}

// Steering/Admin decision on a submitted demand
async function decide(actor, id, decision, note, expectedUpdatedAt) {
  if (!canDecide(actor)) throw forbidden("Only Steering Committee or Admin decide demands");
  if (!["APPROVED", "REJECTED"].includes(decision)) throw badRequest("Decision must be APPROVED or REJECTED");
  if (!note || note.trim().length < 5) throw badRequest("A decision note is required");
  const before = await loadDemand(id);
  if (before.status !== "SUBMITTED") throw badRequest(`Only submitted demands are decided (currently ${before.status})`);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE demands SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, updated_at=now()
       WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
       RETURNING *`,
      [id, expectedUpdatedAt, decision, actor.id, note]);
    if (!rows.length) throw conflict("This demand changed since you loaded it — review and retry", { current: before });
    await audit.record(client, {
      entity: "demand", entityId: id, userId: actor.id,
      changes: [{ field: "status", old: "SUBMITTED", new: decision }],
    });
    if (before.requester_id) {
      await notifications.create(client, {
        userId: before.requester_id, type: "CHANGE_REQUEST", entity: "demand", entityId: id,
        text: `Demand ${decision.toLowerCase()}: ${before.title} — ${note}`,
        createdBy: actor.id,
      });
    }
    return rows[0];
  });
}

// Convert an APPROVED demand into an IDEA-stage project (creator authority
// follows project creation: Admin/Division Lead). The link is permanent.
async function convert(actor, id, projectInput) {
  if (!(actor.role === "ADMIN" || actor.role === "DIVISION_LEAD")) {
    throw forbidden("Only Admin or Division Leads convert demands into projects");
  }
  const demand = await loadDemand(id);
  if (demand.status !== "APPROVED") throw badRequest(`Only APPROVED demands convert (currently ${demand.status})`);
  const project = await projects.createProject(actor, {
    title: projectInput?.title || demand.title,
    description: [demand.problem, demand.outcome_hypothesis].filter(Boolean).join("\n\n") || null,
    lead_division_id: projectInput?.lead_division_id || demand.division_id,
    sites: demand.site_id ? [demand.site_id] : [],
    governance: projectInput?.governance,
    ...projectInput,
  });
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE demands SET status='CONVERTED', converted_project_id=$2, updated_at=now()
        WHERE id=$1 AND status='APPROVED' RETURNING id`,
      [id, project.id]);
    if (!rows.length) throw conflict("Demand was converted concurrently");
    await client.query(`UPDATE projects SET demand_id=$2 WHERE id=$1`, [project.id, id]);
    await audit.record(client, {
      entity: "demand", entityId: id, userId: actor.id,
      changes: [{ field: "converted_project_id", old: null, new: String(project.id) }],
    });
  });
  return { demand: await loadDemand(id), project };
}

module.exports = { create, update, list, ranked, decide, convert, loadDemand };
