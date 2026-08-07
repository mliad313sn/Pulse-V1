"use strict";
// E02 — Microsoft Entra ID OIDC adapter (plan §61).
// Full authorization-code flow contract: authorize redirect with state,
// code→token exchange, userinfo claims, mapping to a LOCAL existing user.
//
// Production configuration (all required to enable the adapter):
//   OIDC_ISSUER        e.g. https://login.microsoftonline.com/<tenant>/v2.0
//   OIDC_CLIENT_ID
//   OIDC_CLIENT_SECRET
//   OIDC_REDIRECT_URI  e.g. https://pulse.example.com/api/v1/auth/oidc/callback
//   OIDC_AUTO_PROVISION=true   (optional) JIT-create unknown users as VIEWER
//
// Without a real Entra tenant + app registration this stays dormant (404 on
// the routes) — recorded as BLOCKED_EXTERNAL in docs/execution. The mocked
// flow is fully exercised in tests with an injected fetch + discovery doc.
// Deactivation mapping: a deactivated local user is refused even with valid
// tenant SSO — local `active` wins (§61 "deactivation mapping").
const crypto = require("crypto");
const { query } = require("../../db/pool");

let fetchImpl = global.fetch;
let discoveryCache = null;
function _setFetch(f) { fetchImpl = f; discoveryCache = null; } // test hook

function config() {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI } = process.env;
  if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !OIDC_REDIRECT_URI) return null;
  return {
    issuer: OIDC_ISSUER, clientId: OIDC_CLIENT_ID,
    clientSecret: OIDC_CLIENT_SECRET, redirectUri: OIDC_REDIRECT_URI,
    autoProvision: process.env.OIDC_AUTO_PROVISION === "true",
  };
}
const enabled = () => config() !== null;

async function discovery() {
  if (discoveryCache) return discoveryCache;
  const cfg = config();
  const res = await fetchImpl(`${cfg.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  discoveryCache = await res.json();
  return discoveryCache;
}

async function authorizeUrl(state) {
  const cfg = config();
  const disc = await discovery();
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state,
  });
  return `${disc.authorization_endpoint}?${q}`;
}

async function exchangeCode(code) {
  const cfg = config();
  const disc = await discovery();
  const res = await fetchImpl(disc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed: ${res.status}`);
  const tokens = await res.json();
  if (!tokens.access_token) throw new Error("OIDC token response missing access_token");
  // Claims via the issuer's userinfo endpoint over TLS (server-to-server).
  const ui = await fetchImpl(disc.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!ui.ok) throw new Error(`OIDC userinfo failed: ${ui.status}`);
  return ui.json();
}

// Map tenant claims to a LOCAL user. Email is the join key; local `active`
// always wins so deactivating in PULSE revokes access regardless of SSO.
async function resolveUser(claims) {
  const email = (claims.email || claims.preferred_username || "").toLowerCase().trim();
  if (!email || !email.includes("@")) return { error: "SSO identity has no usable email claim" };
  const { rows } = await query(
    `SELECT id, active, deleted_at FROM users WHERE lower(email) = $1`, [email]);
  const user = rows[0];
  if (user) {
    if (user.deleted_at || !user.active) return { error: "Account is deactivated" };
    return { userId: user.id };
  }
  const cfg = config();
  if (!cfg.autoProvision) return { error: "No PULSE account for this identity — ask an Admin" };
  // JIT provisioning: least privilege (VIEWER), random unusable password.
  const bcrypt = require("bcryptjs");
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
  const ins = await query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'VIEWER', false) RETURNING id`,
    [claims.name || email, email, hash]);
  return { userId: ins.rows[0].id, provisioned: true };
}

const newState = () => crypto.randomBytes(24).toString("hex");

module.exports = { enabled, authorizeUrl, exchangeCode, resolveUser, newState, _setFetch };
