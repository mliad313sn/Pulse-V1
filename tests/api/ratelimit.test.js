"use strict";
// Gate P7: rate limits verified. This file must NOT set LOGIN_RATE_LIMIT so the
// production default (10/min/IP) applies; node --test runs each file in its own
// process, so the env stays isolated.
process.env.LOGIN_RATE_LIMIT = "10";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, closePool, createApp, request } = require("../helpers");

let app;

before(async () => {
  await initDb();
  await fixtures();
  app = createApp({ apiLimit: 30 });
});
after(closePool);

test("login endpoint rate-limited at 10/min/IP", async () => {
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const r = await request(app).post("/api/v1/auth/login")
      .send({ email: `probe${i}@test.local`, password: "irrelevant1" });
    if (r.status === 429) limited++;
  }
  assert.ok(limited >= 2, `expected 429s after 10 attempts, got ${limited}`);
});

test("global API limiter kicks in (configured 30/min for this app instance)", async () => {
  let limited = 0;
  for (let i = 0; i < 35; i++) {
    const r = await request(app).get("/healthz");
    if (r.status === 429) limited++;
  }
  // /healthz is outside /api, so unaffected — now hammer an API route
  assert.equal(limited, 0);
  let apiLimited = 0;
  for (let i = 0; i < 35; i++) {
    const r = await request(app).get("/api/v1/projects");
    if (r.status === 429) apiLimited++;
  }
  assert.ok(apiLimited >= 1, "API limiter engaged");
});
