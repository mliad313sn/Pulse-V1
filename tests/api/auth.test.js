"use strict";
// Gate P2: auth incl. lockout + forced first-login change; sessions in Postgres
// survive app restart; CSRF enforced.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query, TEST_PASSWORD, request } = require("../helpers");

let app, F;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
});
after(closePool);

test("login succeeds with correct credentials and returns a CSRF token", async () => {
  const s = await login(app, "admin@test.local");
  assert.equal(s.user.role, "ADMIN");
  assert.ok(s.csrf.length >= 32);
});

test("login fails with wrong password (401) and unknown email (401)", async () => {
  let res = await request(app).post("/api/v1/auth/login").send({ email: "admin@test.local", password: "wrong-password" });
  assert.equal(res.status, 401);
  res = await request(app).post("/api/v1/auth/login").send({ email: "ghost@test.local", password: "whatever123" });
  assert.equal(res.status, 401);
});

test("account locks for 15 minutes after 5 failed attempts", async () => {
  for (let i = 0; i < 4; i++) {
    const r = await request(app).post("/api/v1/auth/login").send({ email: "ops@test.local", password: "bad-password" });
    assert.equal(r.status, 401);
  }
  const fifth = await request(app).post("/api/v1/auth/login").send({ email: "ops@test.local", password: "bad-password" });
  assert.equal(fifth.status, 403);
  assert.match(fifth.body.error, /locked/i);
  // correct password is still rejected while locked
  const blocked = await request(app).post("/api/v1/auth/login").send({ email: "ops@test.local", password: TEST_PASSWORD });
  assert.equal(blocked.status, 403);
  // lockout window is ~15 minutes
  const { rows } = await query(`SELECT locked_until FROM users WHERE email = 'ops@test.local'`);
  const minutes = (new Date(rows[0].locked_until) - Date.now()) / 60000;
  assert.ok(minutes > 13 && minutes <= 15, `expected ~15min lockout, got ${minutes}`);
  // unlock for later suites
  await query(`UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'ops@test.local'`);
});

test("forced first-login password change: API blocked until changed, then works", async () => {
  const bcrypt = require("bcryptjs");
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  await query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ('New', 'new@test.local', $1, 'CONTRIBUTOR', true)`,
    [hash]
  );
  const s = await login(app, "new@test.local");
  assert.equal(s.user.mustChangePassword, true);
  // any non-auth API call is blocked
  const blocked = await s.get("/api/v1/projects");
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /password change required/i);
  // short new password rejected (min 10)
  const tooShort = await s.post("/api/v1/auth/change-password").send({ currentPassword: TEST_PASSWORD, newPassword: "short1" });
  assert.equal(tooShort.status, 400);
  // proper change unlocks
  const ok = await s.post("/api/v1/auth/change-password").send({ currentPassword: TEST_PASSWORD, newPassword: "BrandNew-2026!" });
  assert.equal(ok.status, 200);
  const now = await s.get("/api/v1/projects");
  assert.equal(now.status, 200);
  // old password no longer works
  const oldLogin = await request(app).post("/api/v1/auth/login").send({ email: "new@test.local", password: TEST_PASSWORD });
  assert.equal(oldLogin.status, 401);
});

test("sessions live in Postgres and survive an app restart", async () => {
  const s = await login(app, "inf@test.local");
  const cookie = s.agent.jar.getCookie("pulse.sid", { path: "/", domain: "127.0.0.1", secure: false, script: false });
  assert.ok(cookie, "session cookie set");
  // session row exists in the DB store
  const { rows } = await query(`SELECT count(*)::int AS n FROM session`);
  assert.ok(rows[0].n >= 1);
  // "restart": a brand-new app instance (fresh process state, same DB) accepts the old cookie
  const app2 = createApp();
  const res = await request(app2).get("/api/v1/auth/me").set("Cookie", `pulse.sid=${cookie.value}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, "inf@test.local");
});

test("mutating requests without CSRF token are rejected; with token they pass", async () => {
  const s = await login(app, "admin@test.local");
  // raw agent post without the header
  const noToken = await s.agent.post("/api/v1/projects").send({ title: "X", lead_division_id: F.D.INF });
  assert.equal(noToken.status, 403);
  assert.match(noToken.body.error, /csrf/i);
  const wrongToken = await s.agent.post("/api/v1/projects").set("X-CSRF-Token", "bogus").send({ title: "X", lead_division_id: F.D.INF });
  assert.equal(wrongToken.status, 403);
  const withToken = await s.post("/api/v1/projects").send({ title: "CSRF ok", lead_division_id: F.D.INF });
  assert.equal(withToken.status, 201);
});

test("logout destroys the session", async () => {
  const s = await login(app, "viewer@test.local");
  await s.agent.post("/api/v1/auth/logout");
  const res = await s.get("/api/v1/auth/me");
  assert.equal(res.status, 401);
});
