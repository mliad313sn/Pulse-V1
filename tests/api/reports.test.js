"use strict";
// Gate P5: Site Lens scoping; My Actions incl. PM mini-cards for a Contributor-PM;
// rag_history trend after forcing the snapshot job; per-site breakdowns; search.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const { runSnapshot } = require("../../src/jobs/snapshot");

let app, F, admin, contribSGO;
let sgoProject, hgoProject;

const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const daysAhead = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  admin = await login(app, "admin@test.local");
  contribSGO = await login(app, "awa@test.local");

  sgoProject = (await admin.post("/api/v1/projects").send({
    title: "SGO Network", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.contribSGO,
    divisions: [{ division_id: F.D.OPS, role_in_project: "ENGAGED" }],
  })).body.project;
  hgoProject = (await admin.post("/api/v1/projects").send({
    title: "HGO Storage", lead_division_id: F.D.INF, sites: [F.S.HGO],
  })).body.project;

  // SGO content: readiness milestone, roadblock, action owned by SGO staff, GO_LIVE
  await admin.post(`/api/v1/projects/${sgoProject.id}/milestones`)
    .send({ title: "SGO readiness", type: "SITE_READINESS", site_id: F.S.SGO, due_date: daysAhead(20) });
  await admin.post(`/api/v1/projects/${sgoProject.id}/milestones`)
    .send({ title: "SGO cutover", type: "GO_LIVE", due_date: daysAhead(25) });
  await admin.post(`/api/v1/projects/${sgoProject.id}/roadblocks`)
    .send({ title: "SGO cabling issue", severity: "MAJOR" });
  await admin.post(`/api/v1/projects/${sgoProject.id}/actions`)
    .send({ title: "SGO local task", owner_user_id: F.U.contribSGO, due_date: daysAhead(5) });
  // HGO content that must NOT leak into SGO lens
  await admin.post(`/api/v1/projects/${hgoProject.id}/roadblocks`)
    .send({ title: "HGO SAN failure", severity: "CRITICAL" });
});
after(closePool);

test("Site Lens returns exactly that site's items (readiness, roadblocks, actions, GO_LIVEs)", async () => {
  const res = await admin.get("/api/v1/reports/site-lens?site=SGO");
  assert.equal(res.status, 200);
  assert.ok(res.body.readiness.length === 1 && res.body.readiness[0].items.length === 6, "readiness checklist with 6 template items");
  assert.ok(res.body.roadblocks.every((r) => r.project_code === sgoProject.code), "no HGO roadblocks in SGO lens");
  assert.ok(res.body.roadblocks.some((r) => r.title === "SGO cabling issue"));
  assert.ok(res.body.actions.every((a) => a.owner_name === "Awa Diallo"), "actions owned by SGO staff only");
  assert.ok(res.body.goLives.some((g) => g.title === "SGO cutover"));
  // portfolio filtered to SGO = the site's cards
  const cards = await admin.get("/api/v1/projects?site=SGO");
  assert.ok(cards.body.projects.every((p) => p.sites.includes("SGO")));
});

test("My Actions: PM mini-cards appear for a Contributor-PM, plus owned items", async () => {
  const res = await contribSGO.get("/api/v1/my-work");
  assert.equal(res.status, 200);
  assert.ok(res.body.pmProjects.some((p) => p.id === sgoProject.id), "PM mini-card present");
  assert.ok(res.body.actions.some((a) => a.title === "SGO local task"), "owned open action present");
});

test("rag_history trend populated by forcing the snapshot job", async () => {
  const n = await runSnapshot();
  assert.ok(n >= 2, "snapshot covered non-CLOSED projects");
  const { rows } = await query(`SELECT count(*)::int AS n FROM rag_history WHERE snapshot_date = (now() AT TIME ZONE 'utc')::date`);
  assert.equal(rows[0].n, n);
  // re-run same day upserts, no duplicates
  await runSnapshot();
  const again = await query(`SELECT count(*)::int AS n FROM rag_history WHERE snapshot_date = (now() AT TIME ZONE 'utc')::date`);
  assert.equal(again.rows[0].n, n);
  const trend = await admin.get("/api/v1/reports/rag-trend?weeks=4");
  assert.ok(trend.body.rows.length >= 1);
  const today = trend.body.rows[trend.body.rows.length - 1];
  assert.ok(today.g + today.a + today.r === n, "trend buckets add up");
});

test("per-site breakdown and division workload are correct", async () => {
  const site = await admin.get("/api/v1/reports/site-breakdown");
  const sgo = site.body.rows.find((r) => r.code === "SGO");
  const hgo = site.body.rows.find((r) => r.code === "HGO");
  assert.equal(sgo.projects, 1);
  assert.equal(hgo.projects, 1);
  assert.equal(hgo.critical_roadblocks, 1);
  assert.equal(sgo.critical_roadblocks, 0);

  const wl = await admin.get("/api/v1/reports/division-workload");
  const inf = wl.body.rows.find((r) => r.code === "INF");
  assert.equal(inf.led, 2);
  const ops = wl.body.rows.find((r) => r.code === "OPS");
  assert.equal(ops.engaged, 1);

  // site-filtered reports narrow
  const aging = await admin.get("/api/v1/reports/roadblock-aging?site=SGO");
  const total = aging.body.rows.reduce((s, r) => s + r["0_7"] + r["7_30"] + r["30_plus"], 0);
  assert.equal(total, 1, "only the SGO roadblock counted");
});

test("global search finds projects and roadblocks, respecting confidentiality", async () => {
  const conf = (await admin.post("/api/v1/projects").send({
    title: "Hidden Gem", lead_division_id: F.D.DAT, confidential: true,
  })).body.project;
  const adminSearch = await admin.get("/api/v1/search?q=Hidden");
  assert.equal(adminSearch.body.projects.length, 1);
  const contribSearch = await contribSGO.get("/api/v1/search?q=Hidden");
  assert.equal(contribSearch.body.projects.length, 0);
  const rbSearch = await admin.get("/api/v1/search?q=cabling");
  assert.ok(rbSearch.body.roadblocks.some((r) => r.title === "SGO cabling issue"));
  const codeSearch = await admin.get(`/api/v1/search?q=${sgoProject.code}`);
  assert.equal(codeSearch.body.projects.length, 1);
});
