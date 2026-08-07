"use strict";
// SPM Phase 1 — demand lifecycle: intake by any non-Viewer, ranked backlog,
// Steering/Admin decision, governed conversion to an IDEA project with a
// permanent audited two-way link.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, viewer, demand;

before(async () => {
  await initDb();
  F = await fixtures();
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
});
after(closePool);

test("P1 intake: a site contributor raises an idea; Viewers cannot; mandatory needs a reason", async () => {
  assert.equal((await viewer.post("/api/v1/demands").send({ title: "nope" })).status, 403);

  const noReason = await contribSGO.post("/api/v1/demands").send({
    title: "Compliance thing", mandatory: true,
  });
  assert.equal(noReason.status, 400);

  const res = await contribSGO.post("/api/v1/demands").send({
    title: "Wi-Fi for the new camp block",
    problem: "Crews in block D have no coverage; paper-based shift handover",
    outcome_hypothesis: "Digital handover on tablets, fewer missed instructions",
    business_value: 7, time_criticality: 6, risk_reduction: 3, estimated_effort_weeks: 4,
  });
  assert.equal(res.status, 201);
  demand = res.body.demand;
  assert.equal(demand.status, "DRAFT");
  assert.equal(demand.requester_id, F.U.contribSGO);
  assert.equal(demand.site_id, F.S.SGO, "defaults to the requester's site");
});

test("P1 ranked backlog: submitted demands ranked by model; mandatory pinned; explainable", async () => {
  // submit the first demand
  const s1 = await contribSGO.put(`/api/v1/demands/${demand.id}`)
    .send({ status: "SUBMITTED", updated_at: demand.updated_at });
  assert.equal(s1.status, 200);

  const d2 = (await infLead.post("/api/v1/demands").send({
    title: "Firewall firmware compliance", mandatory: true,
    mandatory_reason: "Group security directive GS-114 deadline",
    estimated_effort_weeks: 2,
  })).body.demand;
  await infLead.put(`/api/v1/demands/${d2.id}`).send({ status: "SUBMITTED", updated_at: d2.updated_at });

  const d3 = (await infLead.post("/api/v1/demands").send({
    title: "Small quality-of-life tweak",
    business_value: 2, time_criticality: 1, risk_reduction: 1, estimated_effort_weeks: 8,
  })).body.demand;
  await infLead.put(`/api/v1/demands/${d3.id}`).send({ status: "SUBMITTED", updated_at: d3.updated_at });

  const ranked = await admin.get("/api/v1/demands/ranked?model=wsjf");
  const titles = ranked.body.demands.map((d) => d.title);
  assert.equal(titles[0], "Firewall firmware compliance", "mandatory first");
  assert.equal(titles[1], "Wi-Fi for the new camp block");
  assert.match(ranked.body.demands[0].scoring.formula, /MANDATORY/);
  assert.match(ranked.body.demands[1].scoring.formula, /WSJF = \(BV 7 \+ TC 6 \+ RR 3\) \/ 4w = 4/);
});

test("P1 decision + conversion: Steering decides; conversion creates a linked IDEA project; frozen after", async () => {
  const fresh = (await admin.get("/api/v1/demands?status=SUBMITTED")).body.demands
    .find((d) => d.id === demand.id);

  // contributor (non-Steering) cannot decide
  const deny = await contribSGO.post(`/api/v1/demands/${demand.id}/decision`)
    .send({ decision: "APPROVED", note: "self-approval", updated_at: fresh.updated_at });
  assert.equal(deny.status, 403);

  const ok = await admin.post(`/api/v1/demands/${demand.id}/decision`)
    .send({ decision: "APPROVED", note: "Clear safety upside, small effort", updated_at: fresh.updated_at });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.demand.status, "APPROVED");

  // contributor cannot convert; Division Lead can
  assert.equal((await contribSGO.post(`/api/v1/demands/${demand.id}/convert`).send({})).status, 403);
  const conv = await infLead.post(`/api/v1/demands/${demand.id}/convert`)
    .send({ lead_division_id: F.D.INF, governance: "LITE" });
  assert.equal(conv.status, 201);
  assert.equal(conv.body.project.stage, "IDEA");
  assert.equal(conv.body.project.governance, "LITE");
  assert.equal(conv.body.demand.status, "CONVERTED");
  assert.equal(conv.body.demand.converted_project_id, conv.body.project.id);

  // two-way link + audit trail exists
  const { rows: proj } = await query(`SELECT demand_id FROM projects WHERE id = $1`, [conv.body.project.id]);
  assert.equal(proj[0].demand_id, demand.id);
  const { rows: aud } = await query(
    `SELECT count(*)::int AS n FROM audit_log WHERE entity = 'demand' AND entity_id = $1`, [demand.id]);
  assert.ok(aud[0].n >= 3, "create, decide and convert are all audited");

  // converted demand is frozen
  const frozen = await contribSGO.put(`/api/v1/demands/${demand.id}`)
    .send({ title: "rewrite history", updated_at: conv.body.demand.updated_at });
  assert.equal(frozen.status, 400);
  assert.match(frozen.body.error, /frozen/);
});
