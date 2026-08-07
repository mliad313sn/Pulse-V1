"use strict";
// SPM Phase 4 — earned value: pure math + API with finance masking.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");
const { computeEvm } = require("../../src/modules/finance/evm");

let app, F, admin, infLead, viewer, project;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "EVM project", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
});
after(closePool);

test("P4 EVM math: CPI/SPI/EAC/VAC with explanations", () => {
  const r = computeEvm({
    costPlan: [
      { period: "2026-07", planned: 50000 },
      { period: "2026-08", planned: 50000 },
      { period: "2026-09", planned: 100000 },
    ],
    progressPct: 40, actualCost: 90000, asOfPeriod: "2026-08",
  });
  assert.equal(r.BAC, 200000);
  assert.equal(r.PV, 100000, "planned through August");
  assert.equal(r.EV, 80000, "40% of BAC");
  assert.equal(r.CPI, 0.89, "80k earned for 90k spent");
  assert.equal(r.SPI, 0.8, "earned 80k of 100k planned");
  assert.equal(r.ETC, Math.round((200000 - 80000) / 0.89 * 100) / 100);
  assert.equal(r.EAC, Math.round((90000 + r.ETC) * 100) / 100);
  assert.equal(r.VAC, Math.round((200000 - r.EAC) * 100) / 100);
  assert.equal(r.health.cost, "WATCH");
  assert.equal(r.health.schedule, "BAD");
  assert.match(r.explanation, /CPI 0.89 = EV\/AC \(over spend for work done\)/);
  assert.match(r.explanation, /SPI 0.8 = EV\/PV \(behind plan\)/);

  // no actuals yet → CPI/EAC honestly n/a, never fake zeros
  const clean = computeEvm({ costPlan: [{ period: "2026-07", planned: 1000 }], progressPct: 10, actualCost: 0 });
  assert.equal(clean.CPI, null);
  assert.equal(clean.EAC, null);
});

test("P4 EVM API: cost plan is finance-gated; metrics use FX-converted actuals and computed progress", async () => {
  // masking first
  assert.equal((await viewer.put(`/api/v1/projects/${project.id}/cost-plan`)
    .send({ periods: [{ period: "2026-08", planned: 1 }] })).status, 403);
  assert.equal((await viewer.get(`/api/v1/projects/${project.id}/evm`)).status, 403);
  assert.equal((await infLead.get(`/api/v1/projects/${project.id}/evm`)).status, 403,
    "even the lead-division head is masked without the finance flag");

  const plan = await admin.put(`/api/v1/projects/${project.id}/cost-plan`).send({
    periods: [
      { period: "2026-07", planned: 60000 },
      { period: "2026-08", planned: 60000 },
    ],
  });
  assert.equal(plan.status, 200);

  // actuals in XOF convert to base before AC (10M XOF × 0.00165 = 16,500 USD)
  await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Hardware", currency: "XOF", actual: 10000000, approved: 10000000 });

  // give the project computed progress: 1 of 2 milestones done
  const m1 = (await infLead.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Design done", due_date: "2026-07-15" })).body.milestone;
  await infLead.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Build done", due_date: "2026-09-15" });
  await infLead.put(`/api/v1/milestones/${m1.id}`).send({ status: "DONE", updated_at: m1.updated_at });

  const evm = await admin.get(`/api/v1/projects/${project.id}/evm?asOf=2026-08`);
  assert.equal(evm.status, 200);
  assert.equal(evm.body.BAC, 120000);
  assert.equal(evm.body.PV, 120000);
  assert.equal(evm.body.EV, 60000, "50% computed progress × BAC");
  assert.equal(evm.body.AC, 16500, "XOF actuals converted to USD base");
  assert.equal(evm.body.CPI, Math.round(60000 / 16500 * 100) / 100);
  assert.match(evm.body.progress_source, /computed milestone progress/);
});
