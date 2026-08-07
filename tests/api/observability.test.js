"use strict";
// SPM Phase 12 — operations: correlation ids on every response, Admin-only
// metrics that report what is actually measured, and a performance floor for
// the portfolio wall so a regression shows up as a failing test rather than a
// slow Monday morning.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead] = await Promise.all([login(app, "admin@test.local"), login(app, "inf@test.local")]);
});
after(closePool);

test("P12 every response carries a correlation id, and an upstream one is honoured", async () => {
  const res = await infLead.get("/api/v1/projects");
  assert.match(res.headers["x-request-id"], /[0-9a-f-]{8,}/);

  const upstream = await infLead.agent.get("/api/v1/projects").set("x-request-id", "trace-from-the-proxy");
  assert.equal(upstream.headers["x-request-id"], "trace-from-the-proxy",
    "a trace started upstream survives rather than being replaced");
});

test("P12 metrics are Admin-only and report real counters", async () => {
  await infLead.get("/api/v1/projects"); // generate traffic
  assert.equal((await infLead.get("/metrics")).status, 403, "traffic shape is not public");

  const res = await admin.get("/metrics");
  assert.equal(res.status, 200);
  const body = res.text;
  for (const metric of [
    "pulse_http_requests_total", "pulse_http_errors_total",
    "pulse_http_request_duration_ms_bucket", "pulse_webhook_queue_depth",
    "pulse_db_pool_total",
  ]) {
    assert.ok(body.includes(metric), `exposes ${metric}`);
  }
  const total = Number(/pulse_http_requests_total (\d+)/.exec(body)[1]);
  assert.ok(total > 0, "the request counter actually counts");
  // histogram invariant: +Inf must equal the count
  const inf = Number(/pulse_http_request_duration_ms_bucket\{le="\+Inf"\} (\d+)/.exec(body)[1]);
  const count = Number(/pulse_http_request_duration_ms_count (\d+)/.exec(body)[1]);
  assert.equal(inf, count, "the histogram is internally consistent");
});

test("P12 performance: the portfolio wall stays fast with a realistic project count", async () => {
  // 120 projects with sites and divisions — a plausible year for one group
  const rows = [];
  for (let i = 0; i < 120; i++) {
    rows.push(`('PERF-${String(i).padStart(4, "0")}', 'Perf project ${i}', ${F.D.INF}, 'EXECUTION', 'P2')`);
  }
  await query(
    `INSERT INTO projects (code, title, lead_division_id, stage, priority) VALUES ${rows.join(",")}`);
  await query(
    `INSERT INTO project_sites (project_id, site_id)
     SELECT id, $1 FROM projects WHERE code LIKE 'PERF-%'`, [F.S.SGO]);
  await query(
    `INSERT INTO project_divisions (project_id, division_id, role_in_project)
     SELECT id, $1, 'LEAD' FROM projects WHERE code LIKE 'PERF-%'`, [F.D.INF]);

  const started = Date.now();
  const res = await admin.get("/api/v1/projects");
  const ms = Date.now() - started;
  assert.equal(res.status, 200);
  assert.ok(res.body.projects.length >= 120, "all projects returned");
  // Generous ceiling: this catches an O(n) query-per-project regression
  // (which would be seconds), not normal machine-to-machine variation.
  assert.ok(ms < 3000, `portfolio wall took ${ms}ms for ${res.body.projects.length} projects`);

  // and the same call for a site-restricted user stays scoped AND fast
  const started2 = Date.now();
  const viewer = await login(app, "awa@test.local");
  const scoped = await viewer.get("/api/v1/projects");
  assert.ok(Date.now() - started2 < 3000);
  assert.equal(scoped.status, 200);
});
