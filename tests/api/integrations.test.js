"use strict";
// SPM Phase 10 (remainder) — integration contracts and external identity.
// The two properties that matter: an unconfigured adapter says
// BLOCKED_EXTERNAL instead of pretending, and a link is anchored on the
// external system's immutable id so it can never be quietly re-pointed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");

let app, F, admin, infLead, contribSGO, project, task, link;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "Integrated delivery", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  const ws = (await infLead.post(`/api/v1/projects/${project.id}/workstreams`)
    .send({ title: "Build" })).body.workstream;
  task = (await infLead.post(`/api/v1/projects/${project.id}/tasks`)
    .send({ title: "Configure firewall", workstream_id: ws.id })).body.task;
});
after(closePool);

test("P10 adapters declare their contract, and unconfigured ones say BLOCKED_EXTERNAL", async () => {
  const res = await infLead.get("/api/v1/integrations");
  assert.equal(res.status, 200);
  const byKey = Object.fromEntries(res.body.integrations.map((i) => [i.key, i]));

  for (const key of ["jira", "ado", "servicenow", "teams", "powerbi", "erp", "hris", "scim", "local"]) {
    assert.ok(byKey[key], `adapter ${key} is declared`);
    assert.ok(byKey[key].capabilities.length > 0, `${key} declares what it can do`);
    assert.ok(byKey[key].external_id_field, `${key} names its immutable identity field`);
  }

  // nothing is configured in a test deployment — and the API says so plainly
  assert.equal(byKey.jira.state, "BLOCKED_EXTERNAL");
  assert.match(byKey.jira.detail, /JIRA_BASE_URL/);
  assert.deepEqual(byKey.jira.missing, ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]);
  // the built-in adapter is genuinely available
  assert.equal(byKey.local.state, "AVAILABLE");

  // a connectivity test refuses to claim success it cannot back up
  const blocked = await admin.post("/api/v1/integrations/jira/test");
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.code, "BLOCKED_EXTERNAL");
  const ok = await admin.post("/api/v1/integrations/local/test");
  assert.equal(ok.status, 200);

  assert.equal((await infLead.post("/api/v1/integrations/local/test")).status, 403,
    "connectivity testing is an Admin action");
});

test("P10 linking an unconfigured system is refused rather than silently stored", async () => {
  const res = await infLead.post("/api/v1/integrations/links").send({
    system: "jira", external_id: "10042", external_key: "NET-17",
    entity: "task", entity_id: task.id,
  });
  assert.equal(res.status, 503, "a link into a system we cannot reach would be a lie");
  assert.equal(res.body.code, "BLOCKED_EXTERNAL");
});

test("P10 identity mapping is anchored on the immutable external id", async () => {
  const created = await infLead.post("/api/v1/integrations/links").send({
    system: "local", external_id: "SRC-9001", external_key: "NET-17",
    external_url: "https://tracker.example.test/NET-17",
    entity: "task", entity_id: task.id,
  });
  assert.equal(created.status, 201);
  link = created.body.link;
  assert.equal(link.external_id, "SRC-9001");
  assert.equal(link.sync_state, "LINKED");

  // the human-facing key drifting is normal — re-linking updates it
  const renamed = await infLead.post("/api/v1/integrations/links").send({
    system: "local", external_id: "SRC-9001", external_key: "INFRA-4",
    entity: "task", entity_id: task.id,
  });
  assert.equal(renamed.status, 201);
  assert.equal(renamed.body.link.id, link.id, "same link, not a duplicate");
  assert.equal(renamed.body.link.external_key, "INFRA-4");

  // re-pointing at a DIFFERENT external record is refused
  const repointed = await infLead.post("/api/v1/integrations/links").send({
    system: "local", external_id: "SRC-7777", entity: "task", entity_id: task.id,
  });
  assert.equal(repointed.status, 409);
  assert.match(repointed.body.error, /Re-pointing a link at a different external record/);

  const links = await infLead.get(`/api/v1/integrations/links/task/${task.id}`);
  assert.equal(links.body.links.length, 1, "still exactly one link");
  assert.equal(links.body.links[0].external_id, "SRC-9001");

  // unlink is deliberate, and then a new anchor is allowed
  assert.equal((await infLead.delete(`/api/v1/integrations/links/${link.id}`)).status, 200);
  const relinked = await infLead.post("/api/v1/integrations/links").send({
    system: "local", external_id: "SRC-7777", entity: "task", entity_id: task.id,
  });
  assert.equal(relinked.status, 201);
  assert.equal(relinked.body.link.external_id, "SRC-7777");
});

test("P10 linking respects project authorization and concealment", async () => {
  // a contributor without full rights cannot link
  const denied = await contribSGO.post("/api/v1/integrations/links").send({
    system: "local", external_id: "SRC-1", entity: "task", entity_id: task.id,
  });
  assert.equal(denied.status, 403);

  // and a confidential project's records stay invisible, not merely forbidden
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Secret integration", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
  const viewer = await login(app, "viewer@test.local");
  const concealed = await viewer.post("/api/v1/integrations/links").send({
    system: "local", external_id: "SRC-2", entity: "project", entity_id: secret.id,
  });
  assert.equal(concealed.status, 404);
  assert.equal((await viewer.get(`/api/v1/integrations/links/project/${secret.id}`)).status, 404);
});

test("P10 the Admin overview counts real links per system", async () => {
  const res = await admin.get("/api/v1/integrations");
  assert.equal(res.status, 200);
  const local = res.body.integrations.find((i) => i.key === "local");
  assert.equal(local.links.linked, 1, "one live link on the built-in adapter");
  const jira = res.body.integrations.find((i) => i.key === "jira");
  assert.equal(jira.links.linked, 0, "nothing is claimed for a system never wired up");
});
