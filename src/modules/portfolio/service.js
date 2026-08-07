"use strict";
// E04 — portfolio hierarchy (plan §10). Configuration (pillars/portfolios/
// programs) is Admin work; Division Leads may also create portfolios/programs.
// Aggregate health NEVER leaks hidden projects: every rollup is computed over
// the same visibility predicate the portfolio wall uses (confidentiality +
// site isolation), so counts differ per viewer by design.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");

const canConfigure = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD";

// Same visibility rules as projects service (kept in sync with confidentialityWhere).
function visibilityWhere(user, params) {
  const clauses = ["p.deleted_at IS NULL"];
  if (!(user.role === "ADMIN" || user.role === "DIVISION_LEAD")) {
    params.push(user.id);
    clauses.push(`(p.confidential = false OR p.project_manager_id = $${params.length})`);
  }
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1, user.id);
    clauses.push(`(EXISTS (SELECT 1 FROM project_sites psi WHERE psi.project_id = p.id
                    AND psi.deleted_at IS NULL AND psi.site_id = $${params.length - 1})
                  OR p.project_manager_id = $${params.length})`);
  }
  return clauses.join(" AND ");
}

// ===== pillars =====
async function listPillars() {
  const { rows } = await query(
    `SELECT id, name, description, updated_at FROM strategic_pillars
      WHERE deleted_at IS NULL ORDER BY name`
  );
  return rows;
}

async function createPillar(actor, input) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin configures strategic pillars");
  return withTransaction(async (client) => {
    const dup = await client.query(
      `SELECT 1 FROM strategic_pillars WHERE lower(name) = lower($1) AND deleted_at IS NULL`,
      [input.name]
    );
    if (dup.rows.length) throw badRequest("A pillar with this name already exists");
    const { rows } = await client.query(
      `INSERT INTO strategic_pillars (name, description, created_by)
       VALUES ($1,$2,$3) RETURNING *`,
      [input.name, input.description || null, actor.id]
    );
    await audit.recordCreate(client, "strategic_pillar", rows[0].id, actor.id);
    return rows[0];
  });
}

// ===== portfolios =====
const PORTFOLIO_FIELDS = ["title", "description", "objective", "pillar_id", "owner_user_id", "horizon_start", "horizon_end"];

async function createPortfolio(actor, input) {
  if (!canConfigure(actor)) throw forbidden("Only Admin or Division Leads create portfolios");
  return withTransaction(async (client) => {
    if (input.pillar_id != null) {
      const p = await client.query(
        `SELECT 1 FROM strategic_pillars WHERE id = $1 AND deleted_at IS NULL`, [input.pillar_id]);
      if (!p.rows.length) throw badRequest("Unknown strategic pillar");
    }
    const { rows } = await client.query(
      `INSERT INTO portfolios (title, description, objective, pillar_id, owner_user_id,
         horizon_start, horizon_end, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.title, input.description || null, input.objective || null,
       input.pillar_id || null, input.owner_user_id || null,
       input.horizon_start || null, input.horizon_end || null, actor.id]
    );
    await audit.recordCreate(client, "portfolio", rows[0].id, actor.id);
    return rows[0];
  });
}

async function updatePortfolio(actor, id, patch, expectedUpdatedAt) {
  if (!canConfigure(actor)) throw forbidden("Only Admin or Division Leads edit portfolios");
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");
  const { rows } = await query(`SELECT * FROM portfolios WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const current = rows[0];
  if (!current) throw notFound("Portfolio not found");
  const after = { ...current };
  for (const f of PORTFOLIO_FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE portfolios SET title=$3, description=$4, objective=$5, pillar_id=$6,
         owner_user_id=$7, horizon_start=$8, horizon_end=$9, updated_at=now()
       WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
         AND deleted_at IS NULL
       RETURNING *`,
      [id, expectedUpdatedAt, after.title, after.description, after.objective,
       after.pillar_id, after.owner_user_id, after.horizon_start, after.horizon_end]
    );
    if (!res.rows.length) {
      const cur = await client.query(`SELECT * FROM portfolios WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!cur.rows[0]) throw notFound("Portfolio not found");
      throw conflict("This portfolio changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "portfolio", entityId: id, userId: actor.id,
      changes: audit.diff(current, after, PORTFOLIO_FIELDS),
    });
    return res.rows[0];
  });
}

// Portfolio list with per-viewer aggregate health, financial and benefit summaries.
// Finance summary is server-side masked: null unless ADMIN/finance_access (§145).
async function listPortfolios(user) {
  const params = [];
  const vis = visibilityWhere(user, params);
  const canFinance = user.role === "ADMIN" || user.finance_access === true;
  const { rows } = await query(
    `SELECT pf.id, pf.title, pf.description, pf.objective, pf.horizon_start, pf.horizon_end,
            pf.updated_at,
            sp.id AS pillar_id, sp.name AS pillar_name,
            ou.name AS owner_name,
            (SELECT json_agg(json_build_object('id', pr.id, 'title', pr.title) ORDER BY pr.title)
               FROM programs pr WHERE pr.portfolio_id = pf.id AND pr.deleted_at IS NULL) AS programs,
            (SELECT count(*)::int FROM projects p
              WHERE p.portfolio_id = pf.id AND ${vis}) AS project_count,
            (SELECT count(*)::int FROM projects p
              WHERE p.portfolio_id = pf.id AND ${vis}
                AND coalesce(p.rag_override, p.rag_computed) = 'R'
                AND p.stage <> 'CLOSED' AND p.operating_status <> 'CANCELLED') AS red_count,
            (SELECT count(*)::int FROM projects p
              WHERE p.portfolio_id = pf.id AND ${vis}
                AND coalesce(p.rag_override, p.rag_computed) = 'A'
                AND p.stage <> 'CLOSED' AND p.operating_status <> 'CANCELLED') AS amber_count,
            (SELECT count(DISTINCT ps.site_id)::int FROM project_sites ps
              WHERE ps.deleted_at IS NULL AND ps.project_id IN
                (SELECT p.id FROM projects p WHERE p.portfolio_id = pf.id AND ${vis})) AS site_count,
            (SELECT count(DISTINCT pd.division_id)::int FROM project_divisions pd
              WHERE pd.deleted_at IS NULL AND pd.project_id IN
                (SELECT p.id FROM projects p WHERE p.portfolio_id = pf.id AND ${vis})) AS division_count,
            ${canFinance ? `(SELECT json_build_object(
                'approved', coalesce(sum(b.approved), 0),
                'forecast', coalesce(sum(b.forecast), 0),
                'actual', coalesce(sum(b.actual), 0))
               FROM budget_lines b
              WHERE b.deleted_at IS NULL AND b.project_id IN
                (SELECT p.id FROM projects p WHERE p.portfolio_id = pf.id AND ${vis}))` : "NULL::json"} AS finance,
            (SELECT count(*)::int FROM benefits bn
              WHERE bn.deleted_at IS NULL AND bn.status = 'REALIZED' AND bn.project_id IN
                (SELECT p.id FROM projects p WHERE p.portfolio_id = pf.id AND ${vis})) AS benefits_realized
       FROM portfolios pf
       LEFT JOIN strategic_pillars sp ON sp.id = pf.pillar_id
       LEFT JOIN users ou ON ou.id = pf.owner_user_id
      WHERE pf.deleted_at IS NULL
      ORDER BY pf.title`,
    params
  );
  for (const r of rows) {
    r.health = r.red_count > 0 ? "R" : r.amber_count > 0 ? "A" : r.project_count > 0 ? "G" : null;
  }
  return rows;
}

// ===== programs =====
async function createProgram(actor, input) {
  if (!canConfigure(actor)) throw forbidden("Only Admin or Division Leads create programs");
  return withTransaction(async (client) => {
    const pf = await client.query(
      `SELECT 1 FROM portfolios WHERE id = $1 AND deleted_at IS NULL`, [input.portfolio_id]);
    if (!pf.rows.length) throw badRequest("Unknown portfolio");
    const { rows } = await client.query(
      `INSERT INTO programs (title, objective, portfolio_id, owner_user_id,
         horizon_start, horizon_end, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.title, input.objective || null, input.portfolio_id,
       input.owner_user_id || null, input.horizon_start || null,
       input.horizon_end || null, actor.id]
    );
    await audit.recordCreate(client, "program", rows[0].id, actor.id);
    return rows[0];
  });
}

async function listPrograms(user, portfolioId) {
  const params = [];
  const vis = visibilityWhere(user, params);
  params.push(portfolioId || null);
  const pfFilter = `($${params.length}::bigint IS NULL OR pr.portfolio_id = $${params.length})`;
  const { rows } = await query(
    `SELECT pr.id, pr.title, pr.objective, pr.portfolio_id, pr.horizon_start, pr.horizon_end,
            pr.updated_at, pf.title AS portfolio_title, ou.name AS owner_name,
            (SELECT count(*)::int FROM projects p WHERE p.program_id = pr.id AND ${vis}) AS project_count,
            (SELECT count(*)::int FROM projects p
              WHERE p.program_id = pr.id AND ${vis}
                AND coalesce(p.rag_override, p.rag_computed) = 'R'
                AND p.stage <> 'CLOSED' AND p.operating_status <> 'CANCELLED') AS red_count,
            (SELECT count(*)::int FROM projects p
              WHERE p.program_id = pr.id AND ${vis}
                AND coalesce(p.rag_override, p.rag_computed) = 'A'
                AND p.stage <> 'CLOSED' AND p.operating_status <> 'CANCELLED') AS amber_count
       FROM programs pr
       JOIN portfolios pf ON pf.id = pr.portfolio_id
       LEFT JOIN users ou ON ou.id = pr.owner_user_id
      WHERE pr.deleted_at IS NULL AND ${pfFilter}
      ORDER BY pr.title`,
    params
  );
  for (const r of rows) {
    r.health = r.red_count > 0 ? "R" : r.amber_count > 0 ? "A" : r.project_count > 0 ? "G" : null;
  }
  return rows;
}

// Shared by projects service: a project's program must live in its portfolio.
async function assertHierarchy(runner, portfolioId, programId) {
  if (portfolioId != null) {
    const pf = await runner.query(
      `SELECT 1 FROM portfolios WHERE id = $1 AND deleted_at IS NULL`, [portfolioId]);
    if (!pf.rows.length) throw badRequest("Unknown portfolio");
  }
  if (programId != null) {
    const pr = await runner.query(
      `SELECT portfolio_id FROM programs WHERE id = $1 AND deleted_at IS NULL`, [programId]);
    if (!pr.rows.length) throw badRequest("Unknown program");
    if (portfolioId == null) {
      throw badRequest("A project in a program must also carry the program's portfolio");
    }
    if (pr.rows[0].portfolio_id !== portfolioId) {
      throw badRequest("Program does not belong to the selected portfolio");
    }
  }
}

module.exports = {
  listPillars, createPillar,
  createPortfolio, updatePortfolio, listPortfolios,
  createProgram, listPrograms,
  assertHierarchy,
};
