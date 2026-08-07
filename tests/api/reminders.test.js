"use strict";
// E21: reminder engine — thresholds, idempotency, T+7 PM escalation, hold exclusion.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const { runReminders } = require("../../src/jobs/reminders");

let app, F, infLead, contribSGO, project;
const shift = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [infLead, contribSGO] = await Promise.all([login(app, "inf@test.local"), login(app, "awa@test.local")]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Reminded project", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.infLead,
  })).body.project;
});
after(closePool);

test("thresholds fire once each; rerun sends nothing; T+7 escalates to the PM", async () => {
  // action due in 7 days (T-7), action due today (T0), action overdue 7 days (T+7)
  await infLead.post(`/api/v1/projects/${project.id}/actions`)
    .send({ title: "Upcoming action", owner_user_id: F.U.contribSGO, due_date: shift(7) });
  await infLead.post(`/api/v1/projects/${project.id}/actions`)
    .send({ title: "Due today action", owner_user_id: F.U.contribSGO, due_date: shift(0) });
  await infLead.post(`/api/v1/projects/${project.id}/actions`)
    .send({ title: "Week-overdue action", owner_user_id: F.U.contribSGO, due_date: shift(-7) });
  // milestone due in 2 days (T-2)
  await infLead.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Urgent milestone", owner_user_id: F.U.contribSGO, due_date: shift(2) });

  const first = await runReminders();
  assert.ok(first >= 5, `expected >=5 reminders (4 owner + 1 PM escalation), got ${first}`);
  const again = await runReminders();
  assert.equal(again, 0, "idempotent rerun sends nothing");

  const owner = await contribSGO.get("/api/v1/notifications?limit=50");
  const reminders = owner.body.notifications.filter((n) => n.type === "REMINDER");
  assert.ok(reminders.some((n) => /Upcoming action.*due in 7 days/.test(n.text)));
  assert.ok(reminders.some((n) => /Due today action.*due today/.test(n.text)));
  assert.ok(reminders.some((n) => /Urgent milestone.*due in 2 days/.test(n.text)));
  assert.ok(reminders.some((n) => /Week-overdue action.*overdue for a week/.test(n.text)));
  // PM (infLead) got the escalation copy
  const pm = await infLead.get("/api/v1/notifications?limit=50");
  assert.ok(pm.body.notifications.some((n) => n.type === "REMINDER" && /^Escalation:/.test(n.text)));
});

test("on-hold projects are excluded from reminders", async () => {
  const held = (await infLead.post("/api/v1/projects").send({
    title: "Held project", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  await infLead.post(`/api/v1/projects/${held.id}/actions`)
    .send({ title: "Held action", owner_user_id: F.U.contribSGO, due_date: shift(0) });
  const cur = (await infLead.get(`/api/v1/projects/${held.id}`)).body.project;
  await infLead.put(`/api/v1/projects/${held.id}`).send({
    operating_status: "ON_HOLD", hold_reason: "Paused for budget review", updated_at: cur.updated_at,
  });
  await runReminders();
  const owner = await contribSGO.get("/api/v1/notifications?limit=100");
  assert.ok(!owner.body.notifications.some((n) => n.type === "REMINDER" && /Held action/.test(n.text)), "no reminder for held project");
});
