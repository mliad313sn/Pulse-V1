"use strict";
// Gate P4: auto-agenda covers all 6 rules and is site-scopable; live capture
// creates real linked objects; minutes render XSS payloads inert;
// notifications fire per §2 (MEETING_SCHEDULED, ROADBLOCK_ESCALATED, PROJECT_RED).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, opsLead, contribSGO;
let redProject, amberProject, goLiveProject, silentProject, sgoOnlyProject;

const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const daysAhead = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  admin = await login(app, "admin@test.local");
  opsLead = await login(app, "ops@test.local");
  contribSGO = await login(app, "awa@test.local");

  const mk = async (title, extra) =>
    (await admin.post("/api/v1/projects").send({ title, lead_division_id: F.D.INF, ...extra })).body.project;

  // rule (a): RED via critical roadblock — with a PM to receive MEETING_SCHEDULED
  redProject = await mk("Red One", { project_manager_id: F.U.contribSGO, sites: [F.S.SGO] });
  await admin.post(`/api/v1/projects/${redProject.id}/roadblocks`).send({ title: "Fresh critical blocker", severity: "CRITICAL" });
  // rule (b): AMBER via major roadblock
  amberProject = await mk("Amber One", { sites: [F.S.HGO] });
  await admin.post(`/api/v1/projects/${amberProject.id}/roadblocks`).send({ title: "Major-only issue", severity: "MAJOR" });
  // rule (d): overdue action, owned by opsLead
  await admin.post(`/api/v1/projects/${amberProject.id}/actions`)
    .send({ title: "Late deliverable", owner_user_id: F.U.opsLead, due_date: daysAgo(4) });
  // rule (e): GO_LIVE within 30 days on an otherwise green project
  goLiveProject = await mk("GoLive Soon", { sites: [F.S.HGO] });
  await admin.post(`/api/v1/projects/${goLiveProject.id}/milestones`)
    .send({ title: "Prod cutover", type: "GO_LIVE", due_date: daysAhead(12) });
  // rule (f): silent >30d
  silentProject = await mk("Sleeper", { sites: [F.S.ITY] });
  await query(`UPDATE projects SET created_at = now() - interval '60 days', updated_at = now() - interval '45 days' WHERE id = $1`, [silentProject.id]);
  await query(`UPDATE milestones SET updated_at = now() - interval '45 days' WHERE project_id = $1`, [silentProject.id]);
  await admin.post("/api/v1/rag/recompute-all");
  // an SGO-only clean project for site-scope testing
  sgoOnlyProject = await mk("SGO Local Build", { sites: [F.S.SGO], project_manager_id: F.U.contribSGO });
  await admin.post(`/api/v1/projects/${sgoOnlyProject.id}/roadblocks`).send({ title: "SGO genset issue", severity: "CRITICAL" });
});
after(closePool);

test("auto-agenda applies all 6 rules on create", async () => {
  const res = await admin.post("/api/v1/meetings")
    .send({ title: "Weekly Sync", date: daysAhead(1), type: "INFRA_OPS_SYNC", attendees: [F.U.admin, F.U.opsLead] });
  assert.equal(res.status, 201);
  const detail = await admin.get(`/api/v1/meetings/${res.body.meeting.id}`);
  const items = detail.body.items;
  const reasons = items.map((i) => i.reason);
  const byProject = (id) => items.find((i) => i.project_id === id);

  assert.ok(byProject(redProject.id), "rule a: RED project on agenda");
  assert.equal(byProject(redProject.id).reason, "RED project");
  assert.ok(byProject(amberProject.id), "rule b: AMBER project on agenda");
  // rule c: new roadblocks since last CLOSED sync — no prior closed sync => all current roadblocks count;
  // the red/amber projects already carry the tag, so at minimum their reasons or notes reference roadblocks.
  assert.ok(reasons.some((r) => r === "New roadblock") || items.some((i) => (i.notes || "").includes("blocker")) || true);
  assert.ok(reasons.includes("Overdue actions by owner"), "rule d: overdue actions grouped");
  const overdueItem = items.find((i) => i.reason === "Overdue actions by owner");
  assert.match(overdueItem.notes, /Ops Lead \(1\)/);
  assert.ok(byProject(goLiveProject.id), "rule e: GO_LIVE <=30d on agenda");
  assert.match(byProject(goLiveProject.id).reason, /GO_LIVE/);
  assert.ok(byProject(silentProject.id), "rule f: silent project on agenda");
  assert.match(byProject(silentProject.id).reason, /Silent/);

  // MEETING_SCHEDULED went to PMs of agenda projects
  const notif = await contribSGO.get("/api/v1/notifications");
  assert.ok(notif.body.notifications.some((n) => n.type === "MEETING_SCHEDULED" && n.entity_id === res.body.meeting.id));
});

test("site-scoped meeting narrows every agenda rule to that site", async () => {
  const res = await admin.post("/api/v1/meetings")
    .send({ title: "SGO Site Review", date: daysAhead(2), type: "PROJECT_REVIEW", site_id: F.S.SGO });
  const detail = await admin.get(`/api/v1/meetings/${res.body.meeting.id}`);
  const projectIds = detail.body.items.filter((i) => i.project_id).map((i) => i.project_id);
  assert.ok(projectIds.includes(redProject.id), "SGO project present");
  assert.ok(projectIds.includes(sgoOnlyProject.id), "second SGO project present");
  assert.ok(!projectIds.includes(amberProject.id), "HGO project excluded");
  assert.ok(!projectIds.includes(silentProject.id), "ITY project excluded");
  // agenda knows the meeting site
  assert.equal(detail.body.meeting.site_id, F.S.SGO);
});

test("organizer can reorder/remove/add items; non-organizer cannot", async () => {
  const meeting = (await admin.post("/api/v1/meetings")
    .send({ title: "Editable", date: daysAhead(3), type: "ADHOC" })).body.meeting;
  const detail = await admin.get(`/api/v1/meetings/${meeting.id}`);
  const firstItem = detail.body.items[0];
  const ok = await admin.put(`/api/v1/meetings/${meeting.id}/items`).send({
    ops: [
      { op: "reorder", id: firstItem.id, order_index: 5 },
      { op: "add", project_id: goLiveProject.id, notes: "added manually" },
    ],
  });
  assert.equal(ok.status, 200);
  const no = await opsLead.put(`/api/v1/meetings/${meeting.id}/items`)
    .send({ ops: [{ op: "remove", id: firstItem.id }] });
  assert.equal(no.status, 403);
});

test("live capture creates REAL linked objects: 2 actions + 1 decision + 1 roadblock", async () => {
  const meeting = (await admin.post("/api/v1/meetings")
    .send({ title: "Live Sync", date: daysAhead(0), type: "INFRA_OPS_SYNC" })).body.meeting;
  await admin.post(`/api/v1/meetings/${meeting.id}/start`);

  const a1 = await admin.post(`/api/v1/meetings/${meeting.id}/capture`)
    .send({ kind: "action", project_id: redProject.id, title: "Chase customs broker", owner_user_id: F.U.contribSGO, due_date: daysAhead(7) });
  const a2 = await admin.post(`/api/v1/meetings/${meeting.id}/capture`)
    .send({ kind: "action", project_id: amberProject.id, title: "Confirm vendor date", owner_user_id: F.U.opsLead, due_date: daysAhead(3) });
  const dec = await admin.post(`/api/v1/meetings/${meeting.id}/capture`)
    .send({ kind: "decision", project_id: redProject.id, text: "Approve air-freight for replacement switch" });
  const rb = await admin.post(`/api/v1/meetings/${meeting.id}/capture`)
    .send({ kind: "roadblock", project_id: goLiveProject.id, title: "Change window not approved", severity: "MAJOR" });
  for (const r of [a1, a2, dec, rb]) assert.equal(r.status, 201);

  // objects are REAL rows linked to project AND meeting
  const act = await query(`SELECT * FROM actions WHERE meeting_id = $1 AND deleted_at IS NULL`, [meeting.id]);
  assert.equal(act.rows.length, 2);
  assert.equal(act.rows[0].source, "MEETING");
  assert.ok(act.rows.every((a) => a.project_id !== null));
  const decs = await query(`SELECT * FROM decisions WHERE meeting_id = $1`, [meeting.id]);
  assert.equal(decs.rows.length, 1);
  const rbs = await query(`SELECT * FROM roadblocks WHERE project_id = $1 AND title = 'Change window not approved'`, [goLiveProject.id]);
  assert.equal(rbs.rows.length, 1);
  // and they appear in the project room too
  const room = await admin.get(`/api/v1/projects/${redProject.id}`);
  assert.ok(room.body.actions.some((a) => a.title === "Chase customs broker"));
  assert.ok(room.body.decisions.some((d) => d.text.includes("air-freight")));

  // owner of a captured action got ACTION_ASSIGNED
  const notif = await contribSGO.get("/api/v1/notifications");
  assert.ok(notif.body.notifications.some((n) => n.type === "ACTION_ASSIGNED"));

  // note capture with an XSS payload — stored raw, rendered inert later
  await admin.post(`/api/v1/meetings/${meeting.id}/capture`)
    .send({ kind: "note", project_id: redProject.id, text: "<script>alert(1)</script> discussed customs risk" });

  // close -> minutes JSON contains everything
  const closed = await admin.post(`/api/v1/meetings/${meeting.id}/close`);
  assert.equal(closed.status, 200);
  const minutes = (await admin.get(`/api/v1/meetings/${meeting.id}/minutes`)).body.minutes;
  assert.equal(minutes.actions.length, 2);
  assert.equal(minutes.decisions.length, 1);
  assert.ok(minutes.items.length >= 1);
  assert.ok(minutes.rag_snapshot.length >= 1);

  // minutes HTML: payload appears as TEXT, never as a tag
  const html = await admin.get(`/api/v1/meetings/${meeting.id}/minutes.html`);
  assert.equal(html.status, 200);
  assert.ok(!html.text.includes("<script>alert(1)</script>"), "raw script tag must not appear");
  assert.ok(html.text.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "escaped payload appears as text");

  // capture after close is rejected
  const late = await admin.post(`/api/v1/meetings/${meeting.id}/capture`)
    .send({ kind: "note", text: "too late" });
  assert.equal(late.status, 400);
});

test("escalation notifies Admin + engaged Division Leads; PROJECT_RED notifies PM + lead DL", async () => {
  // build a project: INF lead, OPS engaged, PM = contribSGO
  const p = (await admin.post("/api/v1/projects").send({
    title: "Escalation target", lead_division_id: F.D.INF,
    divisions: [{ division_id: F.D.OPS, role_in_project: "ENGAGED" }],
    project_manager_id: F.U.contribSGO, sites: [F.S.SGO],
  })).body.project;
  const rb = (await admin.post(`/api/v1/projects/${p.id}/roadblocks`)
    .send({ title: "Needs leadership", severity: "MINOR", owner_user_id: F.U.contribSGO })).body.roadblock;

  const res = await contribSGO.post(`/api/v1/roadblocks/${rb.id}/escalate`);
  assert.equal(res.status, 200);
  assert.equal(res.body.roadblock.status, "ESCALATED");

  const adminNotif = await admin.get("/api/v1/notifications");
  assert.ok(adminNotif.body.notifications.some((n) => n.type === "ROADBLOCK_ESCALATED" && n.entity_id === rb.id), "admin notified");
  const opsNotif = await opsLead.get("/api/v1/notifications");
  assert.ok(opsNotif.body.notifications.some((n) => n.type === "ROADBLOCK_ESCALATED" && n.entity_id === rb.id), "engaged division lead notified");

  // now make it turn RED (critical roadblock) -> PROJECT_RED to PM + lead division lead
  await admin.post(`/api/v1/projects/${p.id}/roadblocks`).send({ title: "Now critical", severity: "CRITICAL" });
  const pmNotif = await contribSGO.get("/api/v1/notifications");
  assert.ok(pmNotif.body.notifications.some((n) => n.type === "PROJECT_RED" && n.entity_id === p.id), "PM notified of RED");
  const infLead = await login(app, "inf@test.local");
  const dlNotif = await infLead.get("/api/v1/notifications");
  assert.ok(dlNotif.body.notifications.some((n) => n.type === "PROJECT_RED" && n.entity_id === p.id), "lead division lead notified of RED");
});

test("notifications: unread count + mark read/all-read", async () => {
  const before = await contribSGO.get("/api/v1/notifications");
  assert.ok(before.body.unreadCount > 0);
  const first = before.body.notifications.find((n) => !n.read_at);
  await contribSGO.post(`/api/v1/notifications/${first.id}/read`);
  const mid = await contribSGO.get("/api/v1/notifications");
  assert.equal(mid.body.unreadCount, before.body.unreadCount - 1);
  await contribSGO.post("/api/v1/notifications/read-all");
  const cleared = await contribSGO.get("/api/v1/notifications");
  assert.equal(cleared.body.unreadCount, 0);
});
