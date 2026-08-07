"use strict";
// E17 finance masking + E18 benefits.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, viewer, project;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  // contribSGO is PM (FULL access) but has NO finance access — the key masking case
  project = (await infLead.post("/api/v1/projects").send({
    title: "Funded project", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.contribSGO,
  })).body.project;
});
after(closePool);

test("finance: server-side masking — even the PM is denied without finance access", async () => {
  // Admin (implicit finance) creates budget lines
  const l1 = await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Hardware", approved: 100000, forecast: 112000, committed: 60000, actual: 41000 });
  assert.equal(l1.status, 201);
  await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Professional Services", capex_opex: "OPEX", approved: 20000, forecast: 20000 });
  // PM without finance flag: read AND write denied (403, not 404 — project itself is visible)
  const pmRead = await contribSGO.get(`/api/v1/projects/${project.id}/financials`);
  assert.equal(pmRead.status, 403);
  const pmWrite = await contribSGO.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Travel", approved: 1 });
  assert.equal(pmWrite.status, 403);
  // viewer + plain division lead (no flag) denied
  assert.equal((await viewer.get(`/api/v1/projects/${project.id}/financials`)).status, 403);
  assert.equal((await infLead.get(`/api/v1/projects/${project.id}/financials`)).status, 403);
  // variance math for authorized reader
  const fin = await admin.get(`/api/v1/projects/${project.id}/financials`);
  assert.equal(fin.body.summary.approved, 120000);
  assert.equal(fin.body.summary.forecast, 132000);
  assert.equal(fin.body.summary.variance, 12000);
  assert.equal(fin.body.summary.variance_pct, 10);
  assert.match(fin.body.summary.explanation, /Forecast 132,000 vs approved 120,000 = \+10%/);
});

test("finance flag grants access; flag removal revokes it; grants are audited", async () => {
  await admin.put(`/api/v1/auth/users/${F.U.infLead}`).send({ financeAccess: true, active: true });
  const dl = await login(app, "inf@test.local"); // fresh session picks up the flag
  const fin = await dl.get(`/api/v1/projects/${project.id}/financials`);
  assert.equal(fin.status, 200);
  assert.equal(fin.body.lines.length, 2);
  await admin.put(`/api/v1/auth/users/${F.U.infLead}`).send({ financeAccess: false, active: true });
  const revoked = await dl.get(`/api/v1/projects/${project.id}/financials`);
  assert.equal(revoked.status, 403, "revocation applies immediately (user reloaded per request)");
  const auditRows = await query(
    `SELECT * FROM audit_log WHERE entity = 'user' AND entity_id = $1 AND field = 'finance_access'`, [F.U.infLead]);
  assert.ok(auditRows.rows.length >= 2, "finance grant + revoke audited");
});

test("benefits: FULL access defines, owner updates progress, statuses tracked", async () => {
  const b = await contribSGO.post(`/api/v1/projects/${project.id}/benefits`).send({
    title: "Reduce network incidents", owner_user_id: F.U.contribSGO,
    baseline: 40, target: 10, unit: "incidents/month", target_date: "2027-03-31",
  });
  assert.equal(b.status, 201, "PM can define benefits (operational, not financial)");
  const denied = await viewer.post(`/api/v1/projects/${project.id}/benefits`).send({ title: "x" });
  assert.equal(denied.status, 403);
  const upd = await contribSGO.put(`/api/v1/benefits/${b.body.benefit.id}`)
    .send({ actual: 22, status: "ON_TRACK", updated_at: b.body.benefit.updated_at });
  assert.equal(upd.status, 200);
  const list = await infLead.get(`/api/v1/projects/${project.id}/benefits`);
  assert.equal(list.body.benefits.length, 1);
  assert.equal(Number(list.body.benefits[0].actual), 22);
});

test("E22 executive command center: composed, scoped, finance masked for unauthorized", async () => {
  // make a RED project (critical roadblock) + go-live + gate-ready project exist
  await admin.post(`/api/v1/projects/${project.id}/roadblocks`).send({ title: "Exec critical", severity: "CRITICAL" });
  await admin.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Prod go-live", type: "GO_LIVE", due_date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
  const execAdmin = await admin.get("/api/v1/reports/executive");
  assert.equal(execAdmin.status, 200);
  assert.ok(execAdmin.body.attention.some((p) => p.id === project.id), "red project in attention list");
  assert.match(execAdmin.body.attention.find((p) => p.id === project.id).why, /critical roadblock/i);
  assert.ok(execAdmin.body.goLives.some((g) => g.title === "Prod go-live"));
  assert.ok(execAdmin.body.finance, "admin sees financial position");
  assert.equal(execAdmin.body.finance.variance, 12000);
  // non-finance viewer: same endpoint, finance block absent
  const execViewer = await viewer.get("/api/v1/reports/executive");
  assert.equal(execViewer.status, 200);
  assert.equal(execViewer.body.finance, null, "finance masked");
  assert.ok(!JSON.stringify(execViewer.body).includes("112000"), "no financial figure leaks");
});
