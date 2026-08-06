"use strict";
// Pure RAG engine (plan §3). No I/O — fully unit-testable.
// computeRag(aggregate) -> { rag, signals, progressPct }
//
// aggregate = {
//   stage,                       // project stage
//   milestones: [{status, dueDate}],          // active (non-deleted) milestones
//   roadblocks: [{severity, status}],         // active roadblocks
//   actions: [{status, dueDate}],             // active PROJECT actions (project_id set)
//   lastActivityAt,              // Date|string|null — most recent write of any kind
//   lastStatusUpdateAt,          // Date|string|null — most recent status_update
//   createdAt,                   // Date|string — project creation
//   today,                       // Date — GMT midnight boundary
// }

const WORST = { G: 0, A: 1, R: 2 };
const worst = (values) => values.reduce((acc, v) => (WORST[v] > WORST[acc] ? v : acc), "G");

const FRESHNESS_EXEMPT_STAGES = new Set(["RUN", "CLOSED", "ON_HOLD"]);

function toDate(d) {
  if (!d) return null;
  return d instanceof Date ? d : new Date(d);
}

function daysBetween(from, to) {
  return (to.getTime() - from.getTime()) / 86400000;
}

// Schedule: % of milestones SLIPPED or overdue (due < today, not DONE): 0% G; <=20% A; >20% R
function scheduleSignal(milestones, today) {
  const total = milestones.length;
  if (total === 0) return { value: "G", detail: "no milestones" };
  const late = milestones.filter((m) => {
    if (m.status === "DONE") return false;
    if (m.status === "SLIPPED") return true;
    const due = toDate(m.dueDate);
    return due !== null && due < today;
  }).length;
  const pct = (late / total) * 100;
  const value = pct === 0 ? "G" : pct <= 20 ? "A" : "R";
  return { value, detail: `${late}/${total} slipped or overdue (${Math.round(pct)}%)` };
}

// Roadblocks: any active CRITICAL -> R; any active MAJOR -> A; else G
// ("active" = OPEN, IN_PROGRESS or ESCALATED — an escalated or in-progress critical
//  is still a critical; RESOLVED never counts.)
function roadblockSignal(roadblocks) {
  const active = roadblocks.filter((r) => r.status !== "RESOLVED");
  if (active.some((r) => r.severity === "CRITICAL"))
    return { value: "R", detail: "critical roadblock open" };
  if (active.some((r) => r.severity === "MAJOR"))
    return { value: "A", detail: "major roadblock open" };
  return { value: "G", detail: "no blocking roadblocks" };
}

// Actions: overdue OPEN project actions: 0 G; 1-3 A; >3 R (CANCELLED never counts)
function actionSignal(actions, today) {
  const overdue = actions.filter((a) => {
    if (a.status !== "OPEN") return false;
    const due = toDate(a.dueDate);
    return due !== null && due < today;
  }).length;
  const value = overdue === 0 ? "G" : overdue <= 3 ? "A" : "R";
  return { value, detail: `${overdue} overdue action(s)` };
}

// Freshness: R if no activity of ANY kind > 30d; A if no status_update > 21d; else G.
// RUN / CLOSED / ON_HOLD stages are exempt.
// A project with no status_update yet is measured from its creation date, so a
// fresh project is not instantly amber.
function freshnessSignal(stage, lastActivityAt, lastStatusUpdateAt, createdAt, today) {
  if (FRESHNESS_EXEMPT_STAGES.has(stage))
    return { value: "G", detail: `exempt (${stage})`, exempt: true };
  const activity = toDate(lastActivityAt) || toDate(createdAt);
  if (activity && daysBetween(activity, today) > 30)
    return { value: "R", detail: `silent for ${Math.floor(daysBetween(activity, today))} days` };
  const updateRef = toDate(lastStatusUpdateAt) || toDate(createdAt);
  if (updateRef && daysBetween(updateRef, today) > 21)
    return { value: "A", detail: `no status update for ${Math.floor(daysBetween(updateRef, today))} days` };
  return { value: "G", detail: "recent activity" };
}

function computeProgress(milestones) {
  const total = milestones.length;
  if (total === 0) return 0;
  const done = milestones.filter((m) => m.status === "DONE").length;
  return Math.round((done / total) * 100);
}

function computeRag(aggregate) {
  const today = aggregate.today instanceof Date ? aggregate.today : new Date(aggregate.today);
  const signals = {
    schedule: scheduleSignal(aggregate.milestones || [], today),
    roadblocks: roadblockSignal(aggregate.roadblocks || []),
    actions: actionSignal(aggregate.actions || [], today),
    freshness: freshnessSignal(
      aggregate.stage,
      aggregate.lastActivityAt,
      aggregate.lastStatusUpdateAt,
      aggregate.createdAt,
      today
    ),
  };
  const rag = worst(Object.values(signals).map((s) => s.value));
  return { rag, signals, progressPct: computeProgress(aggregate.milestones || []) };
}

// "today" = GMT midnight (plan §0)
function gmtToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

module.exports = { computeRag, gmtToday, worst };
