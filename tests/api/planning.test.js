"use strict";
// SPM Phase 2 — WBS summaries, plan baselines/variance, schedule quality
// checks, cross-project dependencies with concealment-safe blast radius.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, admin, infLead, viewer, project, phase, t1, t2;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Datacentre refresh", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
});
after(closePool);

test("P2 WBS: summary parent rolls up children; loops refused; quality checks find real problems", async () => {
  phase = (await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Phase 1 — build",
  })).body.task;
  t1 = (await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Rack and stack", parent_task_id: phase.id,
    planned_start: "2026-09-01", planned_finish: "2026-09-10", estimated_hours: 60,
  })).body.task;
  t2 = (await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Cabling", parent_task_id: phase.id,
    planned_start: "2026-09-05", planned_finish: "2026-09-20", estimated_hours: 40,
  })).body.task;
  await infLead.post(`/api/v1/projects/${project.id}/dependencies`).send({
    predecessor_task_id: t1.id, successor_task_id: t2.id, dep_type: "SS", lag_days: 4,
  });

  // parent loop refused
  const loop = await infLead.put(`/api/v1/tasks/${phase.id}`).send({
    parent_task_id: t1.id, updated_at: phase.updated_at,
  });
  assert.equal(loop.status, 400);
  assert.match(loop.body.error, /loop/i);

  const plan = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  const roll = plan.body.summaries[phase.id];
  assert.equal(String(roll.computed_start).slice(0, 10), "2026-09-01");
  assert.equal(String(roll.computed_finish).slice(0, 10), "2026-09-20");
  assert.equal(roll.effort_hours, 100);
  assert.equal(roll.remaining_hours, 100, "remaining defaults to estimate");

  // quality: the summary task itself has no dates -> flagged; no orphans (t1-t2 linked)
  const checks = plan.body.quality;
  assert.ok(checks.some((c) => c.task_id === phase.id && c.check === "missing_dates"));
  assert.ok(!checks.some((c) => c.check === "orphan" && [t1.id, t2.id].includes(c.task_id)));
});

test("P2 baselines: snapshot, slip a task, variance explains the movement in days", async () => {
  assert.equal((await viewer.post(`/api/v1/projects/${project.id}/plan/baseline`).send({})).status, 403);
  const bl = await infLead.post(`/api/v1/projects/${project.id}/plan/baseline`).send({ label: "Committed plan" });
  assert.equal(bl.status, 201);
  assert.equal(bl.body.baseline.version, 1);

  const cur = (await infLead.get(`/api/v1/projects/${project.id}/plan`)).body.tasks
    .find((t) => t.id === t2.id);
  await infLead.put(`/api/v1/tasks/${t2.id}`).send({
    planned_finish: "2026-09-27", updated_at: cur.updated_at,
  });

  const varRes = await infLead.get(`/api/v1/projects/${project.id}/plan/variance`);
  assert.equal(varRes.body.baseline.version, 1);
  const slip = varRes.body.variances.find((v) => v.task_id === t2.id);
  assert.equal(slip.change, "slipped");
  assert.equal(slip.days, 7);
  assert.match(slip.detail, /\+7d/);
});

test("P2 blast radius: downstream projects with depth; concealed ones counted, never named", async () => {
  const mid = (await infLead.post("/api/v1/projects").send({
    title: "ERP interface upgrade", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Confidential downstream", lead_division_id: F.D.INF, confidential: true,
  })).body.project;

  // mid depends on project; secret depends on mid
  assert.equal((await infLead.post(`/api/v1/projects/${mid.id}/depends-on/${project.id}`).send({
    note: "needs the new DC capacity",
  })).status, 201);
  assert.equal((await admin.post(`/api/v1/projects/${secret.id}/depends-on/${mid.id}`).send({})).status, 201);
  assert.equal((await infLead.post(`/api/v1/projects/${mid.id}/depends-on/${mid.id}`).send({})).status, 400,
    "self-dependency refused");

  // admin sees both downstream projects with depths
  const adminBlast = await admin.get(`/api/v1/projects/${project.id}/blast-radius`);
  assert.equal(adminBlast.body.total, 2);
  const byId = Object.fromEntries(adminBlast.body.affected.map((a) => [a.id, a.depth]));
  assert.equal(byId[mid.id], 1);
  assert.equal(byId[secret.id], 2);

  // viewer: confidential downstream is COUNTED but never named
  const viewerBlast = await viewer.get(`/api/v1/projects/${project.id}/blast-radius`);
  assert.equal(viewerBlast.body.total, 2);
  assert.equal(viewerBlast.body.concealedCount, 1);
  assert.ok(!JSON.stringify(viewerBlast.body).includes("Confidential downstream"));
});
