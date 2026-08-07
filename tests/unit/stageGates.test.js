"use strict";
// ITPM360 stage-gate state machine — pure-logic boundaries.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkTransition, gateStatus, FLOW, GOVERNANCE_LABEL } = require("../../src/modules/projects/gates");

const sc = { is_steering_committee: true };
const noSc = { is_steering_committee: false };
const full = { description: "d", sponsor: "s", target_date: "2026-12-01", actual_end_date: "2026-12-05" };
const stats = (n = 1, goLive = true) => ({ milestoneCount: n, goLiveDone: goLive });

test("linear flow: each stage only reaches its successor (or ON_HOLD)", () => {
  assert.deepEqual(FLOW.IDEA, ["DESIGN", "ON_HOLD"]);
  assert.ok(!checkTransition("IDEA", "BUILD", full, stats(), sc).ok, "cannot skip IDEA->BUILD");
  assert.ok(!checkTransition("DESIGN", "RUN", full, stats(), sc).ok, "cannot skip DESIGN->RUN");
  assert.ok(!checkTransition("CLOSED", "RUN", full, stats(), sc).ok, "CLOSED is terminal");
  assert.ok(checkTransition("BUILD", "ON_HOLD", full, stats(), noSc).ok, "parking always allowed");
  assert.ok(checkTransition("ON_HOLD", "BUILD", full, stats(), noSc).ok, "resume from hold");
});

test("PROPOSAL->PLANNING (IDEA->DESIGN) needs description, sponsor, target date", () => {
  assert.ok(!checkTransition("IDEA", "DESIGN", { ...full, sponsor: "" }, stats(), sc).ok);
  assert.ok(!checkTransition("IDEA", "DESIGN", { ...full, description: null }, stats(), sc).ok);
  assert.ok(!checkTransition("IDEA", "DESIGN", { ...full, target_date: null }, stats(), sc).ok);
  assert.ok(checkTransition("IDEA", "DESIGN", full, stats(), noSc).ok, "no committee needed at this gate");
});

test("PLANNING->EXECUTION (DESIGN->BUILD) needs milestones AND Steering Committee approver", () => {
  assert.ok(!checkTransition("DESIGN", "BUILD", full, stats(0), sc).ok, "no milestones -> blocked");
  const denied = checkTransition("DESIGN", "BUILD", full, stats(2), noSc);
  assert.ok(!denied.ok, "non-committee approver -> blocked");
  assert.match(denied.error, /Steering Committee/);
  assert.ok(checkTransition("DESIGN", "BUILD", full, stats(2), sc).ok);
});

test("DEPLOY->RUN needs a DONE GO_LIVE; RUN->CLOSED needs actual end date", () => {
  assert.ok(!checkTransition("DEPLOY", "RUN", full, stats(3, false), sc).ok);
  assert.ok(checkTransition("DEPLOY", "RUN", full, stats(3, true), sc).ok);
  assert.ok(!checkTransition("RUN", "CLOSED", { ...full, actual_end_date: null }, stats(), sc).ok);
  assert.ok(checkTransition("RUN", "CLOSED", full, stats(), sc).ok);
});

test("same-stage 'transition' is a no-op; gateStatus reports next gate + requirement state", () => {
  assert.ok(checkTransition("BUILD", "BUILD", {}, stats(0), noSc).ok);
  const gs = gateStatus({ stage: "DESIGN", ...full }, stats(0), noSc);
  assert.equal(gs.next, "BUILD");
  assert.deepEqual(gs.requirements.map((r) => r.met), [false, false]);
});

test("governance labels map onto lifecycle stages", () => {
  assert.equal(GOVERNANCE_LABEL.IDEA, "PROPOSAL");
  assert.equal(GOVERNANCE_LABEL.DESIGN, "PLANNING");
  assert.equal(GOVERNANCE_LABEL.BUILD, "EXECUTION");
  assert.equal(GOVERNANCE_LABEL.CLOSED, "CLOSURE");
});
