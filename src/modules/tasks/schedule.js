"use strict";
// E07 pure scheduling utilities (plan §184): cycle detection + critical path.
// Model: FS dependencies with lag drive the forward pass; durations come from
// planned dates (inclusive days) with a 1-day floor. No I/O — unit-testable.

function durationDays(task) {
  if (task.planned_start && task.planned_finish) {
    const d = Math.round((new Date(task.planned_finish) - new Date(task.planned_start)) / 86400000) + 1;
    return Math.max(d, 1);
  }
  return 1;
}

// -> { order } or throws Error("cycle") listing the offending tasks
function topoSort(tasks, deps) {
  const ids = new Set(tasks.map((t) => t.id));
  const preds = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) {
    if (!ids.has(d.predecessor_task_id) || !ids.has(d.successor_task_id)) continue;
    preds.get(d.successor_task_id).push(d);
  }
  const inDeg = new Map(tasks.map((t) => [t.id, preds.get(t.id).length]));
  const queue = tasks.filter((t) => inDeg.get(t.id) === 0).map((t) => t.id);
  const order = [];
  const succs = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) {
    if (ids.has(d.predecessor_task_id) && ids.has(d.successor_task_id)) {
      succs.get(d.predecessor_task_id).push(d.successor_task_id);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of succs.get(id)) {
      inDeg.set(s, inDeg.get(s) - 1);
      if (inDeg.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== tasks.length) {
    const stuck = tasks.filter((t) => !order.includes(t.id)).map((t) => t.id);
    const err = new Error(`Dependency cycle detected involving tasks: ${stuck.join(", ")}`);
    err.cycle = stuck;
    throw err;
  }
  return { order, preds };
}

// Would adding predecessor->successor create a cycle?
function wouldCycle(tasks, deps, predecessorId, successorId) {
  try {
    topoSort(tasks, [...deps, { predecessor_task_id: predecessorId, successor_task_id: successorId }]);
    return false;
  } catch {
    return true;
  }
}

// Phase 0 — full CPM pass honoring FS/SS/FF/SF with lag (negative lag = lead):
// ES/EF/LS/LF per task, total float (slack), free float, critical and
// near-critical (0 < slack <= NEAR_CRITICAL_DAYS) sets.
const NEAR_CRITICAL_DAYS = 2;

function criticalPath(tasksIn, depsIn) {
  const tasks = tasksIn.filter((t) => t.status !== "CANCELLED");
  const deps = depsIn.filter((d) => !d.deleted_at);
  const { order, preds } = topoSort(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // forward pass — earliest start/finish
  const ES = new Map(), EF = new Map();
  for (const id of order) {
    const dur = durationDays(byId.get(id));
    let es = 0;
    for (const d of preds.get(id)) {
      const p = d.predecessor_task_id, lag = d.lag_days || 0;
      const type = d.dep_type || d.dependency_type || "FS";
      let req;
      if (type === "SS") req = ES.get(p) + lag;            // start after pred starts
      else if (type === "FF") req = EF.get(p) + lag - dur; // finish after pred finishes
      else if (type === "SF") req = ES.get(p) + lag - dur; // finish after pred starts
      else req = EF.get(p) + lag;                          // FS: start after pred finishes
      es = Math.max(es, req);
    }
    es = Math.max(es, 0);
    ES.set(id, es);
    EF.set(id, es + dur);
  }
  const projectLength = Math.max(0, ...EF.values());

  // backward pass — latest start/finish (constraints inverted per type)
  const succs = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) {
    if (byId.has(d.predecessor_task_id) && byId.has(d.successor_task_id)) {
      succs.get(d.predecessor_task_id).push(d);
    }
  }
  const LF = new Map(), LS = new Map();
  for (const id of [...order].reverse()) {
    const dur = durationDays(byId.get(id));
    let lf = projectLength;
    for (const d of succs.get(id)) {
      const s = d.successor_task_id, lag = d.lag_days || 0;
      const type = d.dep_type || d.dependency_type || "FS";
      let cap;
      if (type === "SS") cap = LS.get(s) - lag + dur;      // pred LS <= succ LS - lag
      else if (type === "FF") cap = LF.get(s) - lag;       // pred LF <= succ LF - lag
      else if (type === "SF") cap = LF.get(s) - lag + dur; // pred LS <= succ LF - lag
      else cap = LS.get(s) - lag;                          // FS: pred LF <= succ LS - lag
      lf = Math.min(lf, cap);
    }
    LF.set(id, lf);
    LS.set(id, lf - dur);
  }

  // free float — how far a task can slip without moving ANY successor's earliest dates
  const result = new Map();
  for (const id of order) {
    const slack = LF.get(id) - EF.get(id);
    let free = projectLength - EF.get(id);
    for (const d of succs.get(id)) {
      const s = d.successor_task_id, lag = d.lag_days || 0;
      const type = d.dep_type || d.dependency_type || "FS";
      let gap;
      if (type === "SS") gap = ES.get(s) - (ES.get(id) + lag);
      else if (type === "FF") gap = EF.get(s) - (EF.get(id) + lag);
      else if (type === "SF") gap = EF.get(s) - (ES.get(id) + lag);
      else gap = ES.get(s) - (EF.get(id) + lag);
      free = Math.min(free, gap);
    }
    result.set(id, {
      earlyStart: ES.get(id), earlyFinish: EF.get(id),
      lateStart: LS.get(id), lateFinish: LF.get(id),
      slack, freeFloat: Math.max(0, free),
      critical: slack === 0,
      nearCritical: slack > 0 && slack <= NEAR_CRITICAL_DAYS,
    });
  }
  const criticalIds = order.filter((id) => result.get(id).critical);
  const nearCriticalIds = order.filter((id) => result.get(id).nearCritical);
  return { projectLength, tasks: result, criticalIds, nearCriticalIds };
}

// Phase 2 — schedule quality checks: pure findings a planner acts on.
function qualityChecks(tasks, deps) {
  const findings = [];
  const active = tasks.filter((t) => t.status !== "CANCELLED" && t.status !== "DONE");
  const linked = new Set();
  for (const d of deps) {
    if (d.deleted_at) continue;
    linked.add(d.predecessor_task_id);
    linked.add(d.successor_task_id);
  }
  const children = new Map();
  for (const t of tasks) {
    if (t.parent_task_id) {
      if (!children.has(t.parent_task_id)) children.set(t.parent_task_id, []);
      children.get(t.parent_task_id).push(t);
    }
  }
  for (const t of active) {
    const isSummary = children.has(t.id);
    if (!t.planned_start || !t.planned_finish) {
      findings.push({ task_id: t.id, check: "missing_dates", detail: `"${t.title}" has no planned dates — invisible to the critical path` });
    }
    if (!isSummary && !linked.has(t.id) && active.length > 1) {
      findings.push({ task_id: t.id, check: "orphan", detail: `"${t.title}" has no dependencies in or out — its sequencing is unmanaged` });
    }
    if (t.planned_finish && new Date(t.planned_finish) < new Date() && t.status !== "IN_PROGRESS") {
      findings.push({ task_id: t.id, check: "past_due_not_started", detail: `"${t.title}" planned finish is in the past but it is ${t.status}` });
    }
    if (t.estimated_hours != null && t.remaining_hours != null && Number(t.remaining_hours) > Number(t.estimated_hours) * 1.5) {
      findings.push({ task_id: t.id, check: "effort_blowout", detail: `"${t.title}" remaining ${t.remaining_hours}h exceeds 150% of estimate ${t.estimated_hours}h` });
    }
  }
  const isoQ = (v) => v ? new Date(v).toISOString().slice(0, 10) : null;
  for (const [pid, kids] of children) {
    const parent = tasks.find((t) => t.id === pid);
    if (!parent || parent.deleted_at) continue;
    const starts = kids.map((k) => isoQ(k.planned_start)).filter(Boolean).sort();
    const ends = kids.map((k) => isoQ(k.planned_finish)).filter(Boolean).sort();
    if (parent.planned_start && starts.length && isoQ(parent.planned_start) > starts[0]) {
      findings.push({ task_id: pid, check: "summary_window", detail: `Summary "${parent.title}" starts after its earliest child` });
    }
    if (parent.planned_finish && ends.length && isoQ(parent.planned_finish) < ends[ends.length - 1]) {
      findings.push({ task_id: pid, check: "summary_window", detail: `Summary "${parent.title}" ends before its latest child` });
    }
  }
  return findings;
}

// Summary (WBS parent) rollup: computed window + effort from children.
function rollupSummaries(tasks) {
  const iso = (v) => v ? new Date(v).toISOString().slice(0, 10) : null;
  const children = new Map();
  for (const t of tasks) {
    if (t.parent_task_id) {
      if (!children.has(t.parent_task_id)) children.set(t.parent_task_id, []);
      children.get(t.parent_task_id).push(t);
    }
  }
  const rollup = new Map();
  for (const [pid, kids] of children) {
    const starts = kids.map((k) => iso(k.planned_start)).filter(Boolean).sort();
    const ends = kids.map((k) => iso(k.planned_finish)).filter(Boolean).sort();
    const sum = (f) => kids.reduce((s, k) => s + (k[f] != null ? Number(k[f]) : 0), 0);
    const done = kids.filter((k) => k.status === "DONE").length;
    rollup.set(pid, {
      computed_start: starts[0] || null,
      computed_finish: ends[ends.length - 1] || null,
      children: kids.length,
      children_done: done,
      effort_hours: sum("estimated_hours"),
      remaining_hours: sum("remaining_hours"),
    });
  }
  return rollup;
}

module.exports = { topoSort, wouldCycle, criticalPath, durationDays, qualityChecks, rollupSummaries };
