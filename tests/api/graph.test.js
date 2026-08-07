"use strict";
// SPM Phase 7 — decision graph: strategy→delivery→impact traceability with
// why/approvals/impact answers, concealment preserved end to end.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, viewer, project;

before(async () => {
  await initDb();
  F = await fixtures();
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  app = createApp();
  [admin, infLead, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "viewer@test.local"),
  ]);
});
after(closePool);

test("P7 graph: demand origin, objective, gates, CR→baseline, risk→CAPA, downstream — with answers", async () => {
  // demand → approve → convert
  const d = (await infLead.post("/api/v1/demands").send({
    title: "Graph origin idea", problem: "Traceability demo",
    business_value: 7, time_criticality: 5, risk_reduction: 3, estimated_effort_weeks: 4,
  })).body.demand;
  await infLead.put(`/api/v1/demands/${d.id}`).send({ status: "SUBMITTED", updated_at: d.updated_at });
  const fresh = (await admin.get("/api/v1/demands?status=SUBMITTED")).body.demands.find((x) => x.id === d.id);
  await admin.post(`/api/v1/demands/${d.id}/decision`)
    .send({ decision: "APPROVED", note: "Good idea, low effort", updated_at: fresh.updated_at });
  const conv = await infLead.post(`/api/v1/demands/${d.id}/convert`).send({ lead_division_id: F.D.INF });
  project = conv.body.project;

  // objective link
  const obj = (await infLead.post("/api/v1/objectives").send({ title: "Digitize handovers", period: "2026" })).body.objective;
  await infLead.post(`/api/v1/projects/${project.id}/objectives/${obj.id}`);

  // gate: IDEA -> INITIATION (description carried over from demand)
  let p = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  await infLead.put(`/api/v1/projects/${project.id}`).send({
    stage: "INITIATION", sponsor: "CIO", roadmap_pillar: "Network", updated_at: p.updated_at,
  });

  // change request approved -> baseline; risk -> CAPA
  const cr = (await infLead.post(`/api/v1/projects/${project.id}/change-requests`).send({
    type: "SCHEDULE", title: "Slip 2 weeks", rationale: "Vendor availability window",
  })).body.changeRequest;
  await admin.post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/decision`)
    .send({ decision: "APPROVED", note: "Accepted slip", updated_at: cr.updated_at });
  const risk = (await infLead.post(`/api/v1/projects/${project.id}/risks`).send({
    title: "Contractor churn", probability: 3, impact: 4,
  })).body.risk;
  await infLead.post(`/api/v1/projects/${project.id}/capas`).send({
    issue: "Retention plan needed for site techs", risk_id: risk.id, source_type: "RISK",
    root_cause: "Single supplier dependency for cabling crews",
  });

  // downstream dependent project
  const down = (await infLead.post("/api/v1/projects").send({
    title: "Downstream consumer", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  await infLead.post(`/api/v1/projects/${down.id}/depends-on/${project.id}`).send({});

  const g = await admin.get(`/api/v1/projects/${project.id}/graph`);
  assert.equal(g.status, 200);
  const kinds = new Set(g.body.nodes.map((n) => n.kind));
  for (const k of ["project", "demand", "objective", "gate_approval", "change_request", "baseline", "risk", "capa"]) {
    assert.ok(kinds.has(k), `graph carries ${k}`);
  }
  assert.match(g.body.answers.why, /Originates from demand "Graph origin idea"/);
  assert.ok(g.body.answers.approvals.some((a) => /IDEA→INITIATION/.test(a)));
  assert.ok(g.body.answers.lastChanges.some((c) => /SCHEDULE: Slip 2 weeks \(APPROVED\)/.test(c)));
  assert.ok(g.body.answers.impacted.includes(down.code));

  const edgeRels = new Set(g.body.edges.map((e) => e.rel));
  for (const rel of ["converted_into", "serves", "passed_gate", "changed_by", "captured", "carries_risk", "treated_by", "blocks"]) {
    assert.ok(edgeRels.has(rel), `edge ${rel} present`);
  }
});

test("P7 concealment: the graph never leaks hidden downstream projects to a viewer", async () => {
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Secret downstream graph", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
  await admin.post(`/api/v1/projects/${secret.id}/depends-on/${project.id}`).send({});

  const g = await viewer.get(`/api/v1/projects/${project.id}/graph`);
  assert.equal(g.status, 200);
  assert.equal(g.body.concealedDownstream, 1);
  assert.ok(!JSON.stringify(g.body).includes("Secret downstream graph"));
});
