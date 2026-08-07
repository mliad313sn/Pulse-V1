"use strict";
// SPM Phase 6 — scenarios: create (DL/Admin/Steering), evaluate (pure what-if,
// zero mutation), optimize (knapsack over approved demand backlog), decide
// (Steering/Admin) and PROMOTE — approval turns each move into a governed
// change request on its project, keeping the human approval chain intact.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { evaluateMoves, optimizePortfolio } = require("./optimize");

const canPropose = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD" || u.is_steering_committee === true;
const canDecide = (u) => u.role === "ADMIN" || u.is_steering_committee === true;

async function create(actor, input) {
  if (!canPropose(actor)) throw forbidden("Only Division Leads, Steering or Admin propose scenarios");
  for (const m of input.moves || []) {
    if (!m.project_id || !["DEFER", "STOP", "BUDGET_DELTA"].includes(m.action)) {
      throw badRequest("Each move needs project_id and action DEFER|STOP|BUDGET_DELTA");
    }
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO scenarios (title, description, moves_json, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.title, input.description || null, JSON.stringify(input.moves || []), actor.id]);
    await audit.recordCreate(client, "scenario", rows[0].id, actor.id);
    return rows[0];
  });
}

async function load(id) {
  const { rows } = await query(`SELECT * FROM scenarios WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows.length) throw notFound("Scenario not found");
  return rows[0];
}

async function list() {
  const { rows } = await query(
    `SELECT s.*, u.name AS created_by_name, d.name AS decided_by_name
       FROM scenarios s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN users d ON d.id = s.decided_by
      WHERE s.deleted_at IS NULL ORDER BY s.created_at DESC`);
  return rows;
}

// Pure evaluation against the user's VISIBLE portfolio — nothing is written.
async function evaluate(user, id) {
  const scenario = await load(id);
  const projects = require("../projects/service");
  const visible = await projects.listPortfolio(user, { includeClosed: false });
  // budget context (finance-authorized only; else effects omit money detail)
  const finance = user.role === "ADMIN" || user.finance_access === true;
  let rows = visible;
  if (finance && visible.length) {
    const { rows: fin } = await query(
      `SELECT b.project_id, coalesce(sum(b.approved * fx.rate_to_base),0) AS approved,
              coalesce(sum(b.actual * fx.rate_to_base),0) AS actual
         FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
        WHERE b.deleted_at IS NULL AND b.project_id = ANY($1::bigint[]) GROUP BY b.project_id`,
      [visible.map((p) => p.id)]);
    const finById = new Map(fin.map((f) => [f.project_id, f]));
    rows = visible.map((p) => ({
      ...p,
      budget_approved: Number(finById.get(p.id)?.approved || 0),
      budget_actual: Number(finById.get(p.id)?.actual || 0),
    }));
  }
  const result = evaluateMoves(rows, scenario.moves_json);
  if (!finance) {
    result.budgetDelta = null; // money masked without the flag
    result.effects = result.effects.map(({ budget, ...e }) => e);
  }
  return { scenario, ...result };
}

// Knapsack over the APPROVED demand backlog under a budget.
async function optimize(user, budget) {
  if (!canPropose(user)) throw forbidden("Only Division Leads, Steering or Admin run optimization");
  const { rows: demands } = await query(
    `SELECT id, title, mandatory, mandatory_reason, estimated_cost AS cost,
            business_value, time_criticality, risk_reduction, estimated_effort_weeks
       FROM demands WHERE deleted_at IS NULL AND status IN ('SUBMITTED','APPROVED')`);
  const scoring = require("../demand/scoring");
  const candidates = demands.map((d) => ({
    ...d,
    cost: Number(d.cost || 0),
    value: d.mandatory ? 0 : (scoring.wsjf(d).score ?? 0),
  }));
  return optimizePortfolio(candidates, budget);
}

async function decide(actor, id, decision, note, expectedUpdatedAt) {
  if (!canDecide(actor)) throw forbidden("Only Steering Committee or Admin decide scenarios");
  if (!["APPROVED", "REJECTED"].includes(decision)) throw badRequest("Decision must be APPROVED or REJECTED");
  if (!note || note.trim().length < 5) throw badRequest("A decision note is required");
  const before = await load(id);
  if (before.status !== "DRAFT") throw badRequest(`Already decided: ${before.status}`);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE scenarios SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
        RETURNING *`,
      [id, expectedUpdatedAt, decision, actor.id, note]);
    if (!rows.length) throw conflict("This scenario changed since you loaded it — review and retry", { current: before });
    await audit.record(client, {
      entity: "scenario", entityId: id, userId: actor.id,
      changes: [{ field: "status", old: "DRAFT", new: decision }],
    });
    return rows[0];
  });
}

// Promotion: every move on an APPROVED scenario becomes a PENDING change
// request on its project — the scenario never mutates projects directly.
async function promote(actor, id) {
  if (!canDecide(actor)) throw forbidden("Only Steering Committee or Admin promote scenarios");
  const scenario = await load(id);
  if (scenario.status !== "APPROVED") throw badRequest(`Only APPROVED scenarios promote (currently ${scenario.status})`);
  const changes = require("../changes/service");
  const { loadProjectAccess } = require("../../middleware/authz");
  const created = [];
  for (const m of scenario.moves_json) {
    const pa = await loadProjectAccess(m.project_id, actor);
    const type = m.action === "STOP" ? "CANCELLATION" : m.action === "DEFER" ? "SCHEDULE" : "BUDGET";
    const cr = await changes.createChangeRequest(actor, pa, {
      type,
      title: `Scenario "${scenario.title}": ${m.action} ${pa.project.code}`,
      rationale: `Approved portfolio scenario #${scenario.id} (${scenario.decision_note || "no note"})`,
      schedule_impact_days: m.action === "DEFER" ? Number(m.months || 0) * 30 : null,
      cost_impact: m.action === "BUDGET_DELTA" ? Number(m.amount || 0) : null,
    });
    created.push({ project_id: m.project_id, change_request_id: cr.id, type });
  }
  await withTransaction(async (client) => {
    await client.query(`UPDATE scenarios SET status='PROMOTED', updated_at=now() WHERE id=$1`, [id]);
    await audit.record(client, {
      entity: "scenario", entityId: id, userId: actor.id,
      changes: [{ field: "status", old: "APPROVED", new: "PROMOTED" }],
    });
  });
  return { scenario: await load(id), changeRequests: created };
}

module.exports = { create, list, load, evaluate, optimize, decide, promote };
