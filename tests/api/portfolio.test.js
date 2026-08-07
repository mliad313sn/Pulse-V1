"use strict";
// E04 — portfolio hierarchy: pillar → portfolio → program → project, with
// per-viewer aggregate rollups (no confidential leakage through counts) and
// finance summary masking on the portfolio card.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, admin, infLead, contrib, viewer;
let pillar, portfolio, program, otherPortfolio;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contrib, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
});
after(closePool);

test("E04 hierarchy config: pillar admin-only, duplicate rejected, program must belong to portfolio", async () => {
  assert.equal((await contrib.post("/api/v1/pillars").send({ name: "Ops Excellence" })).status, 403);
  assert.equal((await infLead.post("/api/v1/pillars").send({ name: "Ops Excellence" })).status, 403,
    "pillars are Admin configuration, not Division Lead");

  const p1 = await admin.post("/api/v1/pillars").send({ name: "Digital Core", description: "ERP + data backbone" });
  assert.equal(p1.status, 201);
  pillar = p1.body.pillar;
  assert.equal((await admin.post("/api/v1/pillars").send({ name: "digital core" })).status, 400,
    "case-insensitive duplicate pillar rejected");

  const pf = await infLead.post("/api/v1/portfolios").send({
    title: "ERP Modernisation", pillar_id: pillar.id, objective: "Single ERP by 2027",
  });
  assert.equal(pf.status, 201);
  portfolio = pf.body.portfolio;
  const pf2 = await admin.post("/api/v1/portfolios").send({ title: "Mine Digitisation" });
  otherPortfolio = pf2.body.portfolio;

  assert.equal((await contrib.post("/api/v1/portfolios").send({ title: "Rogue" })).status, 403);
  assert.equal((await admin.post("/api/v1/portfolios").send({ title: "  " })).status, 400);
  assert.equal((await admin.post("/api/v1/portfolios").send({ title: "X", pillar_id: 99999 })).status, 400);

  const pr = await admin.post("/api/v1/programs").send({
    title: "Finance Wave", portfolio_id: portfolio.id, objective: "GL + AP first",
  });
  assert.equal(pr.status, 201);
  program = pr.body.program;
  assert.equal((await admin.post("/api/v1/programs").send({ title: "Orphan", portfolio_id: 99999 })).status, 400);
});

test("E04 project attachment: program/portfolio mismatch rejected; portfolio filter works", async () => {
  // Attach at creation
  const ok = await infLead.post("/api/v1/projects").send({
    title: "GL Replacement", lead_division_id: F.D.INF, sites: [F.S.SGO],
    portfolio_id: portfolio.id, program_id: program.id,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.project.program_id, program.id);

  // Program under a different portfolio -> 400
  const mismatch = await infLead.post("/api/v1/projects").send({
    title: "Bad pairing", lead_division_id: F.D.INF,
    portfolio_id: otherPortfolio.id, program_id: program.id,
  });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error, /does not belong/);

  // Program without its portfolio -> 400
  const orphan = await infLead.post("/api/v1/projects").send({
    title: "Program only", lead_division_id: F.D.INF, program_id: program.id,
  });
  assert.equal(orphan.status, 400);

  // Attach later via update (with hierarchy re-check) + filter
  const p2 = (await infLead.post("/api/v1/projects").send({
    title: "AP Automation", lead_division_id: F.D.INF,
  })).body.project;
  const upd = await infLead.put(`/api/v1/projects/${p2.id}`).send({
    portfolio_id: portfolio.id, updated_at: p2.updated_at,
  });
  assert.equal(upd.status, 200);

  const filtered = await infLead.get(`/api/v1/projects?portfolio=${portfolio.id}`);
  const titles = filtered.body.projects.map((p) => p.title).sort();
  assert.deepEqual(titles, ["AP Automation", "GL Replacement"]);
  assert.equal(filtered.body.projects[0].portfolio_title, "ERP Modernisation");
  const progOnly = await infLead.get(`/api/v1/projects?program=${program.id}`);
  assert.deepEqual(progOnly.body.projects.map((p) => p.title), ["GL Replacement"]);
});

test("E04 rollups: aggregate health per viewer — confidential projects never counted for the unauthorized", async () => {
  // A confidential project inside the portfolio (visible to admin/leads only)
  const conf = await admin.post("/api/v1/projects").send({
    title: "Secret carve-out", lead_division_id: F.D.INF, confidential: true,
    portfolio_id: portfolio.id,
  });
  assert.equal(conf.status, 201);

  const forAdmin = (await admin.get("/api/v1/portfolios")).body.portfolios
    .find((p) => p.id === portfolio.id);
  assert.equal(forAdmin.project_count, 3);
  assert.equal(forAdmin.pillar_name, "Digital Core");
  assert.equal(forAdmin.health, "G");
  assert.ok(forAdmin.finance, "admin sees the finance summary object");

  const forViewer = (await viewer.get("/api/v1/portfolios")).body.portfolios
    .find((p) => p.id === portfolio.id);
  assert.equal(forViewer.project_count, 2, "confidential project excluded from viewer's rollup");
  assert.equal(forViewer.finance, null, "finance summary masked without finance access");
  const leaked = JSON.stringify(forViewer);
  assert.ok(!leaked.includes("Secret carve-out"), "no confidential title anywhere in the card");

  const progs = (await viewer.get(`/api/v1/programs?portfolio=${portfolio.id}`)).body.programs;
  assert.equal(progs.length, 1);
  assert.equal(progs[0].project_count, 1);
  assert.equal(progs[0].health, "G");
});
