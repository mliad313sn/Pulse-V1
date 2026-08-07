"use strict";
// SPM Phase 6 — scenarios: pure evaluation (no mutation), knapsack
// optimization with mandatory pins, Steering-gated decisions, and promotion
// into governed change requests.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const { optimizePortfolio } = require("../../src/modules/scenarios/optimize");

let app, F, admin, infLead, contribSGO, pA, pB, scenario;

before(async () => {
  await initDb();
  F = await fixtures();
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
  pA = (await infLead.post("/api/v1/projects").send({
    title: "Project Alpha", lead_division_id: F.D.INF, sites: [F.S.SGO], target_date: "2026-12-31",
  })).body.project;
  pB = (await infLead.post("/api/v1/projects").send({
    title: "Project Beta", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  await admin.post(`/api/v1/projects/${pB.id}/budget-lines`)
    .send({ category: "Hardware", approved: 80000, actual: 30000 });
});
after(closePool);

test("P6 knapsack: optimal packing under budget; mandatory funded first regardless of score", () => {
  const r = optimizePortfolio([
    { id: 1, title: "big", cost: 60000, value: 10 },
    { id: 2, title: "mid", cost: 50000, value: 9 },
    { id: 3, title: "small", cost: 40000, value: 8 },
    { id: 4, title: "compliance", cost: 30000, value: 0, mandatory: true, mandatory_reason: "Regulator" },
  ], 120000);
  const ids = r.selected.map((s) => s.id).sort();
  // mandatory (30k) leaves 90k: best packing = mid+small (17) beats big alone (10)
  assert.deepEqual(ids, [2, 3, 4]);
  assert.equal(r.totalCost, 120000);
  assert.match(r.selected.find((s) => s.id === 4).reason, /MANDATORY/);
  assert.match(r.rejected.find((s) => s.id === 1).reason, /displaces more value/);
  assert.equal(r.overBudget, false);
});

test("P6 scenario lifecycle: propose, evaluate deterministically (no mutation), decide", async () => {
  assert.equal((await contribSGO.post("/api/v1/scenarios").send({ title: "nope" })).status, 403);

  scenario = (await infLead.post("/api/v1/scenarios").send({
    title: "Defer Alpha, stop Beta",
    moves: [
      { project_id: pA.id, action: "DEFER", months: 3 },
      { project_id: pB.id, action: "STOP" },
    ],
  })).body.scenario;
  assert.equal(scenario.status, "DRAFT");

  const ev = await admin.get(`/api/v1/scenarios/${scenario.id}/evaluate`);
  const defer = ev.body.effects.find((e) => e.project_id === pA.id);
  assert.equal(defer.schedule.to, "2027-03-31", "Dec 31 + 3 months");
  const stop = ev.body.effects.find((e) => e.project_id === pB.id);
  assert.equal(stop.budget.freed, 50000, "approved 80k − actual 30k");
  assert.equal(ev.body.budgetDelta, -50000);

  // evaluation mutated nothing
  const fresh = (await infLead.get(`/api/v1/projects/${pA.id}`)).body.project;
  assert.equal(String(fresh.target_date).slice(0, 10), "2026-12-31");

  // money masked for non-finance evaluator
  const evLead = await infLead.get(`/api/v1/scenarios/${scenario.id}/evaluate`);
  assert.equal(evLead.body.budgetDelta, null);
  assert.ok(!JSON.stringify(evLead.body.effects).includes("freed"));

  // decision is Steering-only
  assert.equal((await infLead.post(`/api/v1/scenarios/${scenario.id}/decision`)
    .send({ decision: "APPROVED", note: "lead cannot", updated_at: scenario.updated_at })).status, 403);
  const ok = await admin.post(`/api/v1/scenarios/${scenario.id}/decision`)
    .send({ decision: "APPROVED", note: "Frees budget for compliance work", updated_at: scenario.updated_at });
  assert.equal(ok.status, 200);
  scenario = ok.body.scenario;
});

test("P6 promotion: approved scenario becomes governed change requests, never direct mutations", async () => {
  const res = await admin.post(`/api/v1/scenarios/${scenario.id}/promote`);
  assert.equal(res.status, 200);
  assert.equal(res.body.scenario.status, "PROMOTED");
  assert.equal(res.body.changeRequests.length, 2);
  const types = res.body.changeRequests.map((c) => c.type).sort();
  assert.deepEqual(types, ["CANCELLATION", "SCHEDULE"]);

  // the CRs are real, PENDING, and carry the scenario rationale
  const crs = await admin.get(`/api/v1/projects/${pA.id}/change-requests`);
  const cr = crs.body.changeRequests[0];
  assert.equal(cr.status, "PENDING", "promotion proposes — humans still decide each CR");
  assert.match(cr.rationale, /Approved portfolio scenario/);
  assert.equal(cr.schedule_impact_days, 90);

  // projects themselves untouched
  const fresh = (await infLead.get(`/api/v1/projects/${pB.id}`)).body.project;
  assert.equal(fresh.operating_status, "IN_PROGRESS", "STOP move did not cancel anything directly");
});
