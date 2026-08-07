"use strict";
// EPIC E11 gates: risk register (scored, permission-checked), CAPA lifecycle with
// verified closure, roadblock reopen control, agenda rules 7-8, channel adapters.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, viewer, project;

const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const daysAhead = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Risk-bearing project", lead_division_id: F.D.INF,
    divisions: [{ division_id: F.D.OPS, role_in_project: "ENGAGED" }],
    sites: [F.S.SGO],
  })).body.project;
});
after(closePool);

test("risks: create with computed score, viewer denied, owner-scoped edit", async () => {
  const r = await infLead.post(`/api/v1/projects/${project.id}/risks`).send({
    title: "Vendor insolvency", category: "VENDOR", probability: 4, impact: 5,
    treatment: "MITIGATE", owner_user_id: F.U.contribSGO, target_date: daysAhead(30),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.risk.score, 20, "score = probability × impact, DB-computed");
  // viewer cannot raise or edit
  const v = await viewer.post(`/api/v1/projects/${project.id}/risks`).send({ title: "x", probability: 1, impact: 1 });
  assert.equal(v.status, 403);
  // the owning contributor can update their risk (residual scoring)
  const upd = await contribSGO.put(`/api/v1/risks/${r.body.risk.id}`).send({
    residual_probability: 2, residual_impact: 3, status: "MITIGATING", updated_at: r.body.risk.updated_at,
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.risk.status, "MITIGATING");
  // invalid probability rejected by validation
  const bad = await infLead.post(`/api/v1/projects/${project.id}/risks`).send({ title: "x", probability: 9, impact: 1 });
  assert.equal(bad.status, 400);
});

test("CAPA: roadblock-sourced creation, stepwise lifecycle, closure requires verified effectiveness", async () => {
  const rb = (await infLead.post(`/api/v1/projects/${project.id}/roadblocks`)
    .send({ title: "Recurring fibre cuts", severity: "MAJOR", owner_user_id: F.U.contribSGO })).body.roadblock;
  const c = await infLead.post(`/api/v1/projects/${project.id}/capas`).send({
    issue: "Fibre route repeatedly damaged by earthworks", roadblock_id: rb.id,
    owner_user_id: F.U.contribSGO, verifier_user_id: F.U.infLead, due_date: daysAhead(20),
  });
  assert.equal(c.status, 201);
  assert.equal(c.body.capa.source_type, "ROADBLOCK");
  let capa = c.body.capa;
  // cannot jump OPEN -> CLOSED
  const jump = await infLead.put(`/api/v1/capas/${capa.id}`).send({ status: "CLOSED", updated_at: capa.updated_at });
  assert.equal(jump.status, 400);
  assert.match(jump.body.error, /cannot jump/);
  // walk the lifecycle
  for (const status of ["ANALYSIS", "ACTION_PLANNED", "IMPLEMENTATION", "VERIFICATION"]) {
    const res = await infLead.put(`/api/v1/capas/${capa.id}`).send({ status, updated_at: capa.updated_at });
    assert.equal(res.status, 200, `${status}: ${JSON.stringify(res.body)}`);
    capa = res.body.capa;
  }
  // closing without effectiveness refused
  const noEff = await infLead.put(`/api/v1/capas/${capa.id}`).send({ status: "CLOSED", updated_at: capa.updated_at });
  assert.equal(noEff.status, 400);
  assert.match(noEff.body.error, /effectiveness/);
  const closed = await infLead.put(`/api/v1/capas/${capa.id}`)
    .send({ status: "CLOSED", effectiveness: "EFFECTIVE", updated_at: capa.updated_at });
  assert.equal(closed.status, 200);
  assert.ok(closed.body.capa.verification_date, "verification date stamped");
  // CAPA linked from wrong project rejected
  const other = (await infLead.post("/api/v1/projects").send({ title: "Other", lead_division_id: F.D.INF })).body.project;
  const cross = await infLead.post(`/api/v1/projects/${other.id}/capas`)
    .send({ issue: "cross-link", roadblock_id: rb.id });
  assert.equal(cross.status, 400);
});

test("roadblock reopen: resolved cannot be escalated, reopen requires a reason, then escalation works", async () => {
  const rb = (await infLead.post(`/api/v1/projects/${project.id}/roadblocks`)
    .send({ title: "Transient issue", severity: "MINOR", owner_user_id: F.U.infLead })).body.roadblock;
  const resolved = await infLead.put(`/api/v1/roadblocks/${rb.id}`)
    .send({ status: "RESOLVED", resolution_note: "fixed", updated_at: rb.updated_at });
  assert.equal(resolved.status, 200);
  // escalation of resolved refused (existing invariant)
  const esc = await infLead.post(`/api/v1/roadblocks/${rb.id}/escalate`);
  assert.equal(esc.status, 400);
  // reopen without reason refused
  const noReason = await infLead.post(`/api/v1/roadblocks/${rb.id}/reopen`).send({ reason: "short" });
  assert.equal(noReason.status, 400);
  const reopened = await infLead.post(`/api/v1/roadblocks/${rb.id}/reopen`)
    .send({ reason: "Issue recurred after 48 hours of operation" });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.roadblock.status, "OPEN");
  // now escalation is possible again
  const esc2 = await infLead.post(`/api/v1/roadblocks/${rb.id}/escalate`);
  assert.equal(esc2.status, 200);
});

test("agenda rules 7-8: gate-awaiting and overdue-CAPA projects surface on the auto-agenda", async () => {
  // a DESIGN project with a milestone = waiting on the Steering gate
  const gated = (await infLead.post("/api/v1/projects").send({
    title: "Awaiting steering", lead_division_id: F.D.INF, stage: "PLANNING",
    description: "d", sponsor: "s", target_date: daysAhead(60),
  })).body.project;
  await infLead.post(`/api/v1/projects/${gated.id}/milestones`).send({ title: "Plan baseline", due_date: daysAhead(30) });
  // an overdue CAPA on the main project
  await infLead.post(`/api/v1/projects/${project.id}/capas`)
    .send({ issue: "Overdue containment", due_date: daysAgo(3), owner_user_id: F.U.infLead });
  const mt = (await admin.post("/api/v1/meetings")
    .send({ title: "Governance sync", date: daysAhead(1), type: "PROJECT_REVIEW" })).body.meeting;
  const detail = await admin.get(`/api/v1/meetings/${mt.id}`);
  const reasons = detail.body.items.map((i) => i.reason);
  assert.ok(reasons.includes("Gate awaiting Steering approval"), `rule 7 present in ${reasons}`);
  assert.ok(reasons.includes("Overdue CAPA") || detail.body.items.some((i) => (i.notes || "").includes("Overdue containment")),
    `rule 8 present in ${reasons}`);
});

test("notification channels: sink adapter captures deliveries; Teams adapter contract verified", async () => {
  // in-app notifications dispatched earlier in this suite → sink captures rows
  await new Promise((r) => setTimeout(r, 900)); // allow fire-and-forget dispatch (incl. commit-race retry) to land
  const { rows } = await query(`SELECT count(*)::int AS n FROM notification_deliveries WHERE channel = 'SINK' AND status = 'CAPTURED'`);
  assert.ok(rows[0].n >= 1, "sink captured at least one delivery");
  // Teams adapter posts the documented payload shape (injected fetch, no real webhook)
  const { teamsAdapter } = require("../../src/modules/notifications/channels");
  let posted = null;
  const fakeFetch = async (url, opts) => { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; };
  const result = await teamsAdapter("https://example.local/webhook", fakeFetch)
    .send({ subject: "PROJECT RED", text: "PRJ-X turned red" });
  assert.equal(result.status, "SENT");
  assert.match(posted.body.text, /PROJECT RED/);
  // failure path is reported, not swallowed
  const failFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => teamsAdapter("https://example.local/webhook", failFetch).send({ subject: "x", text: "y" }));
});

test("minutes versioning: re-close after correction creates v2, v1 preserved intact", async () => {
  const mt = (await admin.post("/api/v1/meetings")
    .send({ title: "Versioned meeting", date: daysAhead(2), type: "ADHOC" })).body.meeting;
  await admin.post(`/api/v1/meetings/${mt.id}/start`);
  const act = (await admin.post(`/api/v1/meetings/${mt.id}/capture`)
    .send({ kind: "action", project_id: project.id, title: "Originl typo action", owner_user_id: F.U.admin })).body.created;
  await admin.post(`/api/v1/meetings/${mt.id}/close`);
  const v1 = await admin.get(`/api/v1/meetings/${mt.id}/minutes`);
  assert.equal(v1.body.version, 1);
  assert.ok(v1.body.minutes.actions.some((a) => a.title === "Originl typo action"));
  // correct the underlying object, then re-close -> version 2
  const fixed = await admin.put(`/api/v1/actions/${act.id}`)
    .send({ title: "Original action (corrected)", updated_at: act.updated_at });
  assert.equal(fixed.status, 200);
  await admin.post(`/api/v1/meetings/${mt.id}/close`);
  const latest = await admin.get(`/api/v1/meetings/${mt.id}/minutes`);
  assert.equal(latest.body.version, 2);
  assert.ok(latest.body.minutes.actions.some((a) => a.title === "Original action (corrected)"));
  // v1 remains readable and UNCHANGED
  const v1again = await admin.get(`/api/v1/meetings/${mt.id}/minutes?version=1`);
  assert.equal(v1again.body.version, 1);
  assert.ok(v1again.body.minutes.actions.some((a) => a.title === "Originl typo action"));
  const idx = await admin.get(`/api/v1/meetings/${mt.id}/minutes/versions`);
  assert.deepEqual(idx.body.versions.map((v) => v.version), [1, 2]);
});
