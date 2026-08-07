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

// every stored currency must have an FX rate — reject unknown codes up front
async function assertKnownCurrency(currency) {
  const { rows } = await query(`SELECT 1 FROM fx_rates WHERE currency = $1`, [currency]);
  if (!rows.length) {
    const { rows: all } = await query(`SELECT currency FROM fx_rates ORDER BY currency`);
    throw badRequest(`Unknown currency ${currency} — no FX rate configured. Known: ${all.map((r) => r.currency).join(", ")} (Admin can add rates)`);
  }
}
const LINE_FIELDS = ["category", "capex_opex", "currency", "approved", "committed", "actual", "forecast", "note"];

async function addLine(actor, projectAccess, input) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  if (projectAccess.access !== "FULL" && actor.role !== "ADMIN" && !actor.finance_access) {
    throw forbidden("Financial access required");
  }
  await assertKnownCurrency(input.currency || "USD");
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
  if (after.currency !== before.currency) await assertKnownCurrency(after.currency);
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
// Phase 0: aggregation is FX-safe. Lines keep their native currency; every
// total is converted to the base currency (USD) using admin-managed fx_rates.
// The budget_lines.currency FK guarantees a rate exists for every line.
async function financials(actor, projectAccess) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  const { rows } = await query(
    `SELECT b.*, fx.rate_to_base FROM budget_lines b
       JOIN fx_rates fx ON fx.currency = b.currency
      WHERE b.project_id = $1 AND b.deleted_at IS NULL ORDER BY b.category`,
    [projectAccess.project.id]
  );
  const sum = (f) => Math.round(rows.reduce((s, r) => s + Number(r[f]) * Number(r.rate_to_base), 0) * 100) / 100;
  const approved = sum("approved"), forecast = sum("forecast");
  const variance = Math.round((forecast - approved) * 100) / 100;
  const currencies = [...new Set(rows.map((r) => r.currency))];
  return {
    lines: rows.map(({ rate_to_base, ...l }) => l),
    summary: {
      currency: "USD", // base currency of all totals
      source_currencies: currencies,
      converted: currencies.some((c) => c !== "USD"),
      approved, committed: sum("committed"), actual: sum("actual"), forecast,
      variance,
      variance_pct: approved > 0 ? Math.round((variance / approved) * 1000) / 10 : null,
      explanation: approved > 0
        ? `Forecast ${forecast.toLocaleString("en-US")} vs approved ${approved.toLocaleString("en-US")} = ${variance >= 0 ? "+" : ""}${Math.round((variance / approved) * 100)}%${currencies.some((c) => c !== "USD") ? ` (totals in USD, converted from ${currencies.join(", ")})` : ""}`
        : "No approved baseline yet",
    },
  };
}

// FX administration: rates readable by finance users, settable by Admin only.
async function listFxRates() {
  const { rows } = await query(`SELECT currency, rate_to_base, updated_at FROM fx_rates ORDER BY currency`);
  return rows;
}

async function setFxRate(actor, currency, rate) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin manages FX rates");
  if (!/^[A-Z]{3}$/.test(currency)) throw badRequest("Currency must be a 3-letter code");
  if (!(rate > 0)) throw badRequest("Rate must be positive");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO fx_rates (currency, rate_to_base, updated_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (currency) DO UPDATE SET rate_to_base = $2, updated_at = now(), updated_by = $3
       RETURNING *`,
      [currency, rate, actor.id]
    );
    await audit.record(client, {
      entity: "fx_rate", entityId: 0, userId: actor.id,
      changes: [{ field: currency, old: null, new: String(rate) }],
    });
    return rows[0];
  });
}

// ===== SPM P4: time-phased cost plan + EVM =====
const { computeEvm } = require("./evm");

async function setCostPlan(actor, projectAccess, periods) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  for (const p of periods) {
    if (!/^\d{4}-\d{2}$/.test(p.period) || !(Number(p.planned) >= 0)) {
      throw badRequest("Each entry needs period YYYY-MM and planned >= 0");
    }
  }
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM cost_plans WHERE project_id = $1`, [projectAccess.project.id]);
    for (const p of periods) {
      await client.query(
        `INSERT INTO cost_plans (project_id, period, planned, created_by) VALUES ($1,$2,$3,$4)`,
        [projectAccess.project.id, p.period, p.planned, actor.id]);
    }
    await audit.record(client, {
      entity: "project", entityId: projectAccess.project.id, userId: actor.id,
      changes: [{ field: "cost_plan", old: null, new: `${periods.length} periods` }],
    });
    return periods;
  });
}

async function evm(actor, projectAccess, asOfPeriod) {
  if (!canFinance(actor)) throw forbidden("Financial access required");
  const pid = projectAccess.project.id;
  const [{ rows: plan }, { rows: ac }] = await Promise.all([
    query(`SELECT period, planned FROM cost_plans WHERE project_id = $1 ORDER BY period`, [pid]),
    query(`SELECT coalesce(sum(b.actual * fx.rate_to_base),0) AS actual
             FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
            WHERE b.project_id = $1 AND b.deleted_at IS NULL`, [pid]),
  ]);
  const period = asOfPeriod || new Date().toISOString().slice(0, 7);
  return {
    costPlan: plan,
    ...computeEvm({
      costPlan: plan,
      progressPct: projectAccess.project.progress_pct || 0,
      actualCost: Number(ac[0].actual),
      asOfPeriod: period,
    }),
    progress_source: "computed milestone progress (progress_pct)",
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

module.exports = { addLine, updateLine, financials, addBenefit, updateBenefit, listBenefits, canFinance, listFxRates, setFxRate, setCostPlan, evm };
