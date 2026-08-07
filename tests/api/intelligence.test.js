"use strict";
// SPM Phase 9 — Pulse Intelligence: key-gated (BLOCKED_EXTERNAL without
// ANTHROPIC_API_KEY), source-grounded (the model sees only caller-authorized
// facts — money masked without the finance flag), and strictly read-only
// (drafts never mutate anything). The Anthropic API is exercised through the
// real SDK with an injected fake fetch — no network.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const intelligence = require("../../src/modules/intelligence/service");

let app, F, admin, infLead, project;
const sentBodies = [];

function fakeFetch(url, init) {
  sentBodies.push({ url: String(url), body: JSON.parse(init.body) });
  return Promise.resolve(new Response(JSON.stringify({
    id: "msg_test", type: "message", role: "assistant",
    model: "claude-opus-5", stop_reason: "end_turn",
    content: [{ type: "text", text: "On track overall [project:1]. Watch the cutover milestone [milestone:1]." }],
    usage: { input_tokens: 500, output_tokens: 60 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
}

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead] = await Promise.all([login(app, "admin@test.local"), login(app, "inf@test.local")]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "AI summary target", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  await infLead.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Cutover weekend", type: "GO_LIVE", due_date: "2026-11-30" });
  await infLead.post(`/api/v1/projects/${project.id}/risks`)
    .send({ title: "Vendor delay risk", probability: 4, impact: 4 });
  await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Hardware", approved: 123456, actual: 4321 });
});
after(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  intelligence.setFetchForTests(null);
  await closePool();
});

test("P9 without a key: honest 503 BLOCKED_EXTERNAL, and /ai/status says disabled", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const status = await admin.get("/api/v1/ai/status");
  assert.equal(status.body.enabled, false);
  const res = await admin.post(`/api/v1/projects/${project.id}/ai/summary`);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "BLOCKED_EXTERNAL");
  assert.match(res.body.error, /ANTHROPIC_API_KEY/);
});

test("P9 draft: source-grounded, cited, finance-masked for non-finance callers, read-only", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  intelligence.setFetchForTests(fakeFetch);

  const before_ = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;

  // non-finance division lead: model must NOT see money
  sentBodies.length = 0;
  const res = await infLead.post(`/api/v1/projects/${project.id}/ai/summary`);
  assert.equal(res.status, 200);
  assert.ok(res.body.draft.includes("On track overall"));
  assert.ok(res.body.citations.some((c) => c.startsWith("milestone:")), "milestone facts cited");
  assert.ok(res.body.citations.some((c) => c.startsWith("risk:")), "risk facts cited");
  assert.match(res.body.disclaimer, /never approves/);

  const sent = sentBodies[0];
  assert.equal(sent.body.model, "claude-opus-5");
  assert.equal(sent.body.thinking.type, "adaptive");
  const payload = JSON.stringify(sent.body);
  assert.ok(payload.includes("Cutover weekend"), "authorized milestone fact reaches the model");
  assert.ok(payload.includes("Vendor delay risk"), "authorized risk fact reaches the model");
  assert.ok(!payload.includes("123,456") && !payload.includes("123456"),
    "money never reaches the model for a caller without the finance flag");

  // admin (finance) does get the budget fact
  sentBodies.length = 0;
  await admin.post(`/api/v1/projects/${project.id}/ai/summary`);
  assert.ok(JSON.stringify(sentBodies[0].body).includes("123,456"),
    "finance-authorized caller's draft is grounded in budget facts");

  // strictly read-only: nothing about the project changed
  const after_ = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  assert.equal(String(after_.updated_at), String(before_.updated_at));
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM audit_log WHERE entity = 'project' AND entity_id = $1`, [project.id]);
  assert.ok(rows[0].n >= 0, "sanity");
  assert.equal(after_.stage, before_.stage, "AI never moved a gate");
});
