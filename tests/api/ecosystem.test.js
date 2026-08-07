"use strict";
// Ecosystem gates: ITPM360 stage-gates via the API (with transition ledger),
// OpsPm360 RACI + site isolation, Pulse-V1 sync idempotency + halt alert.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, siteViewer;
let project; // INF-led, SGO site

before(async () => {
  await initDb();
  F = await fixtures();
  // steering committee: admin only; site-isolated viewer at SGO
  await query(`UPDATE users SET is_steering_committee = true WHERE email = 'admin@test.local'`);
  const bcrypt = require("bcryptjs");
  const hash = await bcrypt.hash("TestPass-2026!", 12);
  await query(
    `INSERT INTO users (name, email, password_hash, role, division_id, site_id, must_change_password, enterprise_access)
     VALUES ('SGO Office', 'sgo.office@test.local', $1, 'VIEWER', $2, $3, false, false)`,
    [hash, F.D.OPS, F.S.SGO]
  );
  app = createApp();
  [admin, infLead, contribSGO, siteViewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "sgo.office@test.local"),
  ]);
  const res = await infLead.post("/api/v1/projects").send({
    title: "Gated project", lead_division_id: F.D.INF, sites: [F.S.SGO],
  });
  assert.equal(res.status, 201);
  project = res.body.project;
  assert.equal(project.stage, "IDEA");
});
after(closePool);

const fresh = async (who = admin) => (await who.get(`/api/v1/projects/${project.id}`)).body.project;

test("stage gates: cannot skip stages; prerequisites enforced field by field", async () => {
  // IDEA -> BUILD is a skip
  let p = await fresh();
  const skip = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "BUILD", updated_at: p.updated_at });
  assert.equal(skip.status, 400);
  assert.match(skip.body.error, /cannot move directly/);
  // IDEA -> DESIGN blocked while proposal fields are missing
  const early = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "DESIGN", updated_at: p.updated_at });
  assert.equal(early.status, 400);
  assert.match(early.body.error, /Sponsor|Description|Target/);
  // fill the proposal, then the gate opens (no committee needed at this gate)
  p = await fresh();
  const ok = await infLead.put(`/api/v1/projects/${project.id}`).send({
    stage: "DESIGN", description: "Replace SGO core switching", sponsor: "CIO",
    target_date: "2026-12-01", updated_at: p.updated_at,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.stage, "DESIGN");
});

test("PLANNING->EXECUTION gate: Steering Committee only, milestones required, ledger written", async () => {
  // milestone prerequisite missing
  let p = await fresh();
  const noMs = await admin.put(`/api/v1/projects/${project.id}`).send({ stage: "BUILD", updated_at: p.updated_at });
  assert.equal(noMs.status, 400);
  assert.match(noMs.body.error, /milestone/i);
  await admin.post(`/api/v1/projects/${project.id}/milestones`).send({ title: "Build phase 1", due_date: "2026-10-01" });
  // non-committee full-access user (lead of the LEAD division) is refused with 403
  p = await fresh();
  const denied = await infLead.put(`/api/v1/projects/${project.id}`).send({ stage: "BUILD", updated_at: p.updated_at });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /Steering Committee/);
  // committee member approves; the transition is recorded in the ledger
  p = await fresh();
  const approved = await admin.put(`/api/v1/projects/${project.id}`).send({
    stage: "BUILD", stage_note: "SC approval in weekly review", updated_at: p.updated_at,
  });
  assert.equal(approved.status, 200);
  const ledger = await query(
    `SELECT * FROM stage_transitions WHERE project_id = $1 ORDER BY id`, [project.id]
  );
  assert.deepEqual(ledger.rows.map((r) => `${r.from_stage}>${r.to_stage}`), ["IDEA>DESIGN", "DESIGN>BUILD"]);
  assert.equal(ledger.rows[1].note, "SC approval in weekly review");
  // War Room shows the approval
  const wr = await admin.get("/api/v1/warroom");
  assert.ok(wr.body.transitions.some((t) => t.project_code === project.code && t.to_stage === "BUILD"));
});

test("deliverables + RACI: full-access defines, tagged R can update, War Room lists my duties", async () => {
  const dl = await infLead.post(`/api/v1/projects/${project.id}/deliverables`)
    .send({ title: "As-built documentation", due_date: "2026-11-01" });
  assert.equal(dl.status, 201);
  // contributor without full access cannot create deliverables
  const noCreate = await contribSGO.post(`/api/v1/projects/${project.id}/deliverables`).send({ title: "nope" });
  assert.equal(noCreate.status, 403);
  // RACI assignment (full access only)
  const raci = await infLead.put(`/api/v1/deliverables/${dl.body.deliverable.id}/raci`).send({
    assignments: [
      { user_id: F.U.contribSGO, raci_role: "R" },
      { user_id: F.U.infLead, raci_role: "A" },
    ],
  });
  assert.equal(raci.status, 200);
  const noRaci = await contribSGO.put(`/api/v1/deliverables/${dl.body.deliverable.id}/raci`)
    .send({ assignments: [] });
  assert.equal(noRaci.status, 403);
  // the tagged R (contributor, no full access) can progress the deliverable
  const cur = (await infLead.get(`/api/v1/projects/${project.id}/deliverables`)).body.deliverables[0];
  const upd = await contribSGO.put(`/api/v1/deliverables/${cur.id}`)
    .send({ status: "IN_PROGRESS", updated_at: cur.updated_at });
  assert.equal(upd.status, 200);
  // it appears in the R's War Room duties
  const wr = await contribSGO.get("/api/v1/warroom");
  assert.ok(wr.body.myRaci.some((r) => r.deliverable_id === cur.id && r.raci_role === "R"));
});

test("site isolation: a non-enterprise user sees ONLY projects touching their site", async () => {
  const hgo = await infLead.post("/api/v1/projects").send({
    title: "HGO-only project", lead_division_id: F.D.INF, sites: [F.S.HGO],
  });
  assert.equal(hgo.status, 201);
  // portfolio: SGO viewer sees the SGO project, not the HGO one
  const list = await siteViewer.get("/api/v1/projects");
  assert.ok(list.body.projects.some((p) => p.id === project.id), "own-site project visible");
  assert.ok(!list.body.projects.some((p) => p.id === hgo.body.project.id), "other-site project hidden");
  // direct access to the other site's project -> 404 (indistinguishable from absent)
  const direct = await siteViewer.get(`/api/v1/projects/${hgo.body.project.id}`);
  assert.equal(direct.status, 404);
  // search does not leak it either
  const search = await siteViewer.get("/api/v1/search?q=HGO-only");
  assert.equal(search.body.projects.length, 0);
  // war room is scoped the same way
  const wr = await siteViewer.get("/api/v1/warroom");
  assert.ok(!wr.body.projects.some((p) => p.id === hgo.body.project.id));
  // enterprise users still see everything
  const all = await admin.get("/api/v1/projects");
  assert.ok(all.body.projects.some((p) => p.id === hgo.body.project.id));
});

test("sync idempotency: the same X-Client-Op-Id applies exactly once", async () => {
  const opId = "test-op-0001-create-action";
  const first = await admin.post(`/api/v1/projects/${project.id}/actions`)
    .set("X-Client-Op-Id", opId)
    .send({ title: "Queued offline action", owner_user_id: F.U.admin, due_date: "2026-10-10" });
  assert.equal(first.status, 201);
  // FIFO replay after reconnect sends the identical op again
  const second = await admin.post(`/api/v1/projects/${project.id}/actions`)
    .set("X-Client-Op-Id", opId)
    .send({ title: "Queued offline action", owner_user_id: F.U.admin, due_date: "2026-10-10" });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM actions WHERE title = 'Queued offline action' AND deleted_at IS NULL`
  );
  assert.equal(rows[0].n, 1, "op applied exactly once");
});

test("sync halt alert notifies every administrator, no automated resolution", async () => {
  const res = await contribSGO.post("/api/v1/sync/halt-alert").send({
    op_summary: "PUT /api/v1/projects/99 (stage change)", status: 409,
    error: "This project changed since you loaded it", queued_remaining: 3,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.alerted >= 1);
  const notif = await admin.get("/api/v1/notifications");
  const alert = notif.body.notifications.find((n) => n.type === "SYNC_HALTED");
  assert.ok(alert, "admin received SYNC_HALTED");
  assert.match(alert.text, /Awa Diallo/);
  assert.match(alert.text, /3 op\(s\) frozen/);
});
