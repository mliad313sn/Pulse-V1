"use strict";
// Gate P2 permissions: every role × route class, deny by default.
// Key cases: Viewer can never write; Division Lead full only where own division LEADs;
// Contributor scoped writes; Contributor assigned PM = FULL on that project ONLY;
// confidential hidden from Contributors/Viewers.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F;
let admin, infLead, opsLead, bapLead, contribSGO, contribHGO, viewer;
let infProject; // led by INF, engaged OPS, site SGO
let bapProject; // led by BAP, no OPS involvement, site DKR-less
let confidentialProject;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, opsLead, bapLead, contribSGO, contribHGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "ops@test.local"),
    login(app, "bap@test.local"), login(app, "awa@test.local"), login(app, "ibra@test.local"),
    login(app, "viewer@test.local"),
  ]);

  let res = await infLead.post("/api/v1/projects").send({
    title: "INF-led SGO project", lead_division_id: F.D.INF,
    divisions: [{ division_id: F.D.OPS, role_in_project: "ENGAGED" }],
    sites: [F.S.SGO], target_date: "2026-12-31",
  });
  assert.equal(res.status, 201);
  infProject = res.body.project;

  res = await bapLead.post("/api/v1/projects").send({
    title: "BAP-only project", lead_division_id: F.D.BAP,
  });
  assert.equal(res.status, 201);
  bapProject = res.body.project;

  res = await admin.post("/api/v1/projects").send({
    title: "Secret exec project", lead_division_id: F.D.DAT, confidential: true,
  });
  assert.equal(res.status, 201);
  confidentialProject = res.body.project;
});
after(closePool);

// ===== Viewer: read everything non-confidential, write NOTHING =====
test("Viewer cannot write anywhere (automated proof, plan §1)", async () => {
  const attempts = [
    () => viewer.post("/api/v1/projects").send({ title: "nope", lead_division_id: F.D.INF }),
    () => viewer.put(`/api/v1/projects/${infProject.id}`).send({ title: "nope", updated_at: infProject.updated_at }),
    () => viewer.post(`/api/v1/projects/${infProject.id}/updates`).send({ mood: "ON_TRACK", summary: "nope" }),
    () => viewer.post(`/api/v1/projects/${infProject.id}/milestones`).send({ title: "nope" }),
    () => viewer.post(`/api/v1/projects/${infProject.id}/roadblocks`).send({ title: "nope", severity: "MINOR" }),
    () => viewer.post(`/api/v1/projects/${infProject.id}/actions`).send({ title: "nope", owner_user_id: F.U.viewer }),
    () => viewer.post("/api/v1/actions").send({ title: "nope", owner_user_id: F.U.viewer }),
    () => viewer.post("/api/v1/meetings").send({ title: "nope", date: "2026-09-01", type: "ADHOC" }),
    () => viewer.delete(`/api/v1/projects/${infProject.id}`),
  ];
  for (const fn of attempts) {
    const r = await fn();
    assert.equal(r.status, 403, `${r.request.method} ${r.request.url} -> ${r.status}`);
  }
  // but Viewer CAN read
  const read = await viewer.get("/api/v1/projects");
  assert.equal(read.status, 200);
});

test("Viewer cannot be assigned as PM (server-enforced)", async () => {
  const r = await admin.put(`/api/v1/projects/${infProject.id}`)
    .send({ project_manager_id: F.U.viewer, updated_at: infProject.updated_at });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /viewer/i);
});

// ===== Division Lead =====
test("Division Lead: full edit where own division LEADs; blocked on foreign projects", async () => {
  // INF lead edits own project fields
  const ok = await infLead.put(`/api/v1/projects/${infProject.id}`)
    .send({ sponsor: "CIO", updated_at: infProject.updated_at });
  assert.equal(ok.status, 200);
  infProject = ok.body.project;
  // INF lead cannot edit BAP-led project fields (no INF involvement at all)
  const no = await infLead.put(`/api/v1/projects/${bapProject.id}`)
    .send({ sponsor: "hijack", updated_at: bapProject.updated_at });
  assert.equal(no.status, 403);
  // nor create milestones there
  const noMs = await infLead.post(`/api/v1/projects/${bapProject.id}/milestones`)
    .send({ title: "not yours", owner_division_id: F.D.INF });
  assert.equal(noMs.status, 403);
});

test("Division Lead engaged: may create items owned by own division, not project fields", async () => {
  // OPS is ENGAGED on infProject: opsLead can create an OPS-owned milestone
  const ms = await opsLead.post(`/api/v1/projects/${infProject.id}/milestones`)
    .send({ title: "OPS readiness", type: "SITE_READINESS", owner_division_id: F.D.OPS, site_id: F.S.SGO, due_date: "2026-10-01" });
  assert.equal(ms.status, 201);
  // ...but NOT an INF-owned milestone
  const notOurs = await opsLead.post(`/api/v1/projects/${infProject.id}/milestones`)
    .send({ title: "INF milestone", owner_division_id: F.D.INF });
  assert.equal(notOurs.status, 403);
  // ...and NOT project fields
  const fields = await opsLead.put(`/api/v1/projects/${infProject.id}`)
    .send({ title: "renamed by ops", updated_at: infProject.updated_at });
  assert.equal(fields.status, 403);
  // ...but CAN post a status update (engaged division)
  const su = await opsLead.post(`/api/v1/projects/${infProject.id}/updates`)
    .send({ mood: "WATCH", summary: "Ops view: readiness on track." });
  assert.equal(su.status, 201);
});

// ===== Contributor =====
test("Contributor: scoped writes on touching projects; nothing beyond", async () => {
  // contribSGO (OPS division, SGO site) touches infProject (OPS engaged + SGO site)
  const act = await contribSGO.post(`/api/v1/projects/${infProject.id}/actions`)
    .send({ title: "Prepare patch panel", owner_user_id: F.U.contribSGO, due_date: "2026-09-01" });
  assert.equal(act.status, 201);
  const rb = await contribSGO.post(`/api/v1/projects/${infProject.id}/roadblocks`)
    .send({ title: "Cable tray blocked", severity: "MINOR" });
  assert.equal(rb.status, 201);
  const su = await contribSGO.post(`/api/v1/projects/${infProject.id}/updates`)
    .send({ mood: "ON_TRACK", summary: "Site prep progressing." });
  assert.equal(su.status, 201);
  // can mark own action done
  const done = await contribSGO.put(`/api/v1/actions/${act.body.action.id}`)
    .send({ status: "DONE", updated_at: act.body.action.updated_at });
  assert.equal(done.status, 200);
  // cannot edit project fields
  const fields = await contribSGO.put(`/api/v1/projects/${infProject.id}`)
    .send({ title: "renamed", updated_at: infProject.updated_at });
  assert.equal(fields.status, 403);
  // cannot create milestones (not in Contributor rights)
  const ms = await contribSGO.post(`/api/v1/projects/${infProject.id}/milestones`)
    .send({ title: "nope" });
  assert.equal(ms.status, 403);
  // cannot create projects
  const proj = await contribSGO.post("/api/v1/projects").send({ title: "nope", lead_division_id: F.D.OPS });
  assert.equal(proj.status, 403);
  // cannot touch an unrelated project (BAP-led, no OPS, no SGO)
  const foreign = await contribSGO.post(`/api/v1/projects/${bapProject.id}/actions`)
    .send({ title: "nope", owner_user_id: F.U.contribSGO });
  assert.equal(foreign.status, 403);
  // cannot edit someone else's action
  const other = await opsLead.post(`/api/v1/projects/${infProject.id}/actions`)
    .send({ title: "Ops lead action", owner_user_id: F.U.opsLead });
  assert.equal(other.status, 201);
  const steal = await contribSGO.put(`/api/v1/actions/${other.body.action.id}`)
    .send({ status: "DONE", updated_at: other.body.action.updated_at });
  assert.equal(steal.status, 403);
});

// ===== the non-negotiable: Contributor assigned PM =====
test("Contributor assigned PM gains FULL edit on that project only, stays restricted elsewhere", async () => {
  // assign contribHGO (Ibrahim: OPS/HGO — does NOT touch bapProject otherwise) as PM of bapProject
  const cur = await admin.get(`/api/v1/projects/${bapProject.id}`);
  const assign = await admin.put(`/api/v1/projects/${bapProject.id}`)
    .send({ project_manager_id: F.U.contribHGO, updated_at: cur.body.project.updated_at });
  assert.equal(assign.status, 200);

  // PM_ASSIGNED notification fired to the new PM
  const notif = await contribHGO.get("/api/v1/notifications");
  assert.ok(
    notif.body.notifications.some((n) => n.type === "PM_ASSIGNED" && n.entity_id === bapProject.id),
    "PM_ASSIGNED notification delivered"
  );

  // FULL edit on the assigned project: project fields...
  let fresh = (await contribHGO.get(`/api/v1/projects/${bapProject.id}`)).body.project;
  const rename = await contribHGO.put(`/api/v1/projects/${bapProject.id}`)
    .send({ title: "BAP rollout (PM-driven)", exec_commentary: "Driven end-to-end by a site IT lead.", updated_at: fresh.updated_at });
  assert.equal(rename.status, 200);
  // ...milestones...
  const ms = await contribHGO.post(`/api/v1/projects/${bapProject.id}/milestones`)
    .send({ title: "Cutover", type: "GO_LIVE", due_date: "2026-11-01", owner_user_id: F.U.contribHGO });
  assert.equal(ms.status, 201);
  // ...roadblocks, actions, updates, decisions
  const rb = await contribHGO.post(`/api/v1/projects/${bapProject.id}/roadblocks`)
    .send({ title: "Vendor delay", severity: "MAJOR" });
  assert.equal(rb.status, 201);
  const dec = await contribHGO.post(`/api/v1/projects/${bapProject.id}/decisions`)
    .send({ text: "Go with phased cutover." });
  assert.equal(dec.status, 201);

  // ...and can close (edit) the roadblock — full edit includes items not owned by them
  const closeRb = await contribHGO.put(`/api/v1/roadblocks/${rb.body.roadblock.id}`)
    .send({ status: "RESOLVED", resolution_note: "Vendor confirmed new date.", updated_at: rb.body.roadblock.updated_at });
  assert.equal(closeRb.status, 200);

  // STILL restricted elsewhere: infProject fields (they only touch it via OPS engagement -> partial, not full)
  fresh = (await contribHGO.get(`/api/v1/projects/${infProject.id}`)).body.project;
  const noFields = await contribHGO.put(`/api/v1/projects/${infProject.id}`)
    .send({ title: "hijack", updated_at: fresh.updated_at });
  assert.equal(noFields.status, 403);
  const noMs = await contribHGO.post(`/api/v1/projects/${infProject.id}/milestones`).send({ title: "nope" });
  assert.equal(noMs.status, 403);
  // and still cannot create projects at all
  const noProj = await contribHGO.post("/api/v1/projects").send({ title: "nope", lead_division_id: F.D.OPS });
  assert.equal(noProj.status, 403);
});

// ===== confidentiality =====
test("Confidential projects hidden from Contributors and Viewers everywhere", async () => {
  // direct access -> 404 (indistinguishable from absent)
  for (const s of [contribSGO, viewer]) {
    const r = await s.get(`/api/v1/projects/${confidentialProject.id}`);
    assert.equal(r.status, 404);
  }
  // absent from portfolio list
  const list = await viewer.get("/api/v1/projects");
  assert.ok(!list.body.projects.some((p) => p.id === confidentialProject.id));
  // absent from search
  const search = await contribSGO.get("/api/v1/search?q=Secret");
  assert.equal(search.body.projects.length, 0);
  // Admin and Division Leads see it
  const adminSees = await admin.get(`/api/v1/projects/${confidentialProject.id}`);
  assert.equal(adminSees.status, 200);
  const dlSees = await infLead.get(`/api/v1/projects/${confidentialProject.id}`);
  assert.equal(dlSees.status, 200);
  // only Admin can set the flag
  const cur = (await admin.get(`/api/v1/projects/${infProject.id}`)).body.project;
  const dlFlag = await infLead.put(`/api/v1/projects/${infProject.id}`)
    .send({ confidential: true, updated_at: cur.updated_at });
  assert.equal(dlFlag.status, 403);
});

test("soft delete is Admin-only and hides the record everywhere", async () => {
  const p = await admin.post("/api/v1/projects").send({ title: "To be removed", lead_division_id: F.D.GRP });
  assert.equal(p.status, 201);
  const dl = await infLead.delete(`/api/v1/projects/${p.body.project.id}`);
  assert.equal(dl.status, 403);
  const del = await admin.delete(`/api/v1/projects/${p.body.project.id}`);
  assert.equal(del.status, 200);
  const gone = await admin.get(`/api/v1/projects/${p.body.project.id}`);
  assert.equal(gone.status, 404);
  // row still exists (soft delete, no hard DELETE anywhere)
  const { rows } = await query(`SELECT deleted_at FROM projects WHERE id = $1`, [p.body.project.id]);
  assert.ok(rows[0].deleted_at !== null);
});

test("audit log captured writes without secrets; endpoint is Admin-only + paginated", async () => {
  const forbidden = await viewer.get("/api/v1/audit");
  assert.equal(forbidden.status, 403);
  const res = await admin.get("/api/v1/audit?limit=200");
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.length > 0);
  assert.ok(res.body.total > 0);
  const text = JSON.stringify(res.body);
  assert.ok(!/\$2a\$/.test(text), "no bcrypt hashes in audit log");
  assert.ok(!res.body.entries.some((e) => e.field === "password_hash"), "password_hash never audited");
});
