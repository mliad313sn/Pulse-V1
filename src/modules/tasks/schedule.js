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

// Forward/backward pass on active tasks -> per-task {early, late, slack, critical}
// and the ordered critical path (slack 0, longest chain).
function criticalPath(tasksIn, depsIn) {
  const tasks = tasksIn.filter((t) => t.status !== "CANCELLED");
  const deps = depsIn.filter((d) => !d.deleted_at);
  const { order, preds } = topoSort(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const early = new Map(); // earliest finish offset in days
  for (const id of order) {
    const t = byId.get(id);
    const dur = durationDays(t);
    let start = 0;
    for (const d of preds.get(id)) {
      start = Math.max(start, (early.get(d.predecessor_task_id) || 0) + (d.lag_days || 0));
    }
    early.set(id, start + dur);
  }
  const projectLength = Math.max(0, ...early.values());
  // backward pass
  const succs = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) {
    if (byId.has(d.predecessor_task_id) && byId.has(d.successor_task_id)) {
      succs.get(d.predecessor_task_id).push(d);
    }
  }
  const late = new Map();
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    const dur = durationDays(t);
    let finish = projectLength;
    for (const d of succs.get(id)) {
      finish = Math.min(finish, (late.get(d.successor_task_id) || projectLength) - durationDays(byId.get(d.successor_task_id)) - (d.lag_days || 0));
    }
    late.set(id, finish);
  }
  const result = new Map();
  for (const id of order) {
    const slack = late.get(id) - early.get(id);
    result.set(id, { earlyFinish: early.get(id), lateFinish: late.get(id), slack, critical: slack === 0 });
  }
  const criticalIds = order.filter((id) => result.get(id).critical);
  return { projectLength, tasks: result, criticalIds };
}

module.exports = { topoSort, wouldCycle, criticalPath, durationDays };
