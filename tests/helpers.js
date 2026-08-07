"use strict";
// Shared test harness: dedicated test database (DATABASE_URL_TEST), migrated once
// and truncated per suite; fixture users; login helper carrying session + CSRF.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL_TEST =
  process.env.DATABASE_URL_TEST || "postgres://pulse:pulse@localhost:5432/pulse_test";
if (!process.env.LOGIN_RATE_LIMIT) process.env.LOGIN_RATE_LIMIT = "1000"; // most suites log in a lot

const bcrypt = require("bcryptjs");
const request = require("supertest");
const { pool, query } = require("../src/db/pool");
const { migrate } = require("../src/db/migrate");
const { createApp } = require("../src/server");

// one cheap-but-real hash reused for all fixture users (cost 12 verified in auth tests)
const TEST_PASSWORD = "TestPass-2026!";
let passwordHashPromise = null;
const getHash = () => (passwordHashPromise ||= bcrypt.hash(TEST_PASSWORD, 12));

async function initDb() {
  await migrate();
  await query(`TRUNCATE reminder_log, task_dependencies, tasks, workstreams, meeting_minutes_versions, notification_deliveries, capas, risks, sync_ops, raci_assignments, deliverables, stage_transitions, audit_log, rag_history, notifications, readiness_items, status_updates,
    decisions, actions, meeting_items, meeting_attendees, meetings, roadblocks, milestones,
    project_sites, project_divisions, projects, users, sequences, sites, divisions, session,
    schema_migrations RESTART IDENTITY CASCADE`);
  // re-record migration (truncate wiped the ledger; schema itself persists)
  await query(`INSERT INTO schema_migrations (name) VALUES ('001_init.sql'), ('002_ecosystem.sql'), ('003_risk_capa_channels.sql'), ('004_minutes_versions.sql'), ('005_lifecycle.sql'), ('006_workstreams_tasks.sql'), ('007_reminders.sql') ON CONFLICT DO NOTHING`);
}

// Standard fixture: divisions, sites, one user per role + a second contributor
async function fixtures() {
  const hash = await getHash();
  const D = {}, S = {}, U = {};
  for (const [code, name] of [["INF", "Infrastructure"], ["OPS", "Operations"], ["BAP", "Business Apps"],
    ["DAT", "Data Insight"], ["SEC", "Information Security"], ["EAR", "Enterprise Architecture"], ["GRP", "Group IT"]]) {
    const r = await query(`INSERT INTO divisions (code, name) VALUES ($1,$2) RETURNING id`, [code, name]);
    D[code] = r.rows[0].id;
  }
  for (const [code, name] of [["SGO", "Sabodala"], ["HGO", "Houndé"], ["ITY", "Ity"], ["SML", "Sissingué"],
    ["MGO", "Mana"], ["KGO", "Kalana"], ["DKR", "Dakar"], ["ABJ", "Abidjan"], ["OUA", "Ouaga"], ["GROUP", "Group"]]) {
    const r = await query(`INSERT INTO sites (code, name) VALUES ($1,$2) RETURNING id`, [code, name]);
    S[code] = r.rows[0].id;
  }
  const mk = async (key, name, email, role, div, site, mustChange = false) => {
    const r = await query(
      `INSERT INTO users (name, email, password_hash, role, division_id, site_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, email, hash, role, div ? D[div] : null, site ? S[site] : null, mustChange]
    );
    U[key] = r.rows[0].id;
  };
  await mk("admin", "Admin", "admin@test.local", "ADMIN", "GRP", null);
  await mk("infLead", "Inf Lead", "inf@test.local", "DIVISION_LEAD", "INF", null);
  await mk("opsLead", "Ops Lead", "ops@test.local", "DIVISION_LEAD", "OPS", null);
  await mk("bapLead", "Bap Lead", "bap@test.local", "DIVISION_LEAD", "BAP", null);
  await mk("contribSGO", "Awa Diallo", "awa@test.local", "CONTRIBUTOR", "OPS", "SGO");
  await mk("contribHGO", "Ibrahim Traore", "ibra@test.local", "CONTRIBUTOR", "OPS", "HGO");
  await mk("contribDAT", "Marie Kouassi", "marie@test.local", "CONTRIBUTOR", "DAT", "DKR");
  await mk("viewer", "CIO", "viewer@test.local", "VIEWER", "GRP", null);
  return { D, S, U };
}

// Login returning a session-scoped client that auto-attaches the CSRF header
async function login(app, email, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken;
  const wrap = (method) => (url) => agent[method](url).set("X-CSRF-Token", csrf);
  return {
    agent, csrf, user: res.body.user,
    get: (url) => agent.get(url),
    post: wrap("post"), put: wrap("put"), delete: wrap("delete"),
  };
}

async function closePool() {
  await pool.end();
}

module.exports = { initDb, fixtures, login, closePool, createApp, query, TEST_PASSWORD, request };
