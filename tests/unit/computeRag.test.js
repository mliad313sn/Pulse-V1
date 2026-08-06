"use strict";
// Unit tests for the pure RAG engine — every boundary in plan §3.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeRag, gmtToday } = require("../../src/modules/rag/compute");

const TODAY = new Date(Date.UTC(2026, 7, 6)); // 2026-08-06 GMT
const d = (offset) => {
  const x = new Date(TODAY);
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
};
const base = (over = {}) => ({
  stage: "BUILD",
  milestones: [],
  roadblocks: [],
  actions: [],
  lastActivityAt: TODAY,
  lastStatusUpdateAt: TODAY,
  createdAt: d(-100),
  today: TODAY,
  ...over,
});

// ===== schedule signal =====
test("schedule: no milestones -> G, progress 0", () => {
  const r = computeRag(base());
  assert.equal(r.signals.schedule.value, "G");
  assert.equal(r.progressPct, 0);
});

test("schedule: 0% slipped/overdue -> G", () => {
  const r = computeRag(base({
    milestones: [
      { status: "DONE", dueDate: d(-10) },
      { status: "IN_PROGRESS", dueDate: d(10) },
    ],
  }));
  assert.equal(r.signals.schedule.value, "G");
});

test("schedule: exactly 20% (1 of 5) -> A", () => {
  const ms = [{ status: "SLIPPED", dueDate: d(-1) }];
  for (let i = 0; i < 4; i++) ms.push({ status: "IN_PROGRESS", dueDate: d(10) });
  assert.equal(computeRag(base({ milestones: ms })).signals.schedule.value, "A");
});

test("schedule: above 20% (1 of 4 = 25%) -> R", () => {
  const ms = [{ status: "SLIPPED", dueDate: d(-1) }];
  for (let i = 0; i < 3; i++) ms.push({ status: "IN_PROGRESS", dueDate: d(10) });
  assert.equal(computeRag(base({ milestones: ms })).signals.schedule.value, "R");
});

test("schedule: overdue (due < today, not DONE) counts like slipped", () => {
  const ms = [
    { status: "IN_PROGRESS", dueDate: d(-1) }, // overdue
    { status: "NOT_STARTED", dueDate: d(5) },
    { status: "NOT_STARTED", dueDate: d(6) },
    { status: "NOT_STARTED", dueDate: d(7) },
  ];
  assert.equal(computeRag(base({ milestones: ms })).signals.schedule.value, "R"); // 25%
});

test("schedule: DONE milestone past due does NOT count; due exactly today is not overdue", () => {
  const ms = [
    { status: "DONE", dueDate: d(-5) },
    { status: "IN_PROGRESS", dueDate: d(0) }, // today — not < today
  ];
  assert.equal(computeRag(base({ milestones: ms })).signals.schedule.value, "G");
});

// ===== roadblock signal =====
test("roadblocks: OPEN CRITICAL -> R; ESCALATED CRITICAL -> R; IN_PROGRESS CRITICAL -> R", () => {
  for (const status of ["OPEN", "ESCALATED", "IN_PROGRESS"]) {
    const r = computeRag(base({ roadblocks: [{ severity: "CRITICAL", status }] }));
    assert.equal(r.signals.roadblocks.value, "R", `status ${status}`);
  }
});

test("roadblocks: RESOLVED CRITICAL ignored -> G", () => {
  const r = computeRag(base({ roadblocks: [{ severity: "CRITICAL", status: "RESOLVED" }] }));
  assert.equal(r.signals.roadblocks.value, "G");
});

test("roadblocks: active MAJOR -> A; MINOR only -> G", () => {
  assert.equal(computeRag(base({ roadblocks: [{ severity: "MAJOR", status: "OPEN" }] })).signals.roadblocks.value, "A");
  assert.equal(computeRag(base({ roadblocks: [{ severity: "MAJOR", status: "IN_PROGRESS" }] })).signals.roadblocks.value, "A");
  assert.equal(computeRag(base({ roadblocks: [{ severity: "MINOR", status: "OPEN" }] })).signals.roadblocks.value, "G");
});

// ===== action signal =====
test("actions: 0 overdue -> G; 1 -> A; 3 -> A; 4 -> R", () => {
  const overdue = (n) => Array.from({ length: n }, () => ({ status: "OPEN", dueDate: d(-2) }));
  assert.equal(computeRag(base({ actions: [] })).signals.actions.value, "G");
  assert.equal(computeRag(base({ actions: overdue(1) })).signals.actions.value, "A");
  assert.equal(computeRag(base({ actions: overdue(3) })).signals.actions.value, "A");
  assert.equal(computeRag(base({ actions: overdue(4) })).signals.actions.value, "R");
});

test("actions: DONE/CANCELLED past-due never count; future OPEN never counts", () => {
  const r = computeRag(base({
    actions: [
      { status: "DONE", dueDate: d(-9) },
      { status: "CANCELLED", dueDate: d(-9) },
      { status: "OPEN", dueDate: d(3) },
    ],
  }));
  assert.equal(r.signals.actions.value, "G");
});

// ===== freshness signal =====
test("freshness: silent >30 days -> R (boundary: 30d exactly is NOT red, 31d is)", () => {
  const at = (daysAgo) => {
    const x = new Date(TODAY);
    x.setUTCDate(x.getUTCDate() - daysAgo);
    return x;
  };
  assert.equal(computeRag(base({ lastActivityAt: at(30), lastStatusUpdateAt: at(1) })).signals.freshness.value, "G");
  assert.equal(computeRag(base({ lastActivityAt: at(31), lastStatusUpdateAt: at(1) })).signals.freshness.value, "R");
});

test("freshness: no status_update >21 days (but activity recent) -> A", () => {
  const at = (daysAgo) => {
    const x = new Date(TODAY);
    x.setUTCDate(x.getUTCDate() - daysAgo);
    return x;
  };
  assert.equal(computeRag(base({ lastActivityAt: at(2), lastStatusUpdateAt: at(21) })).signals.freshness.value, "G");
  assert.equal(computeRag(base({ lastActivityAt: at(2), lastStatusUpdateAt: at(22) })).signals.freshness.value, "A");
});

test("freshness: never updated measures from creation, not instantly amber", () => {
  const r = computeRag(base({ lastStatusUpdateAt: null, createdAt: d(-5), lastActivityAt: null }));
  assert.equal(r.signals.freshness.value, "G");
  const r2 = computeRag(base({ lastStatusUpdateAt: null, createdAt: d(-25), lastActivityAt: d(-25) }));
  assert.equal(r2.signals.freshness.value, "A");
});

test("freshness: RUN / CLOSED / ON_HOLD exempt even when silent for months", () => {
  const old = d(-90);
  for (const stage of ["RUN", "CLOSED", "ON_HOLD"]) {
    const r = computeRag(base({ stage, lastActivityAt: old, lastStatusUpdateAt: old }));
    assert.equal(r.signals.freshness.value, "G", stage);
    assert.equal(r.signals.freshness.exempt, true, stage);
  }
  // sanity: same dates on BUILD is red
  assert.equal(computeRag(base({ lastActivityAt: old, lastStatusUpdateAt: old })).signals.freshness.value, "R");
});

// ===== overall worst-of + progress =====
test("overall = worst of 4 (single amber signal -> A; any red -> R)", () => {
  const amber = computeRag(base({ roadblocks: [{ severity: "MAJOR", status: "OPEN" }] }));
  assert.equal(amber.rag, "A");
  const red = computeRag(base({
    roadblocks: [{ severity: "MAJOR", status: "OPEN" }],
    actions: Array.from({ length: 5 }, () => ({ status: "OPEN", dueDate: d(-2) })),
  }));
  assert.equal(red.rag, "R");
  assert.equal(computeRag(base()).rag, "G");
});

test("progress = % milestones DONE, rounded", () => {
  const ms = [
    { status: "DONE", dueDate: d(1) },
    { status: "DONE", dueDate: d(1) },
    { status: "IN_PROGRESS", dueDate: d(1) },
  ];
  assert.equal(computeRag(base({ milestones: ms })).progressPct, 67);
});

test("gmtToday returns a GMT-midnight boundary", () => {
  const t = gmtToday(new Date("2026-08-06T23:59:59Z"));
  assert.equal(t.toISOString(), "2026-08-06T00:00:00.000Z");
});
