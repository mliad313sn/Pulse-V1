"use strict";
// E02 — mocked Entra OIDC flow (plan §61, epic acceptance "mocked Entra flow
// tests"): discovery → authorize redirect with state → callback exchanges the
// code against a FAKE issuer (injected fetch) → local user mapping. Local
// deactivation wins over tenant SSO; unknown identities are refused unless
// auto-provisioning is explicitly on.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { initDb, fixtures, closePool, createApp, query } = require("../helpers");
const oidc = require("../../src/modules/auth/oidc");

let app, F;
let userinfoClaims; // what the fake issuer returns for the current test

const ISSUER = "https://fake.issuer.test/tenant/v2.0";

function fakeFetch(url, opts = {}) {
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  if (String(url).includes("openid-configuration")) {
    return ok({
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
    });
  }
  if (String(url).endsWith("/token")) {
    const params = new URLSearchParams(String(opts.body));
    if (params.get("code") !== "good-code") {
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) });
    }
    assert.equal(params.get("client_id"), "pulse-client");
    assert.equal(params.get("grant_type"), "authorization_code");
    return ok({ access_token: "fake-access-token" });
  }
  if (String(url).endsWith("/userinfo")) {
    assert.equal(opts.headers.Authorization, "Bearer fake-access-token");
    return ok(userinfoClaims);
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

before(async () => {
  await initDb();
  F = await fixtures();
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_CLIENT_ID = "pulse-client";
  process.env.OIDC_CLIENT_SECRET = "pulse-secret";
  process.env.OIDC_REDIRECT_URI = "http://localhost/api/v1/auth/oidc/callback";
  delete process.env.OIDC_AUTO_PROVISION;
  oidc._setFetch(fakeFetch);
  app = createApp();
});
after(async () => {
  for (const k of ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "OIDC_AUTO_PROVISION"]) {
    delete process.env[k];
  }
  oidc._setFetch(global.fetch);
  await closePool();
});

// drive login redirect then callback on one agent (session carries the state)
async function ssoLogin(agent, { tamperState = false, code = "good-code" } = {}) {
  const redir = await agent.get("/api/v1/auth/oidc/login");
  assert.equal(redir.status, 302);
  const url = new URL(redir.headers.location);
  assert.equal(url.origin + url.pathname, `${ISSUER}/authorize`);
  assert.equal(url.searchParams.get("client_id"), "pulse-client");
  let state = url.searchParams.get("state");
  assert.ok(state && state.length >= 32, "CSRF state present");
  if (tamperState) state = "attacker-supplied-state";
  return agent.get(`/api/v1/auth/oidc/callback?code=${code}&state=${state}`);
}

test("E02 mocked flow: known active user signs in via SSO and gets a working session", async () => {
  userinfoClaims = { email: "inf@test.local", name: "Inf Lead" };
  const agent = request.agent(app);
  const cb = await ssoLogin(agent);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.location, "/");
  const me = await agent.get("/api/v1/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "inf@test.local");
  assert.equal(me.body.user.role, "DIVISION_LEAD", "SSO maps to the LOCAL account and role");
});

test("E02 state mismatch and bad code are rejected", async () => {
  userinfoClaims = { email: "inf@test.local" };
  const tampered = await ssoLogin(request.agent(app), { tamperState: true });
  assert.equal(tampered.status, 400);
  const badCode = await ssoLogin(request.agent(app), { code: "stolen-code" });
  assert.equal(badCode.status, 500); // exchange refused by issuer
});

test("E02 deactivation mapping: local deactivation beats valid tenant SSO", async () => {
  await query(`UPDATE users SET active = false WHERE email = 'ops@test.local'`);
  userinfoClaims = { email: "ops@test.local", name: "Ops Lead" };
  const cb = await ssoLogin(request.agent(app));
  assert.equal(cb.status, 403);
  assert.match(cb.body.error, /deactivated/);
});

test("E02 unknown identity: refused by default; JIT-provisioned as VIEWER only when opted in", async () => {
  userinfoClaims = { email: "new.hire@test.local", name: "New Hire" };
  const refused = await ssoLogin(request.agent(app));
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /No PULSE account/);

  process.env.OIDC_AUTO_PROVISION = "true";
  const agent = request.agent(app);
  const cb = await ssoLogin(agent);
  assert.equal(cb.status, 302);
  const me = await agent.get("/api/v1/auth/me");
  assert.equal(me.body.user.role, "VIEWER", "JIT users start at least privilege");
  delete process.env.OIDC_AUTO_PROVISION;
});
