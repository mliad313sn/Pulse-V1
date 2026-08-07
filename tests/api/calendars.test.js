"use strict";
// SPM Phase 2 (remainder) end to end: a project schedules against a working
// calendar, an Admin-declared holiday moves real dates, task date constraints
// are honoured and reported, and resource leveling surfaces double-bookings.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, admin, infLead, project, ws, taskA, taskB;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead] = await Promise.all([login(app, "admin@test.local"), login(app, "inf@test.local")]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Calendar-aware build", lead_division_id: F.D.INF, sites: [F.S.SGO],
    start_date: "2026-06-01",
  })).body.project;
  ws = (await infLead.post(`/api/v1/projects/${project.id}/workstreams`)
    .send({ title: "Build" })).body.workstream;
  taskA = (await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Rack and stack", workstream_id: ws.id,
    planned_start: "2026-06-01", planned_finish: "2026-06-03", owner_user_id: F.U.contribSGO,
  })).body.task;
  taskB = (await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Configure", workstream_id: ws.id,
    planned_start: "2026-06-04", planned_finish: "2026-06-05", owner_user_id: F.U.contribSGO,
  })).body.task;
  const dep = await infLead.post(`/api/v1/projects/${project.id}/dependencies`)
    .send({ predecessor_task_id: taskA.id, successor_task_id: taskB.id, dep_type: "FS", lag_days: 0 });
  assert.equal(dep.status, 201, "the FS link the whole suite depends on was created");
});
after(closePool);

test("P2 calendars: the default Mon–Fri calendar drives real dates in the plan", async () => {
  const cals = await infLead.get("/api/v1/calendars");
  assert.equal(cals.status, 200);
  const std = cals.body.calendars.find((c) => c.is_default);
  assert.ok(std, "a default calendar ships with the deployment");
  assert.deepEqual(std.working_days, [1, 2, 3, 4, 5]);

  const plan = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  assert.equal(plan.status, 200);
  assert.equal(plan.body.criticalPath.calendarApplied, true);
  assert.equal(plan.body.calendar.name, std.name);
  // A runs Mon–Wed, so B starts Thursday and finishes Friday
  const b = plan.body.criticalPath.dates[taskB.id];
  assert.equal(b.earlyStart, "2026-06-04");
  assert.equal(b.earlyFinish, "2026-06-05");
});

test("P2 a declared holiday is Admin-only and pushes dependent work later", async () => {
  const cals = await infLead.get("/api/v1/calendars");
  const std = cals.body.calendars.find((c) => c.is_default);

  const denied = await infLead.post(`/api/v1/calendars/${std.id}/exceptions`)
    .send({ exception_date: "2026-06-02", note: "not my call" });
  assert.equal(denied.status, 403, "calendars are reference data — a lead cannot move everyone's dates");

  const ok = await admin.post(`/api/v1/calendars/${std.id}/exceptions`)
    .send({ exception_date: "2026-06-02", working: false, note: "National holiday" });
  assert.equal(ok.status, 201);

  const plan = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  const b = plan.body.criticalPath.dates[taskB.id];
  // A keeps its three days of work; with Tuesday off they run Mon/Wed/Thu, so
  // B starts Friday and its second day falls after the weekend, on Monday.
  assert.equal(b.earlyStart, "2026-06-05");
  assert.equal(b.earlyFinish, "2026-06-08", "the weekend is skipped, never consumed as working time");

  // removing it restores the original schedule — nothing is destroyed
  await admin.delete(`/api/v1/calendars/${std.id}/exceptions/2026-06-02`);
  const back = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  assert.equal(back.body.criticalPath.dates[taskB.id].earlyFinish, "2026-06-05");
});

test("P2 date constraints: a deadline that cannot be met is reported with negative float", async () => {
  const fresh = (await infLead.get(`/api/v1/projects/${project.id}/plan`)).body.tasks
    .find((t) => t.id === taskB.id);
  const res = await infLead.put(`/api/v1/tasks/${taskB.id}`).send({
    constraint_type: "FINISH_NO_LATER_THAN", constraint_date: "2026-06-02",
    updated_at: fresh.updated_at,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.constraint_type, "FINISH_NO_LATER_THAN");

  const plan = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  assert.ok(plan.body.criticalPath.slack[taskB.id] < 0, "an impossible deadline shows as negative float");
  assert.equal(plan.body.criticalPath.dates[taskB.id].behindDeadline, true);
  assert.ok(plan.body.criticalPath.violations.some((v) => v.task_id === taskB.id),
    "the violation is named, not buried");
});

test("P2 resource leveling reports the double-booking without moving anyone's dates", async () => {
  // a third task for the same person, overlapping task A
  const clash = (await infLead.post(`/api/v1/projects/${project.id}/tasks`).send({
    title: "Parallel survey", workstream_id: ws.id, owner_user_id: F.U.contribSGO,
    planned_start: "2026-06-01", planned_finish: "2026-06-02",
  })).body.task;

  const plan = await infLead.get(`/api/v1/projects/${project.id}/plan`);
  assert.ok(plan.body.leveling, "the plan carries leveling analysis");
  const conflict = plan.body.leveling.conflicts.find((c) =>
    c.tasks.includes(clash.id) && c.tasks.includes(taskA.id));
  assert.ok(conflict, "the overlapping assignment is found");
  assert.ok(conflict.overlap_days > 0);
  assert.ok(conflict.suggestion.length > 0, "and it says what to do about it");
  assert.match(plan.body.leveling.note, /never moves/);

  // the dates themselves are untouched — leveling proposes only
  const after_ = (await infLead.get(`/api/v1/projects/${project.id}/plan`)).body.tasks
    .find((t) => t.id === clash.id);
  assert.equal(String(after_.planned_start).slice(0, 10), "2026-06-01");
});
