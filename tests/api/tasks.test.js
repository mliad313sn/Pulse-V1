"use strict";
// E07 API: workstreams, tasks, dependency cycle rejection, plan + critical path.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, infLead, contribSGO, viewer, project, ws;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [infLead, contribSGO, viewer] = await Promise.all([
    login(app, "inf@test.local"), login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Planned project", lead_division_id: F.D.INF,
    divisions: [{ division_id: F.D.OPS, role_in_project: "ENGAGED" }],
    sites: [F.S.SGO],
  })).body.project;
});
after(closePool);

test("workstreams: FULL creates; the workstream lead can edit theirs; viewer denied", async () => {
  const res = await infLead.post(`/api/v1/projects/${project.id}/workstreams`)
    .send({ title: "Network build", lead_user_id: F.U.contribSGO, start_date: "2026-09-01", end_date: "2026-11-30" });
  assert.equal(res.status, 201);
  ws = res.body.workstream;
  const denied = await viewer.post(`/api/v1/projects/${project.id}/workstreams`).send({ title: "nope" });
  assert.equal(denied.status, 403);
  // lead (a contributor without FULL access) can update their workstream
  const upd = await contribSGO.put(`/api/v1/workstreams/${ws.id}`)
    .send({ status: "IN_PROGRESS", updated_at: ws.updated_at });
  assert.equal(upd.status, 200);
  ws = upd.body.workstream;
});

test("tasks: create/assign/complete with notifications; cross-project workstream rejected", async () => {
  const t = await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Rack and stack", workstream_id: ws.id, owner_user_id: F.U.contribSGO,
    planned_start: "2026-09-01", planned_finish: "2026-09-05", estimated_hours: 24,
  });
  assert.equal(t.status, 201);
  // owner completes their own task
  const done = await contribSGO.put(`/api/v1/tasks/${t.body.task.id}`)
    .send({ status: "DONE", actual_hours: 30, updated_at: t.body.task.updated_at });
  assert.equal(done.status, 200);
  assert.ok(done.body.task.actual_finish, "actual finish stamped");
  // workstream from another project rejected
  const other = (await infLead.post("/api/v1/projects").send({ title: "Other", lead_division_id: F.D.INF })).body.project;
  const cross = await infLead.post(`/api/v1/projects/${other.id}/tasks`)
    .send({ title: "bad", workstream_id: ws.id });
  assert.equal(cross.status, 400);
});

test("dependencies: cycle rejected server-side; plan returns critical path", async () => {
  const mk = async (title, start, finish) =>
    (await infLead.post(`/api/v1/projects/${project.id}/tasks`)
      .send({ title, planned_start: start, planned_finish: finish })).body.task;
  const a = await mk("Design", "2026-09-01", "2026-09-05");   // 5d
  const b = await mk("Procure", "2026-09-06", "2026-09-10");  // 5d
  const c = await mk("Label", "2026-09-06", "2026-09-06");    // 1d
  const d = await mk("Install", "2026-09-11", "2026-09-12");  // 2d
  for (const [p, s] of [[a, b], [a, c], [b, d], [c, d]]) {
    const r = await infLead.post(`/api/v1/projects/${project.id}/dependencies`)
      .send({ predecessor_task_id: p.id, successor_task_id: s.id });
    assert.equal(r.status, 201);
  }
  // closing the loop is refused
  const cycle = await infLead.post(`/api/v1/projects/${project.id}/dependencies`)
    .send({ predecessor_task_id: d.id, successor_task_id: a.id });
  assert.equal(cycle.status, 400);
  assert.match(cycle.body.error, /cycle/i);
  // viewer cannot manage dependencies
  const noDep = await viewer.post(`/api/v1/projects/${project.id}/dependencies`)
    .send({ predecessor_task_id: a.id, successor_task_id: b.id });
  assert.equal(noDep.status, 403);

  const plan = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  assert.equal(plan.status, 200);
  assert.ok(plan.body.workstreams.length >= 1);
  const cp = plan.body.criticalPath;
  assert.ok(cp.criticalIds.includes(a.id) && cp.criticalIds.includes(b.id) && cp.criticalIds.includes(d.id),
    "long chain is critical");
  assert.ok(!cp.criticalIds.includes(c.id), "short branch not critical");
  assert.ok(cp.slack[c.id] > 0);
});
