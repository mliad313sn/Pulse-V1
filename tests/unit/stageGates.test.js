"use strict";
// E05 stage-gate state machine — pure-logic boundaries (plan §12-13).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkTransition, gateStatus, checkOperatingChange, FLOW, STAGES } = require("../../src/modules/projects/gates");

const sc = { is_steering_committee: true };
const noSc = { is_steering_committee: false };
const full = {
  description: "d", sponsor: "s", roadmap_pillar: "Network", project_manager_id: 7,
  target_date: "2026-12-01", actual_end_date: "2026-12-05",
};
const stats = (over = {}) => ({
  milestoneCount: 1, goLiveDone: true, deliverableCount: 1, riskCount: 1,
  openCriticalRoadblocks: 0, openActions: 0, siteCount: 1, ...over,
});

test("linear 7-stage flow, no skips, CLOSED terminal", () => {
  assert.deepEqual(STAGES, ["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN", "CLOSED"]);
  assert.ok(!checkTransition("IDEA", "PLANNING", full, stats(), sc).ok, "IDEA cannot skip to PLANNING");
  assert.ok(!checkTransition("PLANNING", "RUN", full, stats(), sc).ok, "PLANNING cannot skip to RUN");
  assert.ok(!checkTransition("CLOSED", "RUN", full, stats(), sc).ok, "CLOSED terminal");
  assert.deepEqual(FLOW.EXECUTION, ["DEPLOYMENT"]);
});

test("Gate 0 IDEA→INITIATION: description + sponsor + pillar", () => {
  assert.ok(!checkTransition("IDEA", "INITIATION", { ...full, description: "" }, stats(), noSc).ok);
  assert.ok(!checkTransition("IDEA", "INITIATION", { ...full, roadmap_pillar: null }, stats(), noSc).ok);
  assert.ok(checkTransition("IDEA", "INITIATION", full, stats(), noSc).ok);
});

test("Gate 1 INITIATION→PLANNING: PM + target date + site", () => {
  assert.ok(!checkTransition("INITIATION", "PLANNING", { ...full, project_manager_id: null }, stats(), sc).ok);
  assert.ok(!checkTransition("INITIATION", "PLANNING", full, stats({ siteCount: 0 }), sc).ok);
  assert.ok(checkTransition("INITIATION", "PLANNING", full, stats(), noSc).ok);
});

test("Gate 2 PLANNING→EXECUTION: milestone + deliverable + risk AND Steering approver", () => {
  assert.ok(!checkTransition("PLANNING", "EXECUTION", full, stats({ milestoneCount: 0 }), sc).ok);
  assert.ok(!checkTransition("PLANNING", "EXECUTION", full, stats({ deliverableCount: 0 }), sc).ok);
  assert.ok(!checkTransition("PLANNING", "EXECUTION", full, stats({ riskCount: 0 }), sc).ok);
  const denied = checkTransition("PLANNING", "EXECUTION", full, stats(), noSc);
  assert.ok(!denied.ok);
  assert.match(denied.error, /Steering Committee/);
  assert.ok(checkTransition("PLANNING", "EXECUTION", full, stats(), sc).ok);
});

test("Gate 3-5: critical-roadblock block, GO_LIVE done, closure disposition", () => {
  assert.ok(!checkTransition("EXECUTION", "DEPLOYMENT", full, stats({ openCriticalRoadblocks: 1 }), sc).ok);
  assert.ok(checkTransition("EXECUTION", "DEPLOYMENT", full, stats(), noSc).ok);
  assert.ok(!checkTransition("DEPLOYMENT", "RUN", full, stats({ goLiveDone: false }), sc).ok);
  assert.ok(checkTransition("DEPLOYMENT", "RUN", full, stats(), noSc).ok);
  assert.ok(!checkTransition("RUN", "CLOSED", { ...full, actual_end_date: null }, stats(), sc).ok);
  assert.ok(!checkTransition("RUN", "CLOSED", full, stats({ openActions: 2 }), sc).ok, "open actions block closure");
  assert.ok(checkTransition("RUN", "CLOSED", full, stats(), noSc).ok);
});

test("operating status: hold/cancel require reasons; cancelled is terminal", () => {
  assert.ok(!checkOperatingChange("IN_PROGRESS", "ON_HOLD", {}).ok);
  assert.ok(checkOperatingChange("IN_PROGRESS", "ON_HOLD", { hold_reason: "Budget freeze until Q4 review" }).ok);
  assert.ok(!checkOperatingChange("IN_PROGRESS", "CANCELLED", { cancel_reason: "no" }).ok);
  assert.ok(checkOperatingChange("IN_PROGRESS", "CANCELLED", { cancel_reason: "Superseded by group programme" }).ok);
  assert.ok(!checkOperatingChange("CANCELLED", "IN_PROGRESS", {}).ok, "cancelled terminal");
  assert.ok(checkOperatingChange("ON_HOLD", "IN_PROGRESS", {}).ok, "resume from hold is free");
});

test("gateStatus reports next gate and requirement state", () => {
  const gs = gateStatus({ stage: "PLANNING", ...full }, stats({ milestoneCount: 0, riskCount: 0 }), noSc);
  assert.equal(gs.next, "EXECUTION");
  const met = Object.fromEntries(gs.requirements.map((r) => [r.label, r.met]));
  assert.equal(met["At least one milestone planned"], false);
  assert.equal(met["Initial risk register (≥1 risk)"], false);
  assert.equal(met["At least one deliverable defined"], true);
});
