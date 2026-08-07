"use strict";
// SPM Phase 8 — Meeting Mode 2.0: a decision captured live in a meeting
// converts into a governed change request. Conversion proposes (CR stays
// PENDING for Steering), carries the meeting evidence in its rationale,
// records the link on the decision, and can never happen twice.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, project, meeting, decision;

const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Meeting mode target", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  meeting = (await admin.post("/api/v1/meetings").send({
    title: "October Steering", date: today(), type: "PROJECT_REVIEW", attendees: [F.U.admin],
  })).body.meeting;
  await admin.post(`/api/v1/meetings/${meeting.id}/start`);
  decision = (await admin.post(`/api/v1/meetings/${meeting.id}/capture`).send({
    kind: "decision", project_id: project.id,
    text: "Slip go-live by one month to align with mine shutdown window",
    decided_by: "Steering Committee",
  })).body.created;
});
after(closePool);

test("P8 conversion: captured decision becomes a PENDING change request with meeting evidence", async () => {
  // a contributor who is neither organizer, Admin nor Steering cannot convert
  const denied = await contribSGO
    .post(`/api/v1/meetings/${meeting.id}/decisions/${decision.id}/convert-to-cr`)
    .send({ type: "SCHEDULE" });
  assert.equal(denied.status, 403);

  const res = await admin
    .post(`/api/v1/meetings/${meeting.id}/decisions/${decision.id}/convert-to-cr`)
    .send({ type: "SCHEDULE", schedule_impact_days: 30 });
  assert.equal(res.status, 201);
  const cr = res.body.changeRequest;
  assert.equal(cr.status, "PENDING", "conversion proposes — Steering still decides the CR");
  assert.equal(cr.type, "SCHEDULE");
  assert.equal(cr.schedule_impact_days, 30);
  assert.match(cr.rationale, /Decision captured in meeting "October Steering"/);
  assert.match(cr.rationale, /Slip go-live by one month/);
  assert.match(cr.rationale, /decided by Steering Committee/);

  // the link is recorded on the decision (meeting evidence → change control)
  const { rows } = await query(`SELECT change_request_id FROM decisions WHERE id = $1`, [decision.id]);
  assert.equal(Number(rows[0].change_request_id), cr.id);

  // project itself untouched until the CR is approved through change control
  const fresh = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  assert.equal(fresh.stage, "IDEA");
});

test("P8 conversion is once-only and validates decision/meeting pairing", async () => {
  const again = await admin
    .post(`/api/v1/meetings/${meeting.id}/decisions/${decision.id}/convert-to-cr`)
    .send({ type: "SCHEDULE" });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /Already converted/);

  const wrongMeeting = await admin.post("/api/v1/meetings")
    .send({ title: "Other meeting", date: today(), type: "ADHOC" });
  const cross = await admin
    .post(`/api/v1/meetings/${wrongMeeting.body.meeting.id}/decisions/${decision.id}/convert-to-cr`)
    .send({ type: "SCHEDULE" });
  assert.equal(cross.status, 404, "a decision only converts from its own meeting");
});
