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
      const type = d.dependency_type || "FS";
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
      const type = d.dependency_type || "FS";
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
      const type = d.dependency_type || "FS";
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

module.exports = { topoSort, wouldCycle, criticalPath, durationDays };
