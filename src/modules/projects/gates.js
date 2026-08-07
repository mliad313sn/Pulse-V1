"use strict";
// ITPM360 stage-gate state machine — pure logic, no I/O.
// Governance mapping onto the existing lifecycle (labels shown in the UI):
//   PROPOSAL ≈ IDEA · PLANNING ≈ DESIGN · EXECUTION ≈ BUILD/DEPLOY/RUN · CLOSURE ≈ CLOSED
// Rigid linear flow; ON_HOLD is a parking state reachable from any active stage.
// Gates cannot be skipped; each transition has hard-coded prerequisites, and the
// PLANNING→EXECUTION gate (DESIGN→BUILD) may only be approved by a user flagged
// as Steering Committee.

const GOVERNANCE_LABEL = {
  IDEA: "PROPOSAL", DESIGN: "PLANNING", BUILD: "EXECUTION", DEPLOY: "EXECUTION",
  RUN: "EXECUTION", CLOSED: "CLOSURE", ON_HOLD: "ON HOLD",
};

const FLOW = {
  IDEA: ["DESIGN", "ON_HOLD"],
  DESIGN: ["BUILD", "ON_HOLD"],
  BUILD: ["DEPLOY", "ON_HOLD"],
  DEPLOY: ["RUN", "ON_HOLD"],
  RUN: ["CLOSED", "ON_HOLD"],
  ON_HOLD: ["IDEA", "DESIGN", "BUILD", "DEPLOY", "RUN"], // resume anywhere active
  CLOSED: [],
};

// Hard-coded prerequisites per gate. `project` = field values AFTER the edit;
// `stats` = { milestoneCount, goLiveDone }.
function requirements(fromStage, toStage, project, stats, actor) {
  const reqs = [];
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  if (fromStage === "IDEA" && toStage === "DESIGN") {
    reqs.push(
      { label: "Description filled", met: has(project.description) },
      { label: "Sponsor named", met: has(project.sponsor) },
      { label: "Target date set", met: has(project.target_date) }
    );
  }
  if (fromStage === "DESIGN" && toStage === "BUILD") {
    reqs.push(
      { label: "At least one milestone planned", met: (stats.milestoneCount || 0) > 0 },
      { label: "Approver is Steering Committee", met: actor.is_steering_committee === true }
    );
  }
  if (fromStage === "DEPLOY" && toStage === "RUN") {
    reqs.push({ label: "GO_LIVE milestone DONE", met: stats.goLiveDone === true });
  }
  if (fromStage === "RUN" && toStage === "CLOSED") {
    reqs.push({ label: "Actual end date recorded", met: has(project.actual_end_date) });
  }
  return reqs;
}

// -> { ok, error?, unmet? }
function checkTransition(fromStage, toStage, project, stats, actor) {
  if (fromStage === toStage) return { ok: true };
  const allowed = FLOW[fromStage] || [];
  if (!allowed.includes(toStage)) {
    return { ok: false, error: `Stage gate: ${fromStage} cannot move directly to ${toStage} (allowed: ${allowed.join(", ") || "none"})` };
  }
  const reqs = requirements(fromStage, toStage, project, stats, actor);
  const unmet = reqs.filter((r) => !r.met);
  if (unmet.length) {
    return { ok: false, unmet, error: `Gate requirements not met: ${unmet.map((r) => r.label).join("; ")}` };
  }
  return { ok: true };
}

// For the War Room: what is the next linear stage and where does each requirement stand?
function gateStatus(project, stats, actor) {
  const next = (FLOW[project.stage] || []).find((s) => s !== "ON_HOLD") || null;
  if (!next) return { next: null, requirements: [] };
  return { next, requirements: requirements(project.stage, next, project, stats, actor) };
}

module.exports = { FLOW, GOVERNANCE_LABEL, checkTransition, gateStatus, requirements };
