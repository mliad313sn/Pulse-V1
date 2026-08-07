"use strict";
// SPM Phase 5 — Health 2.0 is weighted and criticality-aware, not a counter.
// These tests pin the properties that make it trustworthy: importance beats
// volume, masked finance redistributes weight instead of scoring zero, every
// dimension names the records that moved it, and each progress methodology
// says where its number came from.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeHealth, computeProgressBy, WEIGHTS } = require("../../src/modules/rag/health");

const TODAY = new Date("2026-06-15T00:00:00Z");
const base = {
  stage: "EXECUTION", operatingStatus: "IN_PROGRESS", governance: "STANDARD",
  today: TODAY, createdAt: "2026-01-01", lastActivityAt: "2026-06-14",
  lastStatusUpdateAt: "2026-06-10", hasBaseline: true,
  milestones: [{ id: 1, title: "Design", type: "STANDARD", status: "DONE", due_date: "2026-03-01" }],
  risks: [], roadblocks: [], benefits: [{ id: 1, title: "Cost saving", status: "ON_TRACK" }],
  allocations: [{ id: 1, user_id: 5, percent: 50 }], overloadedPeople: [],
  pendingChanges: [], overdueCapas: [], tasks: [],
};

test("weights sum to 100 so a score is a real percentage", () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test("a healthy project scores high and says every dimension is green", () => {
  const h = computeHealth(base);
  assert.ok(h.score >= 80, `expected a green score, got ${h.score}`);
  assert.equal(h.band, "G");
  assert.match(h.explanation, /every dimension is green/);
});

test("criticality beats volume: the SAME number of late milestones hurts more when the type matters", () => {
  const plan = (goLiveStatus, checkpointStatus) => [
    { id: 1, title: "Cutover", type: "GO_LIVE", status: goLiveStatus, due_date: "2026-05-01" },
    { id: 2, title: "C1", type: "STANDARD", status: checkpointStatus, due_date: "2026-04-01" },
    { id: 3, title: "C2", type: "STANDARD", status: "DONE", due_date: "2026-03-01" },
  ];
  const lateGoLive = computeHealth({ ...base, milestones: plan("IN_PROGRESS", "DONE") });
  const lateCheckpoint = computeHealth({ ...base, milestones: plan("DONE", "IN_PROGRESS") });

  assert.equal(lateGoLive.dimensions.schedule.contributors.length, 1);
  assert.equal(lateCheckpoint.dimensions.schedule.contributors.length, 1);
  assert.ok(lateGoLive.dimensions.schedule.score < lateCheckpoint.dimensions.schedule.score,
    "one late go-live must outweigh one late standard checkpoint");
  assert.match(lateGoLive.dimensions.schedule.contributors[0].why, /GO_LIVE/);
});

test("risks score by severity and name the records that caused the damage", () => {
  const h = computeHealth({
    ...base,
    risks: [
      { id: 11, title: "Vendor collapse", status: "OPEN", score: 25 },
      { id: 12, title: "Typo in doc", status: "OPEN", score: 2 },
      { id: 13, title: "Closed one", status: "CLOSED", score: 25 },
    ],
    roadblocks: [{ id: 21, title: "Permit missing", severity: "CRITICAL", status: "OPEN" }],
  });
  const d = h.dimensions.risks;
  assert.ok(d.score < 40, `severe risks must bite, got ${d.score}`);
  assert.equal(d.contributors[0].label, "Permit missing");
  assert.ok(d.contributors.some((c) => c.type === "risk" && c.id === 11));
  assert.ok(!d.contributors.some((c) => c.id === 13), "closed risks never count");
});

test("finance without the flag is dropped and its weight redistributed, not scored as bad", () => {
  const masked = computeHealth(base); // no finance supplied
  const withMoney = computeHealth({ ...base, finance: { approved: 100000, actual: 5000 } });
  assert.deepEqual(masked.maskedDimensions, ["finance"]);
  assert.equal(masked.dimensions.finance, undefined);
  assert.ok(withMoney.dimensions.finance.score > 0);
  // a healthy project stays healthy either way — masking must not invent a problem
  assert.equal(masked.band, "G");
});

test("finance flags spending that runs ahead of delivery, and CPI/SPI compound it", () => {
  const burning = computeHealth({
    ...base,
    // half delivered (the second milestone is not yet due, so schedule is fine)
    milestones: [
      { id: 1, title: "Design", type: "STANDARD", status: "DONE", due_date: "2026-03-01" },
      { id: 2, title: "Build", type: "STANDARD", status: "IN_PROGRESS", due_date: "2026-09-01" },
    ],
    finance: { approved: 100000, actual: 90000 }, // 90% of the money for 50% of the work
    evm: { cpi: 0.6, spi: 0.7 },
  });
  assert.ok(burning.dimensions.finance.score < 40);
  assert.match(burning.dimensions.finance.detail, /ahead of delivery/);
  assert.ok(burning.dimensions.finance.contributors.some((c) => c.label.startsWith("CPI")));
});

test("governance notices stalled change requests, overdue CAPAs and missing baselines — LITE more forgivingly", () => {
  const standard = computeHealth({
    ...base, hasBaseline: false,
    pendingChanges: [{ id: 31, title: "Scope add", age_days: 40 }],
    overdueCapas: [{ id: 41, issue: "Retrain crew", due_date: "2026-05-01" }],
  });
  assert.ok(standard.dimensions.governance.score <= 45);
  assert.ok(standard.dimensions.governance.contributors.some((c) => c.type === "change_request"));
  assert.ok(standard.dimensions.governance.contributors.some((c) => c.type === "capa"));

  const lite = computeHealth({ ...base, hasBaseline: false, governance: "LITE" });
  const strict = computeHealth({ ...base, hasBaseline: false, governance: "STANDARD" });
  assert.ok(lite.dimensions.governance.score > strict.dimensions.governance.score,
    "LITE governance is penalised less for a missing baseline");
});

test("confidence falls as the data goes stale, and the drivers explain the score", () => {
  const stale = computeHealth({
    ...base, lastActivityAt: "2026-04-01", lastStatusUpdateAt: "2026-04-01",
  });
  assert.ok(stale.dimensions.confidence.score < 50);
  assert.ok(stale.drivers.some((d) => d.dimension === "confidence"));
  assert.match(stale.explanation, /driven by/);
});

test("progress methodologies each report their own basis", () => {
  const tasks = [
    { id: 1, status: "DONE", estimated_hours: 10, remaining_hours: 0 },
    { id: 2, status: "IN_PROGRESS", estimated_hours: 30, remaining_hours: 15 },
    { id: 3, status: "CANCELLED", estimated_hours: 100, remaining_hours: 100 },
  ];
  const byTask = computeProgressBy("TASK", { tasks });
  assert.equal(byTask.pct, 50, "1 of 2 live tasks done");
  assert.match(byTask.basis, /1\/2 tasks done/);

  const byEffort = computeProgressBy("EFFORT", { tasks });
  assert.equal(byEffort.pct, 63, "25h burned of 40h estimated");
  assert.match(byEffort.basis, /of 40h estimated effort burned/);

  const byCost = computeProgressBy("COST", { finance: { approved: 200000, actual: 50000 } });
  assert.equal(byCost.pct, 25);

  const physical = computeProgressBy("PHYSICAL", { progressManual: 42, progressManualNote: "Survey walkdown" });
  assert.equal(physical.pct, 42);
  assert.equal(physical.basis, "Survey walkdown");

  // physical selected but never entered falls back honestly rather than reporting 0
  const notEntered = computeProgressBy("PHYSICAL", {
    milestones: [{ status: "DONE" }, { status: "OPEN" }],
  });
  assert.equal(notEntered.method, "MILESTONE");
  assert.equal(notEntered.pct, 50);
  assert.match(notEntered.basis, /never entered — falling back/);
});
