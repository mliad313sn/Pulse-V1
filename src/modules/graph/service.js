"use strict";
// SPM Phase 7 — the Pulse Decision Graph: every relationship a project
// carries, assembled into nodes+edges with "why / what changed / who
// approved" answers. Read-only, computed from live records, and served
// through the caller's own project visibility (concealed stays concealed).
const { query } = require("../../db/pool");

async function projectGraph(user, projectAccess) {
  const p = projectAccess.project;
  const nodes = [{ id: `project:${p.id}`, kind: "project", label: `${p.code} ${p.title}`,
    stage: p.stage, rag: p.rag_override || p.rag_computed }];
  const edges = [];
  const add = (node, edge) => { nodes.push(node); edges.push(edge); };

  // Strategy: demand origin, objectives, portfolio line
  const [{ rows: demand }, { rows: objectives }, { rows: hier }] = await Promise.all([
    query(`SELECT d.id, d.title, d.status, d.decided_at, u.name AS decided_by_name, d.decision_note
             FROM demands d LEFT JOIN users u ON u.id = d.decided_by
            WHERE d.id = $1`, [p.demand_id || 0]),
    query(`SELECT o.id, o.title, o.period FROM project_objectives po
             JOIN objectives o ON o.id = po.objective_id
            WHERE po.project_id = $1 AND o.deleted_at IS NULL`, [p.id]),
    query(`SELECT pf.id AS pf_id, pf.title AS pf_title, sp.id AS sp_id, sp.name AS sp_name,
                  pr.id AS pr_id, pr.title AS pr_title
             FROM portfolios pf
             LEFT JOIN strategic_pillars sp ON sp.id = pf.pillar_id
             LEFT JOIN programs pr ON pr.id = $2
            WHERE pf.id = $1`, [p.portfolio_id || 0, p.program_id || 0]),
  ]);
  if (demand.length) {
    add({ id: `demand:${demand[0].id}`, kind: "demand", label: demand[0].title, status: demand[0].status,
          approved_by: demand[0].decided_by_name, note: demand[0].decision_note },
        { from: `demand:${demand[0].id}`, to: `project:${p.id}`, rel: "converted_into" });
  }
  for (const o of objectives) {
    add({ id: `objective:${o.id}`, kind: "objective", label: `${o.title} (${o.period})` },
        { from: `project:${p.id}`, to: `objective:${o.id}`, rel: "serves" });
  }
  if (hier.length && hier[0].pf_id) {
    add({ id: `portfolio:${hier[0].pf_id}`, kind: "portfolio", label: hier[0].pf_title },
        { from: `project:${p.id}`, to: `portfolio:${hier[0].pf_id}`, rel: "belongs_to" });
    if (hier[0].sp_id) {
      add({ id: `pillar:${hier[0].sp_id}`, kind: "pillar", label: hier[0].sp_name },
          { from: `portfolio:${hier[0].pf_id}`, to: `pillar:${hier[0].sp_id}`, rel: "under" });
    }
  }

  // Governance: gate approvals, change requests → baselines, decisions
  const [{ rows: gates }, { rows: crs }, { rows: decisions }] = await Promise.all([
    query(`SELECT st.id, st.from_stage, st.to_stage, st.created_at, u.name AS approved_by_name, st.note
             FROM stage_transitions st LEFT JOIN users u ON u.id = st.approved_by
            WHERE st.project_id = $1 ORDER BY st.id`, [p.id]),
    query(`SELECT cr.id, cr.title, cr.type, cr.status, u.name AS approver_name, cr.decision_note,
                  (SELECT b.version FROM project_baselines b WHERE b.change_request_id = cr.id LIMIT 1) AS baseline_version
             FROM change_requests cr LEFT JOIN users u ON u.id = cr.approver_id
            WHERE cr.project_id = $1 AND cr.deleted_at IS NULL ORDER BY cr.id`, [p.id]),
    query(`SELECT id, text, decided_by, date FROM decisions
            WHERE project_id = $1 AND deleted_at IS NULL ORDER BY date DESC LIMIT 20`, [p.id]),
  ]);
  for (const g of gates) {
    add({ id: `gate:${g.id}`, kind: "gate_approval", label: `${g.from_stage} → ${g.to_stage}`,
          approved_by: g.approved_by_name, at: g.created_at, note: g.note },
        { from: `project:${p.id}`, to: `gate:${g.id}`, rel: "passed_gate" });
  }
  for (const cr of crs) {
    add({ id: `change:${cr.id}`, kind: "change_request", label: cr.title, type: cr.type,
          status: cr.status, approved_by: cr.approver_name, note: cr.decision_note },
        { from: `project:${p.id}`, to: `change:${cr.id}`, rel: "changed_by" });
    if (cr.baseline_version) {
      add({ id: `baseline:${p.id}:${cr.baseline_version}`, kind: "baseline", label: `Baseline v${cr.baseline_version}` },
          { from: `change:${cr.id}`, to: `baseline:${p.id}:${cr.baseline_version}`, rel: "captured" });
    }
  }
  for (const d of decisions) {
    add({ id: `decision:${d.id}`, kind: "decision", label: d.text.slice(0, 120), by: d.decided_by, at: d.date },
        { from: `project:${p.id}`, to: `decision:${d.id}`, rel: "decided" });
  }

  // Delivery & control: risks→CAPAs, benefits
  const [{ rows: risks }, { rows: benefits }] = await Promise.all([
    query(`SELECT r.id, r.title, r.status,
                  (SELECT c.id FROM capas c WHERE c.risk_id = r.id AND c.deleted_at IS NULL LIMIT 1) AS capa_id,
                  (SELECT c.issue FROM capas c WHERE c.risk_id = r.id AND c.deleted_at IS NULL LIMIT 1) AS capa_title
             FROM risks r WHERE r.project_id = $1 AND r.deleted_at IS NULL ORDER BY r.id LIMIT 30`, [p.id]),
    query(`SELECT id, title, status FROM benefits WHERE project_id = $1 AND deleted_at IS NULL LIMIT 20`, [p.id]),
  ]);
  for (const r of risks) {
    add({ id: `risk:${r.id}`, kind: "risk", label: r.title, status: r.status },
        { from: `project:${p.id}`, to: `risk:${r.id}`, rel: "carries_risk" });
    if (r.capa_id) {
      add({ id: `capa:${r.capa_id}`, kind: "capa", label: r.capa_title },
          { from: `risk:${r.id}`, to: `capa:${r.capa_id}`, rel: "treated_by" });
    }
  }
  for (const b of benefits) {
    add({ id: `benefit:${b.id}`, kind: "benefit", label: b.title, status: b.status },
        { from: `project:${p.id}`, to: `benefit:${b.id}`, rel: "delivers" });
  }

  // Downstream impact (reuses concealment-safe blast radius)
  const tasksSvc = require("../tasks/service");
  const blast = await tasksSvc.blastRadius(user, projectAccess);
  for (const a of blast.affected) {
    add({ id: `project:${a.id}`, kind: "project", label: `${a.code} ${a.title}`, depth: a.depth, rag: a.rag },
        { from: `project:${p.id}`, to: `project:${a.id}`, rel: "blocks", depth: a.depth });
  }

  return {
    root: `project:${p.id}`,
    nodes, edges,
    concealedDownstream: blast.concealedCount,
    answers: {
      why: demand.length
        ? `Originates from demand "${demand[0].title}" (${demand[0].status}${demand[0].approved_by ? `, approved by ${demand[0].approved_by}` : ""})`
        : "No recorded demand origin (created directly)",
      approvals: gates.map((g) => `${g.from_stage}→${g.to_stage} by ${g.approved_by_name || "?"}`),
      lastChanges: crs.slice(-3).map((c) => `${c.type}: ${c.title} (${c.status})`),
      impacted: blast.affected.map((a) => a.code),
    },
  };
}

module.exports = { projectGraph };
