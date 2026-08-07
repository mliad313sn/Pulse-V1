"use strict";
// ITPM/E05 stage-gate state machine — pure logic, no I/O (plan §12-13).
// Lifecycle (no skips):
//   IDEA → INITIATION → PLANNING → EXECUTION → DEPLOYMENT → RUN → CLOSED
// Operating status is SEPARATE (NOT_STARTED / IN_PROGRESS / ON_HOLD / COMPLETED /
// CANCELLED): ON_HOLD parks a project without destroying lifecycle history;
// CANCELLED is a controlled terminal state requiring a reason.
// Gate 2 (PLANNING → EXECUTION) may only be approved by a Steering Committee member.

const STAGES = ["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN", "CLOSED"];

const FLOW = {
  IDEA: ["INITIATION"],
  INITIATION: ["PLANNING"],
  PLANNING: ["EXECUTION"],
  EXECUTION: ["DEPLOYMENT"],
  DEPLOYMENT: ["RUN"],
  RUN: ["CLOSED"],
  CLOSED: [],
};

// kept for callers that label stages; lifecycle names are now the governance names
const GOVERNANCE_LABEL = Object.fromEntries(STAGES.map((s) => [s, s]));
GOVERNANCE_LABEL.ON_HOLD = "ON HOLD";

// Gate prerequisites (plan §13). `project` = field values AFTER the edit;
// `stats` = { milestoneCount, goLiveDone, deliverableCount, riskCount,
//             openCriticalRoadblocks, openActions, siteCount }.
function requirements(fromStage, toStage, project, stats, actor) {
  const reqs = [];
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  if (fromStage === "IDEA" && toStage === "INITIATION") {
    reqs.push(
      { label: "Problem/opportunity described", met: has(project.description) },
      { label: "Sponsor named", met: has(project.sponsor) },
      { label: "Strategic pillar set", met: has(project.roadmap_pillar) }
    );
  }
  if (fromStage === "INITIATION" && toStage === "PLANNING") {
    reqs.push(
      { label: "Project manager assigned", met: project.project_manager_id != null },
      { label: "Target date set", met: has(project.target_date) },
      { label: "At least one site attached", met: (stats.siteCount || 0) > 0 }
    );
  }
  if (fromStage === "PLANNING" && toStage === "EXECUTION") {
    reqs.push(
      { label: "At least one milestone planned", met: (stats.milestoneCount || 0) > 0 },
      { label: "At least one deliverable defined", met: (stats.deliverableCount || 0) > 0 },
      { label: "Initial risk register (≥1 risk)", met: (stats.riskCount || 0) > 0 },
      { label: "Approver is Steering Committee", met: actor.is_steering_committee === true }
    );
  }
  if (fromStage === "EXECUTION" && toStage === "DEPLOYMENT") {
    reqs.push({
      label: "No open CRITICAL roadblocks",
      met: (stats.openCriticalRoadblocks || 0) === 0,
    });
  }
  if (fromStage === "DEPLOYMENT" && toStage === "RUN") {
    reqs.push({ label: "GO_LIVE milestone DONE", met: stats.goLiveDone === true });
  }
  if (fromStage === "RUN" && toStage === "CLOSED") {
    reqs.push(
      { label: "Actual end date recorded", met: has(project.actual_end_date) },
      { label: "All project actions dispositioned (none OPEN)", met: (stats.openActions || 0) === 0 }
    );
  }
  return reqs;
}

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

function gateStatus(project, stats, actor) {
  const next = (FLOW[project.stage] || [])[0] || null;
  if (!next) return { next: null, requirements: [] };
  return { next, requirements: requirements(project.stage, next, project, stats, actor) };
}

// Operating-status rules (plan §131-132)
const OPERATING = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"];
function checkOperatingChange(from, to, patch) {
  if (from === to) return { ok: true };
  if (!OPERATING.includes(to)) return { ok: false, error: "Unknown operating status" };
  if (from === "CANCELLED") return { ok: false, error: "A cancelled project is terminal — restore requires Admin change control" };
  if (to === "ON_HOLD" && !(typeof patch.hold_reason === "string" && patch.hold_reason.trim().length >= 10)) {
    return { ok: false, error: "Putting a project on hold requires a reason (≥10 characters)" };
  }
  if (to === "CANCELLED" && !(typeof patch.cancel_reason === "string" && patch.cancel_reason.trim().length >= 10)) {
    return { ok: false, error: "Cancelling requires a reason (≥10 characters)" };
  }
  return { ok: true };
}

module.exports = { STAGES, FLOW, GOVERNANCE_LABEL, OPERATING, checkTransition, gateStatus, requirements, checkOperatingChange };
