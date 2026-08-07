"use strict";
// E07 pure scheduling utilities (plan §184): cycle detection + critical path.
// Model: FS dependencies with lag drive the forward pass; durations come from
// planned dates (inclusive days) with a 1-day floor. No I/O — unit-testable.

const cal = require("./calendar");

// Duration = how much WORK a task holds, measured in working days.
//
// Deliberately computed against the calendar's normal working WEEK and NOT its
// exceptions. Work content must not depend on where a holiday happens to fall:
// a three-day task stays three days of work when a public holiday lands in the
// middle — the holiday pushes the finish out (handled by the offset→date
// mapping, which does honour exceptions) instead of silently deleting a day of
// work. Without a calendar this keeps the original calendar-day behaviour.
function durationDays(task, calendar) {
  if (task.planned_start && task.planned_finish) {
    if (calendar) {
      const weekOnly = { ...cal.normalize(calendar), exceptions: new Map() };
      return Math.max(cal.workingDaysBetween(task.planned_start, task.planned_finish, weekOnly), 1);
    }
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

// options: { calendar, projectStart } — with both supplied the pass runs in
// working days and returns real dates alongside the offsets; date constraints
// (MUST_START_ON, START_NO_EARLIER_THAN, FINISH_NO_LATER_THAN, …) are honoured
// and any that cannot be met is reported rather than silently ignored.
function criticalPath(tasksIn, depsIn, options = {}) {
  const calendar = options.calendar || null;
  const tasks = tasksIn.filter((t) => t.status !== "CANCELLED");
  const deps = depsIn.filter((d) => !d.deleted_at);
  const { order, preds } = topoSort(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const violations = [];

  // The origin all offsets are measured from.
  const origin = options.projectStart
    || tasks.map((t) => t.planned_start).filter(Boolean).sort()[0]
    || null;
  const constraintOffset = (t) => {
    if (!calendar || !origin || t.constraint_type === "ASAP" || !t.constraint_date) return null;
    return cal.offsetOf(t.constraint_date, origin, calendar);
  };

  // forward pass — earliest start/finish
  const ES = new Map(), EF = new Map();
  for (const id of order) {
    const t = byId.get(id);
    const dur = durationDays(t, calendar);
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

    // date constraints applied to the earliest dates
    const c = constraintOffset(t);
    if (c !== null) {
      const type = t.constraint_type;
      if (type === "START_NO_EARLIER_THAN") {
        es = Math.max(es, c);
      } else if (type === "MUST_START_ON") {
        if (es > c) {
          violations.push({ task_id: id, constraint: type, date: String(t.constraint_date).slice(0, 10),
            detail: `"${t.title}" must start on ${String(t.constraint_date).slice(0, 10)} but its predecessors ` +
              `cannot release it until ${cal.iso(cal.addWorkingDays(origin, es, calendar))}` });
        }
        es = c; // the constraint is the plan of record; the violation is reported
      } else if (type === "MUST_FINISH_ON") {
        es = Math.max(0, c - dur + 1);
      }
    }
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
    const t = byId.get(id);
    const dur = durationDays(t, calendar);
    let lf = projectLength;
    // A deadline caps the latest finish — which is how a schedule earns
    // NEGATIVE float, the honest signal that the plan does not fit.
    const c = constraintOffset(t);
    if (c !== null) {
      if (t.constraint_type === "FINISH_NO_LATER_THAN" || t.constraint_type === "MUST_FINISH_ON") {
        lf = Math.min(lf, c);
      } else if (t.constraint_type === "MUST_START_ON") {
        lf = Math.min(lf, c + dur);
      }
    }
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
    const entry = {
      earlyStart: ES.get(id), earlyFinish: EF.get(id),
      lateStart: LS.get(id), lateFinish: LF.get(id),
      slack, freeFloat: Math.max(0, free),
      critical: slack === 0,
      nearCritical: slack > 0 && slack <= NEAR_CRITICAL_DAYS,
      // negative float = the deadline cannot be met on the current logic
      behindDeadline: slack < 0,
    };
    if (calendar && origin) {
      // offsets are inclusive working-day indices: a 1-day task starting at
      // offset n finishes on the same working day, hence the -1.
      entry.earlyStartDate = cal.iso(cal.addWorkingDays(origin, entry.earlyStart, calendar));
      entry.earlyFinishDate = cal.iso(cal.addWorkingDays(origin, Math.max(0, entry.earlyFinish - 1), calendar));
      entry.lateStartDate = cal.iso(cal.addWorkingDays(origin, Math.max(0, entry.lateStart), calendar));
      entry.lateFinishDate = cal.iso(cal.addWorkingDays(origin, Math.max(0, entry.lateFinish - 1), calendar));
    }
    result.set(id, entry);
    if (entry.behindDeadline) {
      const t = byId.get(id);
      violations.push({
        task_id: id, constraint: t.constraint_type || "deadline",
        date: t.constraint_date ? String(t.constraint_date).slice(0, 10) : null,
        detail: `"${t.title}" is ${Math.abs(slack)} working day(s) beyond the latest finish its deadline allows`,
      });
    }
  }
  const criticalIds = order.filter((id) => result.get(id).critical);
  const nearCriticalIds = order.filter((id) => result.get(id).nearCritical);
  return {
    projectLength, tasks: result, criticalIds, nearCriticalIds, violations,
    calendarApplied: Boolean(calendar),
    origin: origin ? cal.iso(cal.toUTC(origin)) : null,
  };
}

// SPM Phase 2 — resource leveling. Finds days where one person's concurrent
// task assignments exceed a full day, and proposes a shift that uses existing
// float. It NEVER moves anything: a planner decides, because a machine cannot
// know which piece of work actually matters this week.
function levelResources(tasks, deps, options = {}) {
  const calendar = options.calendar || null;
  const cp = criticalPath(tasks, deps, options);
  const active = tasks.filter((t) =>
    t.status !== "CANCELLED" && t.status !== "DONE" && t.owner_user_id && cp.tasks.has(t.id));

  const byOwner = new Map();
  for (const t of active) {
    if (!byOwner.has(t.owner_user_id)) byOwner.set(t.owner_user_id, []);
    byOwner.get(t.owner_user_id).push(t);
  }

  const conflicts = [];
  for (const [ownerId, owned] of byOwner) {
    if (owned.length < 2) continue;
    for (let i = 0; i < owned.length; i++) {
      for (let j = i + 1; j < owned.length; j++) {
        const a = cp.tasks.get(owned[i].id), b = cp.tasks.get(owned[j].id);
        const overlap = Math.min(a.earlyFinish, b.earlyFinish) - Math.max(a.earlyStart, b.earlyStart);
        if (overlap <= 0) continue;

        // Move the one with more float; if both are critical, say so plainly.
        const [movable, anchor, movableTask] = a.slack >= b.slack
          ? [a, b, owned[i]] : [b, a, owned[j]];
        const shift = anchor.earlyFinish - movable.earlyStart;
        const fits = movable.slack >= shift;
        conflicts.push({
          user_id: ownerId,
          tasks: [owned[i].id, owned[j].id],
          overlap_days: overlap,
          suggestion: fits
            ? `Delay "${movableTask.title}" by ${shift} working day(s) — it has ${movable.slack} day(s) of float, so nothing else moves`
            : movable.slack <= 0 && anchor.slack <= 0
              ? `Both tasks are on the critical path — this needs a second person or a scope decision, not a date change`
              : `Delaying "${movableTask.title}" by ${shift} day(s) exceeds its ${movable.slack} day(s) of float and would push the end date`,
          resolvable_within_float: fits,
          shift_days: shift,
          ...(calendar && cp.origin ? {
            overlap_from: cal.iso(cal.addWorkingDays(cp.origin, Math.max(a.earlyStart, b.earlyStart), calendar)),
          } : {}),
        });
      }
    }
  }
  return {
    conflicts: conflicts.sort((x, y) => y.overlap_days - x.overlap_days),
    checkedPeople: byOwner.size,
    note: "Suggestions only — Pulse never moves a colleague's dates automatically",
  };
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

module.exports = {
  topoSort, wouldCycle, criticalPath, durationDays, qualityChecks, rollupSummaries,
  levelResources,
};
