"use strict";
// SPM Phase 4 (remainder) — benefit realization: value measured period by
// period against the BASELINE (not from zero), decreasing targets handled,
// missing measurements named rather than averaged away, and observation that
// deliberately continues AFTER the project closes.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const { realization, realizedFraction } = require("../../src/modules/finance/realization");

let app, F, admin, infLead, project, benefit;

before(async () => {
  await initDb();
  F = await fixtures();
  // the execution gate requires Steering authority — grant it to the admin fixture
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  app = createApp();
  [admin, infLead] = await Promise.all([login(app, "admin@test.local"), login(app, "inf@test.local")]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Incident reduction programme", lead_division_id: F.D.INF, sites: [F.S.SGO],
    description: "Halve network incidents at the mine site",
  })).body.project;
});
after(closePool);

test("P4 realization maths: measured against the baseline, decreasing targets handled", () => {
  // 40 incidents down to 25: reaching 25 is 100% realized, not 62%
  assert.equal(realizedFraction(40, 25, 25), 1);
  assert.equal(realizedFraction(40, 25, 40), 0);
  assert.equal(Math.round(realizedFraction(40, 25, 32.5) * 100), 50);
  assert.equal(realizedFraction(40, 25, 10), 1, "overshoot clamps at 100%");
  assert.equal(realizedFraction(40, 40, 30), null, "no promised movement means no percentage");

  // increasing targets work identically
  assert.equal(realizedFraction(60, 90, 75), 0.5);
});

test("P4 realization curve names missing periods instead of averaging them away", () => {
  const b = {
    baseline: 40, target: 25, unit: "incidents", measurement_frequency: "MONTHLY",
    realization_start: "2026-01", realization_end: "2026-04",
  };
  const r = realization(b, [
    { period: "2026-01", actual: 38, post_closure: false },
    { period: "2026-03", actual: 30, post_closure: false },
  ], { today: "2026-05-15" });

  assert.equal(r.periods.length, 4);
  assert.deepEqual(r.missing_periods, ["2026-02", "2026-04"]);
  assert.equal(r.latest.period, "2026-03");
  assert.equal(r.realized_pct, 67);
  assert.equal(r.status, "ON_TRACK");
  assert.match(r.explanation, /2 due period\(s\) never measured/);
});

test("P4 measurements are recorded per period and drive an explained curve", async () => {
  benefit = (await infLead.post(`/api/v1/projects/${project.id}/benefits`).send({
    title: "Fewer network incidents", baseline: 40, target: 25, unit: "incidents/month",
    realization_start: "2026-01-01", realization_end: "2026-06-30",
    measurement_frequency: "MONTHLY", owner_user_id: F.U.contribSGO,
  })).body.benefit;
  assert.equal(benefit.measurement_frequency, "MONTHLY");

  for (const [period, actual] of [["2026-01", 38], ["2026-02", 34], ["2026-03", 29]]) {
    const res = await infLead.post(`/api/v1/benefits/${benefit.id}/measurements`)
      .send({ period, actual, note: `Service desk export for ${period}` });
    assert.equal(res.status, 201);
    assert.equal(res.body.measurement.post_closure, false);
  }

  const r = await infLead.get(`/api/v1/benefits/${benefit.id}/realization`);
  assert.equal(r.status, 200);
  assert.equal(r.body.measured_periods, 3);
  assert.equal(r.body.latest.period, "2026-03");
  assert.equal(r.body.latest.realized_pct, 73, "40 → 29 of a promised 40 → 25");
  assert.match(r.body.explanation, /Latest 2026-03: 29 incidents\/month/);

  // correcting a period updates rather than duplicating
  await infLead.post(`/api/v1/benefits/${benefit.id}/measurements`)
    .send({ period: "2026-03", actual: 27, note: "Corrected after reconciliation" });
  const fixed = await infLead.get(`/api/v1/benefits/${benefit.id}/realization`);
  assert.equal(fixed.body.measured_periods, 3, "a correction is not a second measurement");
  assert.equal(fixed.body.latest.actual, 27);

  // the benefit owner can record even without full project rights
  const owner = await login(app, "awa@test.local");
  const byOwner = await owner.post(`/api/v1/benefits/${benefit.id}/measurements`)
    .send({ period: "2026-04", actual: 26 });
  assert.equal(byOwner.status, 201);
});

test("P4 observation continues after the project closes, and is flagged as post-closure", async () => {
  // Walk the project through its real gates — the evidence each one requires is
  // supplied rather than bypassed, so this also proves the lifecycle still holds.
  await admin.put(`/api/v1/projects/${project.id}`).send({
    project_manager_id: F.U.contribSGO, target_date: "2026-12-31",
    updated_at: (await admin.get(`/api/v1/projects/${project.id}`)).body.project.updated_at,
  });
  const goLive = (await admin.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Go live", type: "GO_LIVE", due_date: "2026-06-30" })).body.milestone;
  await admin.post(`/api/v1/projects/${project.id}/deliverables`).send({ title: "Runbook" });
  await admin.post(`/api/v1/projects/${project.id}/risks`)
    .send({ title: "Adoption risk", probability: 2, impact: 2 });

  let p = (await admin.get(`/api/v1/projects/${project.id}`)).body.project;
  const advance = async (stage) => {
    const res = await admin.put(`/api/v1/projects/${project.id}`)
      .send({ stage, sponsor: "CIO", roadmap_pillar: "Network", updated_at: p.updated_at });
    assert.equal(res.status, 200, `advancing to ${stage}: ${JSON.stringify(res.body)}`);
    p = res.body.project;
  };
  await advance("INITIATION");
  await advance("PLANNING");
  await advance("EXECUTION");
  await advance("DEPLOYMENT");
  // go-live must actually be done before the project can run
  const ms = (await admin.get(`/api/v1/projects/${project.id}`)).body.milestones
    .find((m) => m.id === goLive.id);
  await admin.put(`/api/v1/milestones/${goLive.id}`)
    .send({ status: "DONE", updated_at: ms.updated_at });
  p = (await admin.get(`/api/v1/projects/${project.id}`)).body.project;
  await advance("RUN");
  // closure requires the actual end date on the record — supply it, don't skip it
  const withEnd = await admin.put(`/api/v1/projects/${project.id}`)
    .send({ actual_end_date: "2026-06-30", updated_at: p.updated_at });
  assert.equal(withEnd.status, 200);
  p = withEnd.body.project;
  await advance("CLOSED");
  assert.equal(p.stage, "CLOSED", "the project genuinely reached CLOSED through its gates");

  const late = await admin.post(`/api/v1/benefits/${benefit.id}/measurements`)
    .send({ period: "2026-09", actual: 24, note: "Six months after handover — value held" });
  assert.equal(late.status, 201, "a closed project must not stop benefit observation");
  assert.equal(late.body.measurement.post_closure, true, "and it is marked as post-closure evidence");

  const r = await admin.get(`/api/v1/benefits/${benefit.id}/realization`);
  assert.equal(r.body.post_closure_observations, 1);
  assert.equal(r.body.status, "REALIZED");
  assert.match(r.body.explanation, /1 observation\(s\) recorded after project closure/);

  const summary = await admin.get(`/api/v1/projects/${project.id}/benefits/realization`);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.tracked, 1);
  assert.equal(summary.body.measured, 1);
  assert.ok(summary.body.average_realized_pct >= 100);
});

test("P4 concealment: benefit realization on a confidential project is not readable", async () => {
  const viewer = await login(app, "viewer@test.local");
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Secret benefit", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
  const hidden = (await admin.post(`/api/v1/projects/${secret.id}/benefits`)
    .send({ title: "Classified saving", baseline: 100, target: 50 })).body.benefit;

  assert.equal((await viewer.get(`/api/v1/benefits/${hidden.id}/realization`)).status, 404);
  assert.equal((await viewer.post(`/api/v1/benefits/${hidden.id}/measurements`)
    .send({ period: "2026-01", actual: 60 })).status, 404);
});
