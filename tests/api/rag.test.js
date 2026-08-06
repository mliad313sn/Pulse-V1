"use strict";
// Gate P3: RAG engine behavior through the API — slipped milestone + critical
// roadblock -> RED automatically; silent >30d -> RED; ON_HOLD exempt; tooltip
// carries the 4 signals; recompute fires on child writes.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin;

const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  admin = await login(app, "admin@test.local");
});
after(closePool);

async function freshProject(title, extra = {}) {
  const res = await admin.post("/api/v1/projects").send({ title, lead_division_id: F.D.INF, ...extra });
  assert.equal(res.status, 201);
  return res.body.project;
}
const effectiveRag = (p) => p.rag_override || p.rag_computed;

test("new project with nothing wrong is GREEN with 4 signals present", async () => {
  const p = await freshProject("Clean project");
  const d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_computed, "G");
  const signals = d.body.project.rag_signals_json;
  assert.deepEqual(Object.keys(signals).sort(), ["actions", "freshness", "roadblocks", "schedule"]);
  for (const s of Object.values(signals)) assert.ok(["G", "A", "R"].includes(s.value));
});

test("slipped milestone (1 of 2 = 50%) + critical roadblock -> RED automatically", async () => {
  const p = await freshProject("Slipping project");
  await admin.post(`/api/v1/projects/${p.id}/milestones`)
    .send({ title: "Late one", due_date: daysAgo(5), status: "SLIPPED" });
  await admin.post(`/api/v1/projects/${p.id}/milestones`)
    .send({ title: "Future one", due_date: "2099-01-01" });
  let d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_computed, "R");
  assert.equal(d.body.project.rag_signals_json.schedule.value, "R");
  // add the critical roadblock: still RED, roadblock signal now R too
  const rb = await admin.post(`/api/v1/projects/${p.id}/roadblocks`)
    .send({ title: "Hardware stuck in customs", severity: "CRITICAL" });
  d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_signals_json.roadblocks.value, "R");
  // resolving the roadblock clears that signal on the next write (recompute on child write)
  await admin.put(`/api/v1/roadblocks/${rb.body.roadblock.id}`)
    .send({ status: "RESOLVED", resolution_note: "Cleared", updated_at: rb.body.roadblock.updated_at });
  d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_signals_json.roadblocks.value, "G");
  assert.equal(d.body.project.rag_computed, "R"); // schedule still red
});

test("overdue actions move the action signal G->A->R at the 1 and 4 boundaries", async () => {
  const p = await freshProject("Action heavy");
  for (let i = 0; i < 3; i++) {
    await admin.post(`/api/v1/projects/${p.id}/actions`)
      .send({ title: `Overdue ${i}`, owner_user_id: F.U.admin, due_date: daysAgo(3) });
  }
  let d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_signals_json.actions.value, "A");
  await admin.post(`/api/v1/projects/${p.id}/actions`)
    .send({ title: "Overdue 4", owner_user_id: F.U.admin, due_date: daysAgo(3) });
  d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_signals_json.actions.value, "R");
  assert.equal(d.body.project.rag_computed, "R");
});

test("silent project (>30d no activity of any kind) -> RED; posting an update revives it", async () => {
  const p = await freshProject("Silent project");
  // backdate every trace of activity beyond 30 days
  await query(`UPDATE projects SET created_at = now() - interval '60 days', updated_at = now() - interval '40 days' WHERE id = $1`, [p.id]);
  // trigger a recompute via the admin utility
  await admin.post("/api/v1/rag/recompute-all");
  let d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_computed, "R");
  assert.equal(d.body.project.rag_signals_json.freshness.value, "R");
  assert.match(d.body.project.rag_signals_json.freshness.detail, /silent/i);
  // one status update revives it (that write IS activity)
  await admin.post(`/api/v1/projects/${p.id}/updates`).send({ mood: "ON_TRACK", summary: "Back alive." });
  d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_signals_json.freshness.value, "G");
  assert.equal(d.body.project.rag_computed, "G");
});

test("no status_update for >21d (activity recent) -> AMBER freshness", async () => {
  const p = await freshProject("Quiet narrator");
  await query(`UPDATE projects SET created_at = now() - interval '25 days', updated_at = now() - interval '2 days' WHERE id = $1`, [p.id]);
  await admin.post("/api/v1/rag/recompute-all");
  const d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.rag_signals_json.freshness.value, "A");
  assert.equal(d.body.project.rag_computed, "A");
});

test("ON_HOLD (and RUN/CLOSED) are freshness-exempt even when silent for months", async () => {
  for (const stage of ["ON_HOLD", "RUN"]) {
    const p = await freshProject(`${stage} sleeper`, { stage });
    await query(`UPDATE projects SET created_at = now() - interval '90 days', updated_at = now() - interval '80 days' WHERE id = $1`, [p.id]);
    await admin.post("/api/v1/rag/recompute-all");
    const d = await admin.get(`/api/v1/projects/${p.id}`);
    assert.equal(d.body.project.rag_signals_json.freshness.value, "G", stage);
    assert.equal(d.body.project.rag_computed, "G", stage);
  }
});

test("progress = % milestones DONE, computed never declared", async () => {
  const p = await freshProject("Progressing");
  const m1 = await admin.post(`/api/v1/projects/${p.id}/milestones`).send({ title: "A", due_date: "2099-01-01" });
  await admin.post(`/api/v1/projects/${p.id}/milestones`).send({ title: "B", due_date: "2099-01-01" });
  let d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.progress_pct, 0);
  await admin.put(`/api/v1/milestones/${m1.body.milestone.id}`)
    .send({ status: "DONE", updated_at: m1.body.milestone.updated_at });
  d = await admin.get(`/api/v1/projects/${p.id}`);
  assert.equal(d.body.project.progress_pct, 50);
});

test("manual override shows alongside computed value (no silent green-washing)", async () => {
  const p = await freshProject("Overridden");
  await admin.post(`/api/v1/projects/${p.id}/roadblocks`).send({ title: "Blocker", severity: "CRITICAL" });
  const cur = (await admin.get(`/api/v1/projects/${p.id}`)).body.project;
  assert.equal(cur.rag_computed, "R");
  const res = await admin.put(`/api/v1/projects/${p.id}`).send({
    rag_override: "A",
    rag_override_reason: "Replacement hardware confirmed for Friday; mitigation plan active and tracked daily.",
    updated_at: cur.updated_at,
  });
  assert.equal(res.status, 200);
  // both values visible: computed stays R, override A, reason retrievable
  assert.equal(res.body.project.rag_computed, "R");
  assert.equal(res.body.project.rag_override, "A");
  assert.ok(res.body.project.rag_override_reason.length >= 30);
  assert.equal(effectiveRag(res.body.project), "A");
});
