"use strict";
// E16: allocation, overload explanation, agenda rule 9, time tracking.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, admin, infLead, contribSGO, viewer, p1, p2;
const shift = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  p1 = (await infLead.post("/api/v1/projects").send({ title: "Alloc One", lead_division_id: F.D.INF, sites: [F.S.SGO] })).body.project;
  p2 = (await infLead.post("/api/v1/projects").send({ title: "Alloc Two", lead_division_id: F.D.INF, sites: [F.S.SGO] })).body.project;
});
after(closePool);

test("allocation creates overload with a per-project explanation; agenda rule 9 surfaces it", async () => {
  const a1 = await infLead.post(`/api/v1/projects/${p1.id}/allocations`)
    .send({ user_id: F.U.contribSGO, start_date: shift(-10), end_date: shift(30), percent: 75, role: "Engineer" });
  assert.equal(a1.status, 201);
  await infLead.post(`/api/v1/projects/${p2.id}/allocations`)
    .send({ user_id: F.U.contribSGO, start_date: shift(-5), end_date: shift(40), percent: 50 });
  // viewer cannot allocate
  const denied = await viewer.post(`/api/v1/projects/${p1.id}/allocations`)
    .send({ user_id: F.U.viewer, start_date: shift(0), end_date: shift(5), percent: 10 });
  assert.equal(denied.status, 403);

  const wl = await admin.get("/api/v1/reports/workload?overloaded=true");
  const row = wl.body.rows.find((r) => r.user_id === F.U.contribSGO);
  assert.ok(row, "overloaded user listed");
  assert.equal(row.total_percent, 125);
  assert.match(row.explanation, /125% allocated across 2 project/);
  assert.match(row.explanation, /75%/);

  // agenda rule 9
  const mt = (await admin.post("/api/v1/meetings")
    .send({ title: "Ops review", date: shift(1), type: "PROJECT_REVIEW" })).body.meeting;
  const detail = await admin.get(`/api/v1/meetings/${mt.id}`);
  const conflict = detail.body.items.find((i) => i.reason === "Resource conflicts");
  assert.ok(conflict, "resource-conflict agenda item present");
  assert.match(conflict.notes, /Awa Diallo at 125%/);
});

test("time tracking: self-log only, visible project required, planned-vs-actual summary", async () => {
  await infLead.post(`/api/v1/projects/${p1.id}/tasks`)
    .send({ title: "Estimated task", estimated_hours: 40, owner_user_id: F.U.contribSGO });
  const t1 = await contribSGO.post("/api/v1/time-entries")
    .send({ project_id: p1.id, entry_date: shift(0), hours: 6.5, description: "cabling" });
  assert.equal(t1.status, 201);
  assert.equal(t1.body.entry.user_id, F.U.contribSGO, "entry always belongs to the actor");
  const vDenied = await viewer.post("/api/v1/time-entries")
    .send({ project_id: p1.id, entry_date: shift(0), hours: 1 });
  assert.equal(vDenied.status, 403);
  const badHours = await contribSGO.post("/api/v1/time-entries")
    .send({ project_id: p1.id, entry_date: shift(0), hours: 25 });
  assert.equal(badHours.status, 400);

  const sum = await infLead.get(`/api/v1/projects/${p1.id}/time-summary`);
  assert.equal(sum.body.estimated, 40);
  assert.equal(sum.body.actual, 6.5);
  assert.ok(sum.body.byUser.some((u) => u.name === "Awa Diallo" && u.hours === 6.5));
});
