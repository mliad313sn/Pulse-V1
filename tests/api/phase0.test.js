"use strict";
// Phase 0 — Trust & Correctness: fail-closed config, scoped idempotency,
// FX-safe money aggregation, magic-byte upload validation, document
// classification enforcement, health/readiness probes.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

process.env.ATTACHMENTS_DIR = path.join(os.tmpdir(), `pulse-p0-test-${process.pid}`);

let app, F, admin, infLead, contribSGO, viewer, project;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  project = (await infLead.post("/api/v1/projects").send({
    title: "FX project", lead_division_id: F.D.INF, sites: [F.S.SGO],
    project_manager_id: F.U.contribSGO,
  })).body.project;
});
after(closePool);

test("P0 config: production refuses to start without a real SESSION_SECRET", () => {
  const prevEnv = process.env.NODE_ENV, prevSecret = process.env.SESSION_SECRET;
  delete require.cache[require.resolve("../../src/config")];
  process.env.NODE_ENV = "production";
  delete process.env.SESSION_SECRET;
  const cfg = require("../../src/config");
  assert.throws(() => cfg.sessionSecret(), /SESSION_SECRET is required in production/);
  process.env.SESSION_SECRET = "a-real-production-secret-42";
  assert.equal(cfg.sessionSecret(), "a-real-production-secret-42");
  process.env.NODE_ENV = prevEnv;
  if (prevSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prevSecret;
  delete require.cache[require.resolve("../../src/config")];
});

test("P0 probes: liveness always up; readiness reflects the database", async () => {
  assert.equal((await admin.get("/healthz")).status, 200);
  const ready = await admin.get("/readyz");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.db, "up");
});

test("P0 idempotency scoping: same op id from ANOTHER user is a fresh operation; reuse for a different body is 409", async () => {
  const opId = "shared-op-id-123";
  // infLead posts a status update with the op id
  const r1 = await infLead.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "ON_TRACK", summary: "Week 1 fine" });
  assert.equal(r1.status, 201);

  // exact replay by the SAME user → deduped
  const r2 = await infLead.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "ON_TRACK", summary: "Week 1 fine" });
  assert.equal(r2.body.duplicate, true);

  // same op id, same user, DIFFERENT body → hard 409, nothing applied
  const r3 = await infLead.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "AT_RISK", summary: "Totally different content" });
  assert.equal(r3.status, 409);

  // same op id from a DIFFERENT user → their operation goes through
  const r4 = await contribSGO.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "WATCH", summary: "Awa's own update" });
  assert.equal(r4.status, 201, "another user's operation is never swallowed as someone else's duplicate");

  const { rows } = await query(
    `SELECT count(*)::int AS n FROM status_updates WHERE project_id = $1`, [project.id]);
  assert.equal(rows[0].n, 2, "exactly two updates exist: one per user");
});

test("P0 idempotency race: a concurrent replay burst applies the op exactly once", async () => {
  // The reconnect case: the client fires the queued op again before the first
  // copy has finished. The op id is reserved atomically, so only one applies.
  const opId = "burst-op-id-777";
  const send = () => infLead.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "WATCH", summary: "Replayed during reconnect" });

  const results = await Promise.all([send(), send(), send(), send()]);
  const applied = results.filter((r) => r.status === 201);
  const duplicates = results.filter((r) => r.status === 200 && r.body.duplicate === true);
  assert.equal(applied.length, 1, "exactly one copy of a concurrently replayed op is applied");
  assert.equal(duplicates.length, 3, "the rest are answered as duplicates, not applied");

  const { rows } = await query(
    `SELECT count(*)::int AS n FROM status_updates
      WHERE project_id = $1 AND summary = 'Replayed during reconnect'`, [project.id]);
  assert.equal(rows[0].n, 1, "the database holds exactly one row for the burst");
});

test("P0 idempotency: a failed op releases its id so an honest retry can succeed", async () => {
  const opId = "retry-after-failure-42";
  const bad = await infLead.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "NOT_A_MOOD", summary: "invalid payload" });
  assert.ok(bad.status >= 400, "the op failed");

  // same id, corrected payload — must be allowed through, not stuck as a duplicate
  const good = await infLead.post(`/api/v1/projects/${project.id}/updates`)
    .set("X-Client-Op-Id", opId)
    .send({ mood: "ON_TRACK", summary: "Corrected and retried" });
  assert.equal(good.status, 201, "a reservation for a failed op is released");
});

test("P0 multicurrency: totals convert to base currency; unknown currency refused with guidance", async () => {
  await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Hardware", currency: "USD", approved: 100000, forecast: 100000 });
  await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Telecom", currency: "XOF", approved: 10000000, forecast: 10000000 });
  const fin = await admin.get(`/api/v1/projects/${project.id}/financials`);
  // 100000 USD + 10,000,000 XOF * 0.00165 = 116,500 USD
  assert.equal(fin.body.summary.approved, 116500);
  assert.equal(fin.body.summary.currency, "USD");
  assert.equal(fin.body.summary.converted, true);
  assert.deepEqual(fin.body.summary.source_currencies.sort(), ["USD", "XOF"]);
  assert.match(fin.body.summary.explanation, /converted from/);

  const bad = await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Travel", currency: "ZZZ", approved: 5 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no FX rate configured/i);

  // Admin can add a rate; non-admin cannot
  assert.equal((await infLead.put("/api/v1/fx-rates/MAD").send({ rate: 0.1 })).status, 403);
  assert.equal((await admin.put("/api/v1/fx-rates/MAD").send({ rate: 0.1 })).status, 200);
  const ok = await admin.post(`/api/v1/projects/${project.id}/budget-lines`)
    .send({ category: "Travel", currency: "MAD", approved: 1000, forecast: 1000 });
  assert.equal(ok.status, 201);
});

test("P0 attachments: magic bytes beat extensions; CONFIDENTIAL class is FULL-access only", async () => {
  // an executable renamed .pdf is refused by content inspection
  const fake = await contribSGO.post(`/api/v1/projects/${project.id}/attachments`)
    .attach("file", Buffer.from("MZ\x90\x00 not a real pdf"), "invoice.pdf");
  assert.equal(fake.status, 400);
  assert.match(fake.body.error, /content does not match/i);

  // scanner contract: reject-all test mode blocks the upload
  process.env.SCAN_MODE = "reject-all";
  const virus = await contribSGO.post(`/api/v1/projects/${project.id}/attachments`)
    .attach("file", Buffer.from("%PDF-1.4 payload"), "scan-me.pdf");
  assert.equal(virus.status, 400);
  assert.match(virus.body.error, /malware/i);
  process.env.SCAN_MODE = "off";

  // confidential-classified document on a NORMAL project: PM (FULL) sees it, viewer does not
  const conf = await contribSGO.post(`/api/v1/projects/${project.id}/attachments`)
    .field("classification", "CONFIDENTIAL")
    .attach("file", Buffer.from("%PDF-1.4 salary bands"), "hr-annex.pdf");
  assert.equal(conf.status, 201);
  const pmList = await contribSGO.get(`/api/v1/projects/${project.id}/attachments`);
  assert.ok(pmList.body.attachments.some((a) => a.filename === "hr-annex.pdf"));
  const vList = await viewer.get(`/api/v1/projects/${project.id}/attachments`);
  assert.ok(!JSON.stringify(vList.body).includes("hr-annex"), "classified doc absent from viewer list");
  const vGet = await viewer.get(`/api/v1/attachments/${conf.body.attachment.id}`);
  assert.equal(vGet.status, 404, "classified download concealed, not 403");
});
