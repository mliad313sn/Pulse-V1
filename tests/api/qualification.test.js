"use strict";
// E30 — release qualification for the journeys not already carried by other
// suites: RA-02/RA-12 (full lifecycle tail EXECUTION→DEPLOYMENT→RUN→CLOSED
// with readiness checklist and GO_LIVE gate) and RA-16 (scheduled report
// dispatch with per-recipient scope and idempotent logging).
// The full RA-01…RA-20 evidence map lives in docs/execution/RELEASE_QUALIFICATION.md.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const { runWeeklyDigest, isoWeek } = require("../../src/jobs/reportDispatch");

let app, F, admin, infLead, viewer, project;

const fresh = async () => (await admin.get(`/api/v1/projects/${project.id}`)).body.project;

before(async () => {
  await initDb();
  F = await fixtures();
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  app = createApp();
  [admin, infLead, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "viewer@test.local"),
  ]);
});
after(closePool);

test("RA-02/RA-12: EXECUTION→DEPLOYMENT→RUN→CLOSED with roadblock, readiness and GO_LIVE gates", async () => {
  // Build a project already at EXECUTION via the real gates (no shortcuts).
  project = (await infLead.post("/api/v1/projects").send({
    title: "MGO ERP cutover", lead_division_id: F.D.INF, sites: [F.S.MGO],
  })).body.project;
  let p = await fresh();
  await infLead.put(`/api/v1/projects/${project.id}`).send({
    stage: "INITIATION", description: "ERP rollout to MGO", sponsor: "CIO",
    roadmap_pillar: "BizPartnering", updated_at: p.updated_at,
  });
  p = await fresh();
  await infLead.put(`/api/v1/projects/${project.id}`).send({
    stage: "PLANNING", project_manager_id: F.U.infLead, target_date: "2026-11-30", updated_at: p.updated_at,
  });
  const readinessMs = (await infLead.post(`/api/v1/projects/${project.id}/milestones`).send({
    title: "MGO site readiness", type: "SITE_READINESS", due_date: "2026-10-15",
  })).body.milestone;
  const goLive = (await infLead.post(`/api/v1/projects/${project.id}/milestones`).send({
    title: "Go-live MGO", type: "GO_LIVE", due_date: "2026-11-01",
  })).body.milestone;
  await infLead.post(`/api/v1/projects/${project.id}/deliverables`).send({ title: "Cutover runbook" });
  await infLead.post(`/api/v1/projects/${project.id}/risks`).send({ title: "Data migration slip", probability: 3, impact: 4 });
  p = await fresh();
  const g2 = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "EXECUTION", updated_at: p.updated_at });
  assert.equal(g2.status, 200);

  // Gate 3: open CRITICAL roadblock blocks DEPLOYMENT
  const rb = (await infLead.post(`/api/v1/projects/${project.id}/roadblocks`).send({
    title: "Interface freeze broken", severity: "CRITICAL", description: "Vendor pushed unplanned change",
  })).body.roadblock;
  p = await fresh();
  const blocked = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "DEPLOYMENT", updated_at: p.updated_at });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /CRITICAL roadblock/);
  await infLead.put(`/api/v1/roadblocks/${rb.id}`).send({
    status: "RESOLVED", resolution_note: "Change rolled back by vendor", updated_at: rb.updated_at,
  });
  p = await fresh();
  const g3 = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "DEPLOYMENT", updated_at: p.updated_at });
  assert.equal(g3.status, 200);

  // RA-12: readiness checklist is real — check every item on the readiness milestone
  const detail = (await infLead.get(`/api/v1/projects/${project.id}`)).body;
  const readiness = detail.milestones.find((m) => m.id === readinessMs.id).readiness;
  assert.ok(readiness.length >= 3, "SITE_READINESS milestone carries a checklist");
  for (const item of readiness) {
    assert.equal((await infLead.put(`/api/v1/readiness/${item.id}`).send({ checked: true })).status, 200);
  }

  // Gate 4: RUN requires the GO_LIVE milestone DONE
  p = await fresh();
  const noGo = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "RUN", updated_at: p.updated_at });
  assert.equal(noGo.status, 400);
  assert.match(noGo.body.error, /GO_LIVE/);
  const glRow = (await infLead.get(`/api/v1/projects/${project.id}`)).body.milestones.find((m) => m.id === goLive.id);
  await infLead.put(`/api/v1/milestones/${goLive.id}`).send({ status: "DONE", updated_at: glRow.updated_at });
  p = await fresh();
  const g4 = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "RUN", updated_at: p.updated_at });
  assert.equal(g4.status, 200);

  // Gate 5: CLOSED needs actual end date + no OPEN actions
  const act = (await infLead.post(`/api/v1/projects/${project.id}/actions`).send({
    title: "Hypercare log review", owner_user_id: F.U.infLead,
  })).body.action;
  p = await fresh();
  const stillOpen = await admin.put(`/api/v1/projects/${project.id}`).send({
    stage: "CLOSED", actual_end_date: "2026-11-05", updated_at: p.updated_at,
  });
  assert.equal(stillOpen.status, 400);
  assert.match(stillOpen.body.error, /actions/i);
  await infLead.put(`/api/v1/actions/${act.id}`).send({ status: "DONE", updated_at: act.updated_at });
  p = await fresh();
  const g5 = await admin.put(`/api/v1/projects/${project.id}`).send({
    stage: "CLOSED", actual_end_date: "2026-11-05", updated_at: p.updated_at,
  });
  assert.equal(g5.status, 200);
  assert.equal(g5.body.project.operating_status, "COMPLETED", "closing completes the project");

  // full ledger from IDEA to CLOSED
  const ledger = await query(
    `SELECT from_stage, to_stage FROM stage_transitions WHERE project_id = $1 ORDER BY id`, [project.id]);
  assert.deepEqual(ledger.rows.map((r) => `${r.from_stage}>${r.to_stage}`), [
    "IDEA>INITIATION", "INITIATION>PLANNING", "PLANNING>EXECUTION",
    "EXECUTION>DEPLOYMENT", "DEPLOYMENT>RUN", "RUN>CLOSED",
  ]);
});

test("RA-16: scheduled digest — per-recipient scope, idempotent per period, result logged", async () => {
  // confidential project the viewer must never see counted
  await admin.post("/api/v1/projects").send({
    title: "Quiet acquisition IT", lead_division_id: F.D.INF, confidential: true,
  });
  const now = new Date("2026-08-10T06:00:00Z");
  const sent1 = await runWeeklyDigest(now);
  assert.ok(sent1 >= 4, "all active users get a digest");
  const sent2 = await runWeeklyDigest(now);
  assert.equal(sent2, 0, "same period never dispatches twice");

  const period = isoWeek(now);
  const { rows: log } = await query(
    `SELECT u.email, l.summary FROM report_dispatch_log l JOIN users u ON u.id = l.user_id
      WHERE l.report_key = 'PORTFOLIO_WEEKLY' AND l.period = $1`, [period]);
  const byEmail = Object.fromEntries(log.map((r) => [r.email, r.summary]));
  const count = (s) => Number(/(\d+) projects/.exec(s)[1]);
  assert.ok(count(byEmail["admin@test.local"]) === count(byEmail["viewer@test.local"]) + 1,
    "viewer's digest excludes exactly the confidential project");

  // and the digest reached the notification stream
  const notif = await query(
    `SELECT count(*)::int AS n FROM notifications WHERE type = 'REPORT'`);
  assert.equal(notif.rows[0].n, sent1, "every dispatch logged as a notification");
});
