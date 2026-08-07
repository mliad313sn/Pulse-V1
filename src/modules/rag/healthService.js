"use strict";
// SPM Phase 5 — assembles the inputs for the Health 2.0 engine under the
// caller's own authorization. Finance is gathered ONLY when the caller carries
// the flag; without it the finance dimension is dropped and its weight is
// redistributed rather than scored as if it were bad.
const { query } = require("../../db/pool");
const { computeHealth } = require("./health");
const { gmtToday } = require("./compute");

async function projectHealth(user, projectAccess) {
  const p = projectAccess.project;
  const canFinance = user.role === "ADMIN" || user.finance_access === true;

  const [ms, risks, roadblocks, benefits, allocations, changes, capas, baselines, tasks, status] =
    await Promise.all([
      query(`SELECT id, title, type, status, due_date FROM milestones
              WHERE project_id = $1 AND deleted_at IS NULL`, [p.id]),
      query(`SELECT id, title, status, score,
                    (residual_probability * residual_impact) AS residual_score
               FROM risks WHERE project_id = $1 AND deleted_at IS NULL`, [p.id]),
      query(`SELECT id, title, severity, status FROM roadblocks
              WHERE project_id = $1 AND deleted_at IS NULL`, [p.id]),
      query(`SELECT id, title, status FROM benefits
              WHERE project_id = $1 AND deleted_at IS NULL`, [p.id]),
      query(`SELECT ra.id, ra.user_id, ra.percent, u.name
               FROM resource_allocations ra JOIN users u ON u.id = ra.user_id
              WHERE ra.project_id = $1 AND ra.deleted_at IS NULL
                AND (now() AT TIME ZONE 'utc')::date BETWEEN ra.start_date AND ra.end_date`, [p.id]),
      query(`SELECT id, title, status,
                    EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days
               FROM change_requests
              WHERE project_id = $1 AND deleted_at IS NULL AND status = 'PENDING'`, [p.id]),
      query(`SELECT id, issue, due_date FROM capas
              WHERE project_id = $1 AND deleted_at IS NULL AND status <> 'CLOSED'
                AND due_date IS NOT NULL AND due_date < (now() AT TIME ZONE 'utc')::date`, [p.id]),
      query(`SELECT count(*)::int AS n FROM project_baselines WHERE project_id = $1`, [p.id]),
      query(`SELECT id, status, estimated_hours, remaining_hours FROM tasks
              WHERE project_id = $1 AND deleted_at IS NULL`, [p.id]),
      query(`SELECT max(created_at) AS last FROM status_updates
              WHERE project_id = $1 AND deleted_at IS NULL`, [p.id]),
    ]);

  // Which allocated people are over-committed across their whole workload?
  let overloadedPeople = [];
  if (allocations.rows.length) {
    const { rows } = await query(
      `SELECT ra.user_id, u.name, sum(ra.percent)::int AS total_percent
         FROM resource_allocations ra
         JOIN users u ON u.id = ra.user_id
         LEFT JOIN projects pr ON pr.id = ra.project_id
        WHERE ra.deleted_at IS NULL AND ra.user_id = ANY($1::bigint[])
          AND ra.allocation_type <> 'LEAVE' AND ra.commitment = 'COMMITTED'
          AND (now() AT TIME ZONE 'utc')::date BETWEEN ra.start_date AND ra.end_date
          AND (ra.project_id IS NULL OR (pr.deleted_at IS NULL AND pr.stage <> 'CLOSED'))
        GROUP BY ra.user_id, u.name HAVING sum(ra.percent) > 100`,
      [allocations.rows.map((a) => a.user_id)]);
    overloadedPeople = rows;
  }

  let finance = null, evm = null;
  if (canFinance) {
    const { rows } = await query(
      `SELECT coalesce(sum(b.approved * fx.rate_to_base),0) AS approved,
              coalesce(sum(b.actual * fx.rate_to_base),0) AS actual
         FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
        WHERE b.project_id = $1 AND b.deleted_at IS NULL`, [p.id]);
    finance = rows[0];
    try {
      const financeSvc = require("../finance/service");
      const e = await financeSvc.evm(user, projectAccess);
      if (e && e.cpi != null) evm = e;
    } catch { /* EVM needs a cost plan; its absence is not a health failure */ }
  }

  const health = computeHealth({
    stage: p.stage,
    operatingStatus: p.operating_status,
    governance: p.governance,
    progressMethod: p.progress_method || "MILESTONE",
    progressManual: p.progress_manual,
    progressManualNote: p.progress_manual_note,
    milestones: ms.rows,
    risks: risks.rows,
    roadblocks: roadblocks.rows,
    benefits: benefits.rows,
    allocations: allocations.rows,
    overloadedPeople,
    pendingChanges: changes.rows,
    overdueCapas: capas.rows,
    hasBaseline: baselines.rows[0].n > 0,
    tasks: tasks.rows,
    finance,
    evm,
    lastStatusUpdateAt: status.rows[0].last,
    lastActivityAt: p.last_activity_at,
    createdAt: p.created_at,
    today: gmtToday(),
  });

  // Honest reconciliation with the operational RAG that drives the wall.
  const operational = p.rag_override || p.rag_computed;
  const reconciliation = health.band === operational
    ? `Health 2.0 and the portfolio RAG agree (${operational}).`
    : `Portfolio RAG is ${operational} while Health 2.0 scores ${health.band} — ` +
      `the RAG reflects schedule, roadblocks, actions and freshness only, ` +
      `while Health 2.0 also weighs finance, resources, governance and benefits.`;

  return {
    ...health,
    operationalRag: operational,
    ragOverridden: Boolean(p.rag_override),
    ragOverrideReason: p.rag_override_reason || null,
    reconciliation,
    financeVisible: canFinance,
  };
}

module.exports = { projectHealth };
