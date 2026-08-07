"use strict";
// Governance tiers: LITE trims gate paperwork for simple projects, but every
// guardrail survives — no stage skipping, Steering-only Gate 2, critical
// roadblocks still block deployment, actions must be dispositioned to close,
// and a PM cannot lighten their own project's governance.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, project;

const fresh = async (agent = infLead) =>
  (await agent.get(`/api/v1/projects/${project.id}`)).body.project;

before(async () => {
  await initDb();
  F = await fixtures();
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
});
after(closePool);

test("LITE walk: minimal evidence advances IDEA→EXECUTION, but Steering approval still required", async () => {
  project = (await infLead.post("/api/v1/projects").send({
    title: "Printer fleet swap at SGO", lead_division_id: F.D.INF, governance: "LITE",
    project_manager_id: F.U.contribSGO,
  })).body.project;
  assert.equal(project.governance, "LITE");

  // Gate 0 LITE: description alone (no sponsor, no pillar)
  let p = await fresh();
  const g0 = await infLead.put(`/api/v1/projects/${project.id}`).send({
    stage: "INITIATION", description: "Replace 14 end-of-life printers", updated_at: p.updated_at,
  });
  assert.equal(g0.status, 200, JSON.stringify(g0.body));

  // Gate 1 LITE: PM already assigned is enough (no target date, no site)
  p = await fresh();
  const g1 = await infLead.put(`/api/v1/projects/${project.id}`).send({
    stage: "PLANNING", updated_at: p.updated_at,
  });
  assert.equal(g1.status, 200, JSON.stringify(g1.body));

  // Gate 2 LITE: still refuses without a milestone…
  p = await fresh();
  const noMs = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "EXECUTION", updated_at: p.updated_at });
  assert.equal(noMs.status, 400);
  assert.match(noMs.body.error, /milestone/i);
  await infLead.post(`/api/v1/projects/${project.id}/milestones`).send({ title: "All printers swapped", due_date: "2026-09-15" });

  // …and still refuses a non-Steering approver (guardrail intact in LITE)
  p = await fresh();
  const nonSc = await infLead.put(`/api/v1/projects/${project.id}`).send({ stage: "EXECUTION", updated_at: p.updated_at });
  assert.equal(nonSc.status, 403);
  assert.match(nonSc.body.error, /Steering Committee/);

  // Steering approves with just the milestone — no deliverable, no risk register needed in LITE
  p = await fresh();
  const g2 = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "EXECUTION", updated_at: p.updated_at });
  assert.equal(g2.status, 200, JSON.stringify(g2.body));
});

test("LITE tail: skipping still refused; RUN without any GO_LIVE planned; close still needs discipline", async () => {
  // no skipping even in LITE
  let p = await fresh();
  const skip = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "RUN", updated_at: p.updated_at });
  assert.equal(skip.status, 400);
  assert.match(skip.body.error, /cannot move directly/);

  // critical roadblock still blocks DEPLOYMENT in LITE
  const rb = (await infLead.post(`/api/v1/projects/${project.id}/roadblocks`).send({
    title: "Toner supply contract lapsed", severity: "CRITICAL", description: "No consumables for new fleet",
  })).body.roadblock;
  p = await fresh();
  const blocked = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "DEPLOYMENT", updated_at: p.updated_at });
  assert.equal(blocked.status, 400);
  await infLead.put(`/api/v1/roadblocks/${rb.id}`).send({
    status: "RESOLVED", resolution_note: "Contract renewed for 24 months", updated_at: rb.updated_at,
  });
  p = await fresh();
  assert.equal((await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "DEPLOYMENT", updated_at: p.updated_at })).status, 200);

  // RUN in LITE: fine with NO go-live milestone planned…
  p = await fresh();
  assert.equal((await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "RUN", updated_at: p.updated_at })).status, 200);

  // …and CLOSED still demands an end date + all actions dispositioned
  const act = (await infLead.post(`/api/v1/projects/${project.id}/actions`).send({
    title: "Collect old printers", owner_user_id: F.U.contribSGO,
  })).body.action;
  p = await fresh();
  const open = await admin.put(`/api/v1/projects/${project.id}`).send({
    stage: "CLOSED", actual_end_date: "2026-09-20", updated_at: p.updated_at,
  });
  assert.equal(open.status, 400);
  await contribSGO.put(`/api/v1/actions/${act.id}`).send({ status: "DONE", updated_at: act.updated_at });
  p = await fresh();
  assert.equal((await admin.put(`/api/v1/projects/${project.id}`).send({
    stage: "CLOSED", actual_end_date: "2026-09-20", updated_at: p.updated_at,
  })).status, 200);
});

test("governance authority + checklist: PM cannot self-lighten; detail shows the next-gate requirements", async () => {
  // STANDARD project run by the SGO contributor as PM
  const std = (await infLead.post("/api/v1/projects").send({
    title: "Std governance project", lead_division_id: F.D.INF,
    project_manager_id: F.U.contribSGO, sites: [F.S.SGO],
  })).body.project;
  assert.equal(std.governance, "STANDARD");

  // PM (FULL access, but Contributor) cannot flip it to LITE
  const denied = await contribSGO.put(`/api/v1/projects/${std.id}`).send({
    governance: "LITE", updated_at: std.updated_at,
  });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /governance tier/);

  // Division Lead can
  const ok = await infLead.put(`/api/v1/projects/${std.id}`).send({
    governance: "LITE", updated_at: std.updated_at,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.governance, "LITE");

  // the detail response carries a next-gate checklist with met/unmet items
  const detail = await infLead.get(`/api/v1/projects/${std.id}`);
  assert.equal(detail.body.gate.next, "INITIATION");
  const labels = detail.body.gate.requirements.map((r) => r.label);
  assert.deepEqual(labels, ["Problem/opportunity described"], "LITE Gate 0 asks for the description only");
  assert.equal(detail.body.gate.requirements[0].met, false);

  // STANDARD project shows the full list
  const std2 = (await infLead.post("/api/v1/projects").send({
    title: "Full governance project", lead_division_id: F.D.INF,
  })).body.project;
  const d2 = await infLead.get(`/api/v1/projects/${std2.id}`);
  assert.equal(d2.body.gate.requirements.length, 3, "STANDARD Gate 0: description + sponsor + pillar");
});
