"use strict";
// E17 — project finance with server-side field masking (plan §42, §145):
// only ADMIN or users flagged finance_access can read or write ANY financial
// value. Full project rights alone (even the PM) are NOT enough. E18 benefits
// share the module: benefits are operational, gated by normal project access.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { loadProjectAccess } = require("../../middleware/authz");

const canFinance = (u) => u.role === "ADMIN" || u.finance_access === true;
const LINE_FIELDS = ["category", "capex_opex", "currency", "approved", "committed", "actual", "forecast", "note"];

async function addLine(actor, projectAccess, input) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  if (projectAccess.access !== "FULL" && actor.role !== "ADMIN" && !actor.finance_access) {
    throw forbidden("Financial access required");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO budget_lines (project_id, category, capex_opex, currency, approved, committed,
         actual, forecast, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [projectAccess.project.id, input.category, input.capex_opex || "CAPEX",
       input.currency || "USD", input.approved || 0, input.committed || 0,
       input.actual || 0, input.forecast || 0, input.note || null, actor.id]
    );
    await audit.recordCreate(client, "budget_line", rows[0].id, actor.id);
    return rows[0];
  });
}

async function updateLine(actor, id, patch, expectedUpdatedAt) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  const { rows } = await query(`SELECT * FROM budget_lines WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const before = rows[0];
  if (!before) throw notFound("Budget line not found");
  await loadProjectAccess(before.project_id, actor); // visibility
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of LINE_FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE budget_lines SET category=$3, capex_opex=$4, currency=$5, approved=$6, committed=$7,
              actual=$8, forecast=$9, note=$10, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.category, after.capex_opex, after.currency,
       after.approved, after.committed, after.actual, after.forecast, after.note]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM budget_lines WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Budget line not found");
      throw conflict("This budget line changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "budget_line", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, LINE_FIELDS),
    });
    return res.rows[0];
  });
}

// Summary with variance (plan §117: "Forecast 112,000 vs approved 100,000 = +12%")
async function financials(actor, projectAccess) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  const { rows } = await query(
    `SELECT * FROM budget_lines WHERE project_id = $1 AND deleted_at IS NULL ORDER BY category`,
    [projectAccess.project.id]
  );
  const sum = (f) => rows.reduce((s, r) => s + Number(r[f]), 0);
  const approved = sum("approved"), forecast = sum("forecast");
  const variance = forecast - approved;
  return {
    lines: rows,
    summary: {
      currency: rows[0]?.currency || "USD",
      approved, committed: sum("committed"), actual: sum("actual"), forecast,
      variance,
      variance_pct: approved > 0 ? Math.round((variance / approved) * 1000) / 10 : null,
      explanation: approved > 0
        ? `Forecast ${forecast.toLocaleString("en-US")} vs approved ${approved.toLocaleString("en-US")} = ${variance >= 0 ? "+" : ""}${Math.round((variance / approved) * 100)}%`
        : "No approved baseline yet",
    },
  };
}

// ===== E18 benefits (operational visibility, normal project access) =====
const BENEFIT_FIELDS = ["title", "owner_user_id", "baseline", "target", "unit", "measure_method", "target_date", "actual", "status"];

async function addBenefit(actor, projectAccess, input) {
  if (projectAccess.access !== "FULL") throw forbidden("Full edit rights required to define benefits");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO benefits (project_id, title, owner_user_id, baseline, target, unit,
         measure_method, target_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectAccess.project.id, input.title, input.owner_user_id || null,
       input.baseline ?? null, input.target ?? null, input.unit || null,
       input.measure_method || null, input.target_date || null, actor.id]
    );
    await audit.recordCreate(client, "benefit", rows[0].id, actor.id);
    return rows[0];
  });
}

async function updateBenefit(actor, id, patch, expectedUpdatedAt) {
  const { rows } = await query(`SELECT * FROM benefits WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const before = rows[0];
  if (!before) throw notFound("Benefit not found");
  const projectAccess = await loadProjectAccess(before.project_id, actor);
  if (projectAccess.access !== "FULL" && before.owner_user_id !== actor.id) {
    throw forbidden("Only full project access or the benefit owner can update it");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const after = { ...before };
  for (const f of BENEFIT_FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE benefits SET title=$3, owner_user_id=$4, baseline=$5, target=$6, unit=$7,
              measure_method=$8, target_date=$9, actual=$10, status=$11, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
          AND deleted_at IS NULL RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.owner_user_id, after.baseline, after.target,
       after.unit, after.measure_method, after.target_date, after.actual, after.status]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM benefits WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Benefit not found");
      throw conflict("This benefit changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "benefit", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, BENEFIT_FIELDS),
    });
    return res.rows[0];
  });
}

async function listBenefits(projectAccess) {
  const { rows } = await query(
    `SELECT b.*, u.name AS owner_name FROM benefits b
       LEFT JOIN users u ON u.id = b.owner_user_id
      WHERE b.project_id = $1 AND b.deleted_at IS NULL ORDER BY b.target_date NULLS LAST, b.id`,
    [projectAccess.project.id]
  );
  return rows;
}

module.exports = { addLine, updateLine, financials, addBenefit, updateBenefit, listBenefits, canFinance };
