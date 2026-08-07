"use strict";
// SPM Phase 1 — objectives/OKRs: computed explainable progress (including
// decreasing targets), management authority, project linkage.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");
const { krProgress } = require("../../src/modules/strategy/service");

let app, F, admin, infLead, contribSGO, viewer, objective, project;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Network hardening", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.contribSGO,
  })).body.project;
});
after(closePool);

test("P1 KR math: increasing and decreasing targets both compute explainable progress", () => {
  // increasing: uptime 95 → 99, currently 97 = 50%
  const up = krProgress({ baseline: 95, target: 99, current: 97, unit: "%" });
  assert.equal(up.pct, 50);
  // decreasing: incidents 40 → 10, currently 25 = 50%
  const down = krProgress({ baseline: 40, target: 10, current: 25, unit: "incidents" });
  assert.equal(down.pct, 50);
  assert.match(down.explanation, /25 incidents against 40 → 10: 50%/);
  // overshoot clamps at 100; regression clamps at 0
  assert.equal(krProgress({ baseline: 40, target: 10, current: 5 }).pct, 100);
  assert.equal(krProgress({ baseline: 40, target: 10, current: 50 }).pct, 0);
  assert.equal(krProgress({ baseline: 40, target: 10, current: null }).pct, null);
});

test("P1 objectives: DL defines objective+KRs; contributor/viewer cannot; board computes rollup", async () => {
  assert.equal((await contribSGO.post("/api/v1/objectives").send({ title: "x", period: "2026" })).status, 403);

  const res = await infLead.post("/api/v1/objectives").send({
    title: "Resilient site networks", period: "2026",
    description: "No single point of failure at any mine site",
  });
  assert.equal(res.status, 201);
  objective = res.body.objective;

  const kr1 = await infLead.post(`/api/v1/objectives/${objective.id}/key-results`).send({
    title: "Core uptime", baseline: 95, target: 99, current: 97, unit: "%",
  });
  assert.equal(kr1.status, 201);
  await infLead.post(`/api/v1/objectives/${objective.id}/key-results`).send({
    title: "P1 network incidents / quarter", baseline: 40, target: 10, current: 25, unit: "incidents",
  });
  assert.equal((await viewer.post(`/api/v1/objectives/${objective.id}/key-results`)
    .send({ title: "x", baseline: 0, target: 1 })).status, 403);

  const board = await viewer.get("/api/v1/objectives?period=2026");
  const o = board.body.objectives.find((x) => x.id === objective.id);
  assert.equal(o.key_results.length, 2);
  assert.equal(o.progress_pct, 50, "mean of 50% and 50%");
  assert.match(o.key_results[1].progress.explanation, /against 40 → 10/);
});

test("P1 linkage: PM links their project to an objective; board shows it; measurement updates audited", async () => {
  // viewer cannot link; PM (FULL) can
  assert.equal((await viewer.post(`/api/v1/projects/${project.id}/objectives/${objective.id}`)).status, 403);
  const link = await contribSGO.post(`/api/v1/projects/${project.id}/objectives/${objective.id}`);
  assert.equal(link.status, 200);

  const board = await admin.get("/api/v1/objectives");
  const o = board.body.objectives.find((x) => x.id === objective.id);
  assert.ok(o.projects.some((p) => p.id === project.id), "linked project visible with its RAG");

  // measurement update by the objective owner (infLead created it → owner)
  const kr = o.key_results[0];
  const upd = await infLead.put(`/api/v1/key-results/${kr.id}`).send({ current: 98, updated_at: kr.updated_at });
  assert.equal(upd.status, 200);
  const after2 = await admin.get("/api/v1/objectives");
  const o2 = after2.body.objectives.find((x) => x.id === objective.id);
  assert.equal(o2.key_results[0].progress.pct, 75, "97→98 of 95→99 = 75%");

  // contributor (not owner, not DL) cannot type measurements
  assert.equal((await contribSGO.put(`/api/v1/key-results/${kr.id}`)
    .send({ current: 99, updated_at: upd.body.keyResult.updated_at })).status, 403);
});
