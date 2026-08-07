"use strict";
// SPM P1 finisher — project templates instantiate a repeatable shape;
// custom fields are Admin-defined and validated server-side.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, admin, infLead, contribSGO, template;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
});
after(closePool);

test("P1 templates: DL defines a blueprint; creating a project from it stamps dated milestones", async () => {
  assert.equal((await contribSGO.post("/api/v1/project-templates").send({ name: "x" })).status, 403);

  const res = await infLead.post("/api/v1/project-templates").send({
    name: "Site IT rollout", governance: "LITE",
    milestones: [
      { title: "Kickoff", offset_days: 0 },
      { title: "Site readiness", type: "SITE_READINESS", offset_days: 30 },
      { title: "Go-live", type: "GO_LIVE", offset_days: 60 },
    ],
    workstreams: [{ title: "Network" }, { title: "End-user devices" }],
    deliverables: [{ title: "As-built documentation" }],
  });
  assert.equal(res.status, 201);
  template = res.body.template;

  const proj = await infLead.post("/api/v1/projects").send({
    title: "KGO rollout from template", lead_division_id: F.D.INF, sites: [F.S.KGO],
    start_date: "2026-09-01", template_id: template.id,
  });
  assert.equal(proj.status, 201);
  const detail = await infLead.get(`/api/v1/projects/${proj.body.project.id}`);
  const ms = detail.body.milestones;
  assert.equal(ms.length, 3);
  const goLive = ms.find((m) => m.type === "GO_LIVE");
  assert.equal(String(goLive.due_date).slice(0, 10), "2026-10-31", "start + 60 days");
  const readiness = ms.find((m) => m.type === "SITE_READINESS");
  assert.ok(readiness.readiness?.length >= 3, "SITE_READINESS milestone brings its checklist");

  const dup = await infLead.post("/api/v1/project-templates").send({ name: "site it ROLLOUT" });
  assert.equal(dup.status, 400, "case-insensitive duplicate name refused");
});

test("P1 custom fields: Admin defines; values validated server-side; stored and returned", async () => {
  assert.equal((await infLead.post("/api/v1/custom-fields")
    .send({ key: "erp_module", label: "ERP module", type: "select", options: ["FI", "MM", "PM"] })).status, 403);

  assert.equal((await admin.post("/api/v1/custom-fields")
    .send({ key: "erp_module", label: "ERP module", type: "select", options: ["FI", "MM", "PM"] })).status, 201);
  assert.equal((await admin.post("/api/v1/custom-fields")
    .send({ key: "contract_ref", label: "Contract reference", type: "text" })).status, 201);

  // invalid select value refused; unknown key refused
  const bad = await infLead.post("/api/v1/projects").send({
    title: "Custom bad", lead_division_id: F.D.INF, custom: { erp_module: "XX" },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /must be one of/);
  const unknown = await infLead.post("/api/v1/projects").send({
    title: "Custom unknown", lead_division_id: F.D.INF, custom: { made_up: 1 },
  });
  assert.equal(unknown.status, 400);

  // valid values persist and update via merge
  const ok = await infLead.post("/api/v1/projects").send({
    title: "Custom ok", lead_division_id: F.D.INF,
    custom: { erp_module: "MM", contract_ref: "CT-2026-091" },
  });
  assert.equal(ok.status, 201);
  const p = ok.body.project;
  const upd = await infLead.put(`/api/v1/projects/${p.id}`).send({
    custom: { erp_module: "PM" }, updated_at: p.updated_at,
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.project.custom_json.erp_module, "PM");
  assert.equal(upd.body.project.custom_json.contract_ref, "CT-2026-091", "merge keeps other values");
});
