"use strict";
// SPM Phase 5 — Health 2.0 over the wire: dimensions carry real record links,
// money stays masked without the finance flag, the reconciliation with the
// portfolio RAG is explicit, and progress methodology is a project setting
// that changes the number and says so.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, project;

const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead] = await Promise.all([login(app, "admin@test.local"), login(app, "inf@test.local")]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Health subject", lead_division_id: F.D.INF, sites: [F.S.SGO],
    description: "A project rich enough to exercise every health dimension",
  })).body.project;

  await infLead.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Late cutover", type: "GO_LIVE", due_date: daysAgo(20) });
  await infLead.post(`/api/v1/projects/${project.id}/risks`)
    .send({ title: "Single supplier", probability: 5, impact: 5 });
  await infLead.post(`/api/v1/projects/${project.id}/roadblocks`)
    .send({ title: "Customs hold", severity: "CRITICAL" });
  await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Hardware", approved: 200000, actual: 180000 });
});
after(closePool);

test("P5 health: weighted dimensions, each linking the records that caused the score", async () => {
  const res = await admin.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(res.status, 200);
  const h = res.body;

  assert.ok(h.score >= 0 && h.score <= 100);
  assert.ok(["G", "A", "R"].includes(h.band));
  for (const dim of ["schedule", "risks", "finance", "resources", "governance", "benefits", "confidence"]) {
    assert.ok(h.dimensions[dim], `dimension ${dim} present`);
    assert.equal(typeof h.dimensions[dim].score, "number");
    assert.ok(h.dimensions[dim].weight > 0, `${dim} carries a weight`);
    assert.ok(h.dimensions[dim].detail, `${dim} explains itself`);
  }

  // record links, not just numbers
  const sched = h.dimensions.schedule.contributors.find((c) => c.type === "milestone");
  assert.ok(sched && sched.id, "the late milestone is linked by id");
  assert.match(sched.why, /overdue \(GO_LIVE\)/);
  const risk = h.dimensions.risks.contributors.find((c) => c.type === "risk");
  assert.ok(risk && risk.id, "the risk is linked by id");
  assert.ok(h.dimensions.risks.contributors.some((c) => c.type === "roadblock"));

  // and a plain-language summary naming the worst dimensions
  assert.match(h.explanation, /Health \d+\/100/);
  assert.ok(h.drivers.length > 0);
  assert.ok(h.reconciliation.includes("RAG"));
});

test("P5 finance masking: without the flag the money dimension is dropped, not guessed", async () => {
  const res = await infLead.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.body.financeVisible, false);
  assert.equal(res.body.dimensions.finance, undefined, "no finance dimension without the flag");
  assert.deepEqual(res.body.maskedDimensions, ["finance"]);
  assert.ok(!JSON.stringify(res.body).includes("200000"), "no budget figure leaks");
  assert.ok(!JSON.stringify(res.body).includes("180000"));

  // the authorized view does include it
  const asAdmin = await admin.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(asAdmin.body.financeVisible, true);
  assert.ok(asAdmin.body.dimensions.finance.contributors.length > 0);
});

test("P5 progress methodology: switching the method changes the number and states its basis", async () => {
  const before_ = await admin.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(before_.body.progress.method, "MILESTONE");
  assert.match(before_.body.progress.basis, /milestones/);

  // give it tasks, then measure by effort
  const ws = (await infLead.post(`/api/v1/projects/${project.id}/workstreams`)
    .send({ title: "Delivery" })).body.workstream;
  await infLead.post(`/api/v1/projects/${project.id}/tasks`)
    .send({ title: "Rack install", workstream_id: ws.id, estimated_hours: 40, status: "DONE" });
  await infLead.post(`/api/v1/projects/${project.id}/tasks`)
    .send({ title: "Cabling", workstream_id: ws.id, estimated_hours: 60, remaining_hours: 30 });

  const p = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  const upd = await infLead.put(`/api/v1/projects/${project.id}`)
    .send({ progress_method: "EFFORT", updated_at: p.updated_at });
  assert.equal(upd.status, 200);

  const byEffort = await admin.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(byEffort.body.progress.method, "EFFORT");
  assert.equal(byEffort.body.progress.pct, 70, "70h of 100h estimated effort burned");
  assert.match(byEffort.body.progress.basis, /70h of 100h/);

  // PHYSICAL progress is a human judgement, so the database refuses it unjustified
  const p2 = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  const unjustified = await infLead.put(`/api/v1/projects/${project.id}`)
    .send({ progress_method: "PHYSICAL", progress_manual: 85, updated_at: p2.updated_at });
  assert.equal(unjustified.status, 400, "physical progress without a justification is refused");
  assert.match(unjustified.body.error, /must be justified/);

  const p3 = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  const justified = await infLead.put(`/api/v1/projects/${project.id}`).send({
    progress_method: "PHYSICAL", progress_manual: 85,
    progress_manual_note: "Joint site walkdown with the contractor on the east span",
    updated_at: p3.updated_at,
  });
  assert.equal(justified.status, 200);
  const physical = await admin.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(physical.body.progress.pct, 85);
  assert.match(physical.body.progress.basis, /walkdown/);
});

test("P5 concealment: health of a confidential project is not readable by outsiders", async () => {
  const viewer = await login(app, "viewer@test.local");
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Secret health", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
  const res = await viewer.get(`/api/v1/projects/${secret.id}/health`);
  assert.equal(res.status, 404, "concealed as not-found, never as forbidden");

  // the same viewer CAN read health on a project they are allowed to see
  const open = await viewer.get(`/api/v1/projects/${project.id}/health`);
  assert.equal(open.status, 200, "concealment is targeted, not a blanket denial");
});
