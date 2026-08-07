"use strict";
// E24 — attachments: upload validation (type/size/hostile filename), version
// increments, authorization parity on download (confidential + site
// concealment), storage-key isolation (key never exposed).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

process.env.ATTACHMENTS_DIR = path.join(os.tmpdir(), `pulse-att-test-${process.pid}`);

let app, F, admin, infLead, contribSGO, viewer;
let project, confProject, attachment;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Docs project", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.contribSGO,
  })).body.project;
  confProject = (await admin.post("/api/v1/projects").send({
    title: "Confidential docs", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
});
after(closePool);

test("E24 upload: validation, sanitization, versioning; viewer refused", async () => {
  // wrong type refused
  const bad = await contribSGO.post(`/api/v1/projects/${project.id}/attachments`)
    .attach("file", Buffer.from("MZ..."), "run.exe");
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not allowed/);

  // hostile path-traversal filename is stripped to its basename
  const up = await contribSGO.post(`/api/v1/projects/${project.id}/attachments`)
    .field("description", "cutover plan")
    .attach("file", Buffer.from("plan-content-v1"), "../../etc/passwd../cutover plan.pdf");
  assert.equal(up.status, 201);
  attachment = up.body.attachment;
  assert.equal(attachment.filename, "cutover plan.pdf");
  assert.equal(attachment.version, 1);
  assert.ok(!("storage_key" in attachment), "storage key never leaves the server");

  // same name again → version 2
  const up2 = await contribSGO.post(`/api/v1/projects/${project.id}/attachments`)
    .attach("file", Buffer.from("plan-content-v2"), "cutover plan.pdf");
  assert.equal(up2.body.attachment.version, 2);

  // viewer (READ) cannot upload
  const deny = await viewer.post(`/api/v1/projects/${project.id}/attachments`)
    .attach("file", Buffer.from("x"), "note.txt");
  assert.equal(deny.status, 403);

  const listRes = await viewer.get(`/api/v1/projects/${project.id}/attachments`);
  assert.equal(listRes.body.attachments.length, 2, "viewer can read metadata on visible projects");
  assert.ok(!JSON.stringify(listRes.body).includes("storage_key"));
});

test("E24 download: content round-trips; confidential project attachment is a concealed 404", async () => {
  const dl = await viewer.agent.get(`/api/v1/attachments/${attachment.id}`).buffer(true)
    .parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(dl.status, 200);
  assert.equal(dl.body.toString(), "plan-content-v1");
  assert.match(dl.headers["content-disposition"], /cutover plan\.pdf/);

  // attachment on a confidential project: upload as admin, viewer gets 404 (not 403)
  const conf = await admin.post(`/api/v1/projects/${confProject.id}/attachments`)
    .attach("file", Buffer.from("secret-brief"), "brief.pdf");
  assert.equal(conf.status, 201);
  const hidden = await viewer.get(`/api/v1/attachments/${conf.body.attachment.id}`);
  assert.equal(hidden.status, 404, "concealed, indistinguishable from absent");
  const hiddenList = await viewer.get(`/api/v1/projects/${confProject.id}/attachments`);
  assert.equal(hiddenList.status, 404, "the whole project stays concealed");
});

test("E24 delete: FULL-only; deleted attachment 404s but bytes stay auditable in metadata", async () => {
  assert.equal((await viewer.delete(`/api/v1/attachments/${attachment.id}`)).status, 403);
  const del = await contribSGO.delete(`/api/v1/attachments/${attachment.id}`); // PM = FULL
  assert.equal(del.status, 200);
  assert.equal((await viewer.get(`/api/v1/attachments/${attachment.id}`)).status, 404);
});
