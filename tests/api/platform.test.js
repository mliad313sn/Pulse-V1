"use strict";
// SPM Phase 10 — platform: durable webhook outbox (enqueued in the same
// transaction as the domain change), HMAC-signed delivery, exponential
// backoff, DLQ after MAX_ATTEMPTS, Admin-only management + redrive, and an
// OpenAPI document generated from the live router (never hand-drifted).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const outbox = require("../../src/modules/platform/outbox");

let app, F, admin, infLead, sub, project;
const received = [];
let failNext = 0;

function fakeFetch(url, init) {
  received.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
  if (failNext > 0) { failNext--; return Promise.resolve(new Response("boom", { status: 500 })); }
  return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
}

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead] = await Promise.all([login(app, "admin@test.local"), login(app, "inf@test.local")]);
  outbox.setFetchForTests(fakeFetch);
});
after(async () => { outbox.setFetchForTests(null); await closePool(); });

test("P10 subscriptions are Admin-only and never echo the secret", async () => {
  const denied = await infLead.post("/api/v1/webhooks")
    .send({ url: "https://example.test/hook", secret: "0123456789abcdef01" });
  assert.equal(denied.status, 403);

  const res = await admin.post("/api/v1/webhooks").send({
    url: "https://example.test/hook", secret: "0123456789abcdef01",
    events: ["project.created", "project.stage_changed"], description: "ITSM bridge",
  });
  assert.equal(res.status, 201);
  sub = res.body.subscription;
  assert.equal(sub.secret, undefined, "the signing secret is never returned");

  const list = await admin.get("/api/v1/webhooks");
  assert.equal(list.body.subscriptions.length, 1);
  assert.ok(!JSON.stringify(list.body).includes("0123456789abcdef01"));
});

test("P10 outbox: events enqueue transactionally, deliver signed, and filter by subscription", async () => {
  received.length = 0;
  project = (await infLead.post("/api/v1/projects").send({
    title: "Webhook source", lead_division_id: F.D.INF, sites: [F.S.SGO],
    description: "Integration source project for platform event tests",
  })).body.project;

  // enqueued by the same transaction that created the project — before any delivery
  const { rows: queued } = await query(
    `SELECT event, status FROM webhook_deliveries WHERE subscription_id = $1`, [sub.id]);
  assert.deepEqual(queued.map((q) => [q.event, q.status]), [["project.created", "PENDING"]]);

  const processed = await outbox.processPending();
  assert.equal(processed.find((p) => p.status === "DELIVERED") !== undefined, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].body.event, "project.created");
  assert.equal(received[0].body.data.code, project.code);

  // HMAC-SHA256 over the exact body, with the subscription's secret
  const expected = "sha256=" + crypto.createHmac("sha256", "0123456789abcdef01")
    .update(JSON.stringify(received[0].body)).digest("hex");
  assert.equal(received[0].headers["x-pulse-signature"], expected);
  assert.equal(received[0].headers["x-pulse-event"], "project.created");

  // an event outside the subscription's list is not enqueued for it
  received.length = 0;
  const p = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  await infLead.put(`/api/v1/projects/${project.id}`)
    .send({ sponsor: "CIO", updated_at: p.updated_at });
  const { rows: after_ } = await query(
    `SELECT event FROM webhook_deliveries WHERE subscription_id = $1 AND status = 'PENDING'`, [sub.id]);
  assert.equal(after_.length, 0, "unsubscribed events are never queued");
});

test("P10 retry then DLQ: failures back off, exhaust attempts, and redrive works", async () => {
  const fresh = (await infLead.get(`/api/v1/projects/${project.id}`)).body.project;
  failNext = 99; // every attempt fails
  await infLead.put(`/api/v1/projects/${project.id}`)
    .send({ stage: "INITIATION", sponsor: "CIO", roadmap_pillar: "Network", updated_at: fresh.updated_at });

  const { rows: [d] } = await query(
    `SELECT id FROM webhook_deliveries WHERE event = 'project.stage_changed' ORDER BY id DESC LIMIT 1`);

  for (let i = 1; i <= outbox.MAX_ATTEMPTS; i++) {
    await query(`UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1`, [d.id]); // skip the wait
    await outbox.deliverOne(d.id);
  }
  const { rows: [dead] } = await query(
    `SELECT status, attempts, last_error, next_attempt_at > now() AS backed_off
       FROM webhook_deliveries WHERE id = $1`, [d.id]);
  assert.equal(dead.status, "DEAD", "exhausted deliveries land in the DLQ, not lost and not retried forever");
  assert.equal(dead.attempts, outbox.MAX_ATTEMPTS);
  assert.match(dead.last_error, /HTTP 500/);
  assert.equal(dead.backed_off, true, "backoff is applied, not hot-looped");

  // Admin sees it in the ledger and can redrive it
  const ledger = await admin.get(`/api/v1/webhooks/${sub.id}/deliveries`);
  assert.ok(ledger.body.deliveries.some((x) => x.id === d.id && x.status === "DEAD"));

  failNext = 0;
  const redrive = await admin.post(`/api/v1/webhooks/deliveries/${d.id}/redrive`);
  assert.equal(redrive.status, 200);
  await outbox.deliverOne(d.id);
  const { rows: [ok] } = await query(`SELECT status FROM webhook_deliveries WHERE id = $1`, [d.id]);
  assert.equal(ok.status, "DELIVERED", "redrive recovers a DLQ delivery once the endpoint is healthy");
});

test("P10 OpenAPI is generated from the live router and lists the event catalogue", async () => {
  const res = await admin.get("/api/v1/openapi.json");
  assert.equal(res.status, 200);
  const doc = res.body;
  assert.equal(doc.openapi, "3.1.0");
  for (const p of ["/api/v1/projects", "/api/v1/projects/{projectId}/graph",
    "/api/v1/scenarios/{id}/evaluate", "/api/v1/demands"]) {
    assert.ok(doc.paths[p], `spec documents ${p}`);
  }
  assert.ok(doc.paths["/api/v1/projects/{projectId}"].put.parameters
    .some((x) => x.name === "projectId" && x.in === "path"));
  assert.ok(doc["x-events"].some((e) => e.event === "change_request.decided"));

  const cat = await admin.get("/api/v1/events/catalogue");
  assert.ok(cat.body.events.length >= 7);
});
