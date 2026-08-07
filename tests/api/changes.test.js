"use strict";
// E06 — change control + baselines: original baseline preserved, approval
// authority (Steering/Admin), approved CR auto-captures a new version,
// forecast changes never rewrite history.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, viewer, project, cr;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  // Awa is PM → FULL access but NOT Steering
  project = (await infLead.post("/api/v1/projects").send({
    title: "Warehouse WMS", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.contribSGO, start_date: "2026-01-01", target_date: "2026-10-31",
  })).body.project;
  await infLead.post(`/api/v1/projects/${project.id}/milestones`).send({
    title: "Go-live", type: "GO_LIVE", due_date: "2026-10-15",
  });
});
after(closePool);

test("E06 baseline v1: PM captures original; viewer cannot; snapshot holds plan", async () => {
  assert.equal((await viewer.post(`/api/v1/projects/${project.id}/baselines`).send({})).status, 403);
  const res = await contribSGO.post(`/api/v1/projects/${project.id}/baselines`)
    .send({ label: "Original baseline" });
  assert.equal(res.status, 201);
  assert.equal(res.body.baseline.version, 1);
  assert.equal(String(res.body.baseline.target_date).slice(0, 10), "2026-10-31");
  const ms = res.body.baseline.milestones_json;
  assert.equal(ms.length, 1);
  assert.equal(ms[0].title, "Go-live");
});

test("E06 change request: rationale enforced, Steering notified, non-Steering cannot decide", async () => {
  const short = await contribSGO.post(`/api/v1/projects/${project.id}/change-requests`).send({
    type: "SCHEDULE", title: "Slip go-live", rationale: "late",
  });
  assert.equal(short.status, 400);

  const res = await contribSGO.post(`/api/v1/projects/${project.id}/change-requests`).send({
    type: "SCHEDULE", title: "Slip go-live by 6 weeks",
    rationale: "Vendor hardware delivery slipped past the port strike window",
    schedule_impact_days: 42, affected_milestones: "Go-live",
  });
  assert.equal(res.status, 201);
  cr = res.body.changeRequest;
  assert.equal(cr.status, "PENDING");

  // viewer (READ) cannot raise one
  assert.equal((await viewer.post(`/api/v1/projects/${project.id}/change-requests`).send({
    type: "SCOPE", title: "x", rationale: "0123456789",
  })).status, 403);

  // PM (FULL but not Steering) cannot decide
  const deny = await contribSGO.post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/decision`)
    .send({ decision: "APPROVED", note: "self-approval attempt", updated_at: cr.updated_at });
  assert.equal(deny.status, 403);

  // Steering member (admin fixture is not SC by default → flag bap lead) — use admin (ADMIN passes)
  const { rows: notif } = await query(
    `SELECT count(*)::int AS n FROM notifications WHERE type = 'CHANGE_REQUEST'`);
  assert.ok(notif[0].n >= 1, "steering/admin notified of pending change request");
});

test("E06 approval: captures baseline v2 in-transaction; original v1 untouched by forecast edits", async () => {
  const ok = await admin.post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/decision`)
    .send({ decision: "APPROVED", note: "Accepted — supplier delay is external", updated_at: cr.updated_at });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.changeRequest.status, "APPROVED");
  assert.equal(ok.body.baseline.version, 2, "approval auto-captures the next baseline");
  assert.equal(ok.body.baseline.change_request_id, cr.id);

  // double-decide blocked
  const again = await admin.post(`/api/v1/projects/${project.id}/change-requests/${cr.id}/decision`)
    .send({ decision: "REJECTED", note: "flip-flop", updated_at: ok.body.changeRequest.updated_at });
  assert.equal(again.status, 400);

  // forecast change (new target date) must NOT rewrite any baseline
  const fresh = (await admin.get(`/api/v1/projects/${project.id}`)).body.project;
  const upd = await admin.put(`/api/v1/projects/${project.id}`).send({
    target_date: "2026-12-15", updated_at: fresh.updated_at,
  });
  assert.equal(upd.status, 200);

  const list = await contribSGO.get(`/api/v1/projects/${project.id}/baselines`);
  assert.equal(list.body.baselines.length, 2);
  assert.equal(String(list.body.baselines[0].target_date).slice(0, 10), "2026-10-31", "v1 original preserved");
  assert.equal(String(list.body.baselines[1].target_date).slice(0, 10), "2026-10-31", "v2 captured pre-slip plan");
  assert.equal(String(list.body.forecast.target_date).slice(0, 10), "2026-12-15", "forecast tracked separately");

  // rejected CR captures nothing
  const cr2 = (await contribSGO.post(`/api/v1/projects/${project.id}/change-requests`).send({
    type: "BUDGET", title: "Extra licences", rationale: "More users than planned at SGO",
    cost_impact: 25000,
  })).body.changeRequest;
  const rej = await admin.post(`/api/v1/projects/${project.id}/change-requests/${cr2.id}/decision`)
    .send({ decision: "REJECTED", note: "Absorb within existing budget", updated_at: cr2.updated_at });
  assert.equal(rej.status, 200);
  assert.equal(rej.body.baseline, null);
  const after2 = await contribSGO.get(`/api/v1/projects/${project.id}/baselines`);
  assert.equal(after2.body.baselines.length, 2, "rejection does not baseline");
});
