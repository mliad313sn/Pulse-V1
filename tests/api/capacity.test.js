"use strict";
// SPM Phase 3 — capacity intelligence end to end: skills, forward capacity
// (project + BAU + leave + tentative), skill-gap, and the role-based resource
// request lifecycle — raised before anyone is named, approved by a Division
// Lead, matched automatically, then fulfilled into a real allocation.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, project, skill, request;

const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Fibre rollout", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
});
after(closePool);

test("P3 skills: Admin curates the catalogue, people record proficiency, others need authority", async () => {
  assert.equal((await infLead.post("/api/v1/skills").send({ name: "Nope" })).status, 403);

  skill = (await admin.post("/api/v1/skills")
    .send({ name: "Fibre splicing", category: "Field engineering" })).body.skill;

  // a contributor records their OWN skill
  const own = await contribSGO.put(`/api/v1/users/${F.U.contribSGO}/skills`)
    .send({ skill_id: skill.id, proficiency: 4, years_experience: 6, certified: true,
      certification_name: "FOA CFOT", certification_expires: day(365) });
  assert.equal(own.status, 200);

  // but not someone else's
  const other = await contribSGO.put(`/api/v1/users/${F.U.opsLead}/skills`)
    .send({ skill_id: skill.id, proficiency: 5 });
  assert.equal(other.status, 403);

  // a Division Lead may
  assert.equal((await infLead.put(`/api/v1/users/${F.U.opsLead}/skills`)
    .send({ skill_id: skill.id, proficiency: 2 })).status, 200);

  const listed = await contribSGO.get(`/api/v1/users/${F.U.contribSGO}/skills`);
  assert.equal(listed.body.skills[0].skill_name, "Fibre splicing");
  assert.equal(listed.body.skills[0].certification_expired, false);
});

test("P3 capacity forecast: project + BAU + leave + tentative, day-weighted and explained", async () => {
  // 60% committed project work for the next 60 days
  await infLead.post(`/api/v1/projects/${project.id}/allocations`).send({
    user_id: F.U.contribSGO, start_date: day(0), end_date: day(60), percent: 60, role: "Splicer",
  });
  // 30% standing BAU
  await admin.post("/api/v1/allocations/non-project").send({
    user_id: F.U.contribSGO, allocation_type: "BAU", start_date: day(0), end_date: day(60),
    percent: 30, role: "Service desk rota",
  });
  // 40% tentative on a second project
  const p2 = (await infLead.post("/api/v1/projects").send({
    title: "Backup link", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  await infLead.post(`/api/v1/projects/${p2.id}/allocations`).send({
    user_id: F.U.contribSGO, start_date: day(0), end_date: day(60), percent: 40,
    role: "Splicer", commitment: "TENTATIVE",
  });

  const res = await admin.get("/api/v1/reports/capacity?periods=2");
  assert.equal(res.status, 200);
  const me = res.body.rows.find((r) => r.user_id === F.U.contribSGO);
  const first = me.periods[0];
  assert.ok(first.committed_percent > 0 && first.bau_percent > 0);
  assert.equal(first.tentative_percent > 0, true, "tentative load is reported, not silently ignored");
  assert.equal(me.any_at_risk, true, "60 committed + 30 BAU + 40 tentative exceeds 100%");
  assert.ok(first.contributors.some((c) => c.type === "BAU"));

  // a person books their own leave and it reduces capacity rather than filling it
  await contribSGO.post("/api/v1/allocations/non-project").send({
    user_id: F.U.contribSGO, allocation_type: "LEAVE", start_date: day(0), end_date: day(60), percent: 50,
  });
  const after_ = await admin.get("/api/v1/reports/capacity?periods=1");
  const p = after_.body.rows.find((r) => r.user_id === F.U.contribSGO).periods[0];
  assert.ok(p.capacity_percent < 100, "leave lowers available capacity");
  assert.equal(p.over_allocated, true);
  assert.match(p.explanation, /Over-allocated/);

  // and a contributor cannot book leave for somebody else
  assert.equal((await contribSGO.post("/api/v1/allocations/non-project").send({
    user_id: F.U.opsLead, allocation_type: "LEAVE", start_date: day(0), end_date: day(5), percent: 100,
  })).status, 403);
});

test("P3 resource requests: raised for a role, approved by a lead, matched, then fulfilled", async () => {
  const created = await infLead.post(`/api/v1/projects/${project.id}/resource-requests`).send({
    role: "Fibre splicer", skill_id: skill.id, min_proficiency: 3, percent: 20,
    start_date: day(70), end_date: day(120), site_id: F.S.SGO, notes: "Second crew for the east span",
  });
  assert.equal(created.status, 201);
  request = created.body.request;
  assert.equal(request.status, "PENDING");
  assert.equal(request.fulfilled_user_id, null, "demand exists before anyone is named");

  // skill gap sees the open demand
  const gap = (await admin.get("/api/v1/reports/skill-gap")).body.rows.find((r) => r.skill_id === skill.id);
  assert.equal(gap.open_requests, 1);
  assert.ok(gap.explanation.includes("open request"));

  // a contributor cannot approve
  assert.equal((await contribSGO.post(`/api/v1/resource-requests/${request.id}/decision`)
    .send({ decision: "APPROVED", note: "not mine to approve", updated_at: request.updated_at })).status, 403);

  const decided = await infLead.post(`/api/v1/resource-requests/${request.id}/decision`)
    .send({ decision: "APPROVED", note: "Budgeted in the rollout plan", updated_at: request.updated_at });
  assert.equal(decided.status, 200);
  request = decided.body.request;

  // matching ranks by skill, availability and site — with reasons
  const match = await infLead.get(`/api/v1/resource-requests/${request.id}/candidates`);
  assert.equal(match.status, 200);
  const awa = match.body.candidates.find((c) => c.user_id === F.U.contribSGO);
  assert.ok(awa, "the person with proficiency 4 is a candidate");
  assert.match(awa.reason, /proficiency 4\/5/);
  const ops = match.body.candidates.find((c) => c.user_id === F.U.opsLead);
  assert.equal(ops.eligible, false, "proficiency 2 is below the floor of 3");
  assert.match(ops.reason, /below the required 3/);

  // fulfilment creates the real allocation and closes the request
  const filled = await infLead.post(`/api/v1/resource-requests/${request.id}/fulfil`)
    .send({ user_id: F.U.contribSGO });
  assert.equal(filled.status, 200);
  assert.equal(filled.body.request.status, "FILLED");
  assert.equal(filled.body.allocation.percent, 20);
  assert.equal(filled.body.allocation.allocation_type, "PROJECT");

  const { rows } = await query(
    `SELECT count(*)::int AS n FROM resource_allocations
      WHERE user_id = $1 AND project_id = $2 AND start_date = $3`,
    [F.U.contribSGO, project.id, day(70)]);
  assert.equal(rows[0].n, 1);

  // a filled request cannot be decided again
  const again = await infLead.post(`/api/v1/resource-requests/${request.id}/decision`)
    .send({ decision: "REJECTED", note: "changed my mind", updated_at: filled.body.request.updated_at });
  assert.equal(again.status, 400);
});

test("P3 concealment: resource requests on a confidential project stay invisible", async () => {
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Secret capacity project", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
  const hidden = (await admin.post(`/api/v1/projects/${secret.id}/resource-requests`).send({
    role: "Covert engineer", percent: 50, start_date: day(10), end_date: day(20),
  })).body.request;

  const visible = await contribSGO.get("/api/v1/resource-requests");
  assert.ok(!JSON.stringify(visible.body).includes("Covert engineer"));
  assert.ok(!visible.body.requests.some((r) => r.id === hidden.id));

  const direct = await contribSGO.get(`/api/v1/resource-requests/${hidden.id}/candidates`);
  assert.equal(direct.status, 404, "concealed as not-found, never as forbidden");
});
