"use strict";
// Gate P2: 409 on concurrent edit; unique codes under 20 parallel creates;
// override validation server-side; portfolio site filter narrows cards + KPI inputs.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { initDb, fixtures, login, closePool, createApp, query, TEST_PASSWORD } = require("../helpers");

let app, F, admin;

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  admin = await login(app, "admin@test.local");
});
after(closePool);

test("project codes follow PRJ-YYYY-NNN and increment", async () => {
  const year = new Date().getUTCFullYear();
  const a = await admin.post("/api/v1/projects").send({ title: "First", lead_division_id: F.D.INF });
  const b = await admin.post("/api/v1/projects").send({ title: "Second", lead_division_id: F.D.INF });
  assert.match(a.body.project.code, new RegExp(`^PRJ-${year}-\\d{3}$`));
  const na = Number(a.body.project.code.slice(-3));
  const nb = Number(b.body.project.code.slice(-3));
  assert.equal(nb, na + 1);
});

test("20 parallel creates produce 20 unique codes (FOR UPDATE sequence)", async () => {
  // real parallel HTTP against a live server socket (not supertest queuing)
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const cookieHeader = `pulse.sid=${admin.agent.jar.getCookie("pulse.sid", { path: "/", domain: "127.0.0.1", secure: false, script: false }).value}`;

  const post = (i) =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ title: `Parallel ${i}`, lead_division_id: F.D.OPS });
      const req = http.request(
        {
          port, path: "/api/v1/projects", method: "POST",
          headers: {
            "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
            Cookie: cookieHeader, "X-CSRF-Token": admin.csrf,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        }
      );
      req.on("error", reject);
      req.end(body);
    });

  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post(i)));
  server.close();
  for (const r of results) assert.equal(r.status, 201);
  const codes = results.map((r) => r.body.project.code);
  assert.equal(new Set(codes).size, 20, `codes not unique: ${codes.join(",")}`);
});

test("concurrent edit: stale updated_at -> 409 with current record, no silent overwrite", async () => {
  const created = await admin.post("/api/v1/projects").send({ title: "Contested", lead_division_id: F.D.INF });
  const p = created.body.project;
  // editor A wins
  const first = await admin.put(`/api/v1/projects/${p.id}`).send({ sponsor: "Editor A", updated_at: p.updated_at });
  assert.equal(first.status, 200);
  // editor B holds the stale updated_at -> 409 + current state returned
  const second = await admin.put(`/api/v1/projects/${p.id}`).send({ sponsor: "Editor B", updated_at: p.updated_at });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /changed since you loaded/i);
  assert.equal(second.body.current.sponsor, "Editor A");
  // nothing was overwritten
  const check = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(check.body.project.sponsor, "Editor A");
});

test("RAG override without >=30-char reason rejected server-side; valid override accepted with badge data", async () => {
  const created = await admin.post("/api/v1/projects").send({ title: "Override me", lead_division_id: F.D.SEC });
  const p = created.body.project;
  const short = await admin.put(`/api/v1/projects/${p.id}`)
    .send({ rag_override: "G", rag_override_reason: "too short", updated_at: p.updated_at });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /30 characters/);
  const none = await admin.put(`/api/v1/projects/${p.id}`)
    .send({ rag_override: "G", updated_at: p.updated_at });
  assert.equal(none.status, 400);
  const ok = await admin.put(`/api/v1/projects/${p.id}`)
    .send({ rag_override: "G", rag_override_reason: "Vendor re-baseline agreed on 02 Aug; recovery plan tracked weekly by the PMO.", updated_at: p.updated_at });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.rag_override, "G");
  // create-time enforcement too
  const atCreate = await admin.post("/api/v1/projects")
    .send({ title: "Bad override", lead_division_id: F.D.SEC, rag_override: "R", rag_override_reason: "nope" });
  assert.equal(atCreate.status, 400);
});

test("portfolio site filter narrows the card set (and the KPI inputs with it)", async () => {
  await admin.post("/api/v1/projects").send({ title: "SGO thing", lead_division_id: F.D.INF, sites: [F.S.SGO] });
  await admin.post("/api/v1/projects").send({ title: "HGO thing", lead_division_id: F.D.INF, sites: [F.S.HGO] });
  const all = await admin.get("/api/v1/projects");
  const sgo = await admin.get("/api/v1/projects?site=SGO");
  assert.ok(sgo.body.projects.length < all.body.projects.length);
  assert.ok(sgo.body.projects.every((p) => (p.sites || []).includes("SGO")));
  // stage + rag + division filters compose
  const filtered = await admin.get("/api/v1/projects?site=SGO&stage=IDEA&division=INF");
  assert.ok(filtered.body.projects.every((p) => p.stage === "IDEA"));
});

test("list caps and pagination guards hold (limit clamped to 200)", async () => {
  const res = await admin.get("/api/v1/audit?limit=99999");
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.length <= 200);
});

test("updated_at is required on PUT (optimistic locking is not optional)", async () => {
  const created = await admin.post("/api/v1/projects").send({ title: "No token", lead_division_id: F.D.INF });
  const res = await admin.put(`/api/v1/projects/${created.body.project.id}`).send({ sponsor: "X" });
  assert.equal(res.status, 400);
});
