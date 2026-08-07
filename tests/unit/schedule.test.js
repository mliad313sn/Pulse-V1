"use strict";
// E07 scheduling utilities — cycle detection + critical path (plan §184).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { topoSort, wouldCycle, criticalPath, durationDays } = require("../../src/modules/tasks/schedule");

const T = (id, days, status = "IN_PROGRESS") => ({
  id, status,
  planned_start: "2026-09-01",
  planned_finish: new Date(Date.UTC(2026, 8, days)).toISOString().slice(0, 10), // sept days
});
const D = (p, s, lag = 0) => ({ predecessor_task_id: p, successor_task_id: s, lag_days: lag });

test("durationDays: inclusive day count with 1-day floor", () => {
  assert.equal(durationDays({ planned_start: "2026-09-01", planned_finish: "2026-09-05" }), 5);
  assert.equal(durationDays({ planned_start: "2026-09-01", planned_finish: "2026-09-01" }), 1);
  assert.equal(durationDays({}), 1);
});

test("topoSort orders dependencies; cycle throws with offending task ids", () => {
  const tasks = [T(1, 3), T(2, 3), T(3, 3)];
  const { order } = topoSort(tasks, [D(1, 2), D(2, 3)]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.throws(() => topoSort(tasks, [D(1, 2), D(2, 3), D(3, 1)]), /cycle/i);
});

test("wouldCycle detects the edge that closes a loop; direct self-dep rejected upstream", () => {
  const tasks = [T(1, 3), T(2, 3), T(3, 3)];
  const deps = [D(1, 2), D(2, 3)];
  assert.equal(wouldCycle(tasks, deps, 3, 1), true);
  assert.equal(wouldCycle(tasks, deps, 1, 3), false);
});

test("critical path: longest chain has zero slack; parallel short branch has slack", () => {
  // chain A(5d) -> B(5d) -> D(2d) = 12d; branch A -> C(1d) -> D
  const tasks = [T(1, 5), T(2, 5), T(3, 1), T(4, 2)];
  const deps = [D(1, 2), D(1, 3), D(2, 4), D(3, 4)];
  const cp = criticalPath(tasks, deps);
  assert.equal(cp.projectLength, 12);
  assert.deepEqual(cp.criticalIds.sort(), [1, 2, 4]);
  assert.ok(cp.tasks.get(3).slack > 0, "short branch has slack");
});

test("lag extends the path; cancelled tasks are excluded", () => {
  const tasks = [T(1, 5), T(2, 5), T(9, 30, "CANCELLED")];
  const cp = criticalPath(tasks, [D(1, 2, 3)]);
  assert.equal(cp.projectLength, 13, "5 + 3 lag + 5");
  assert.ok(!cp.criticalIds.includes(9), "cancelled excluded");
});

// ===== Phase 0: full FS/SS/FF/SF + lag/lead semantics =====
const DT = (p, s, type, lag = 0) => ({ predecessor_task_id: p, successor_task_id: s, dependency_type: type, lag_days: lag });

test("SS: successor starts with predecessor plus lag", () => {
  // A 10d; B(4d) SS+2 → B: ES 2, EF 6; length driven by A = 10
  const cp = criticalPath([T(1, 10), T(2, 4)], [DT(1, 2, "SS", 2)]);
  assert.equal(cp.tasks.get(2).earlyStart, 2);
  assert.equal(cp.tasks.get(2).earlyFinish, 6);
  assert.equal(cp.projectLength, 10);
  assert.ok(cp.tasks.get(2).slack > 0, "B can slide until its finish hits project end");
});

test("FF: successor cannot finish before predecessor finishes plus lag", () => {
  // A 10d; B(2d) FF+3 → B EF = 13, ES = 11
  const cp = criticalPath([T(1, 10), T(2, 2)], [DT(1, 2, "FF", 3)]);
  assert.equal(cp.tasks.get(2).earlyFinish, 13);
  assert.equal(cp.tasks.get(2).earlyStart, 11);
  assert.equal(cp.projectLength, 13);
  assert.deepEqual(cp.criticalIds.sort(), [1, 2], "FF chain is critical end-to-end");
});

test("SF: successor finish is pinned to predecessor start plus lag", () => {
  // A(5d) starts at 0; B(3d) SF+4 → B EF = 4 → ES 1
  const cp = criticalPath([T(1, 5), T(2, 3)], [DT(1, 2, "SF", 4)]);
  assert.equal(cp.tasks.get(2).earlyFinish, 4);
  assert.equal(cp.tasks.get(2).earlyStart, 1);
});

test("negative lag (lead) pulls the successor earlier; floor at project start", () => {
  // A 5d; B 5d FS-2 → B starts at 3, length 8
  const cp = criticalPath([T(1, 5), T(2, 5)], [DT(1, 2, "FS", -2)]);
  assert.equal(cp.tasks.get(2).earlyStart, 3);
  assert.equal(cp.projectLength, 8);
  // extreme lead cannot start before day 0
  const cp2 = criticalPath([T(1, 5), T(2, 5)], [DT(1, 2, "FS", -30)]);
  assert.equal(cp2.tasks.get(2).earlyStart, 0);
});

test("free float vs total float: middle task consumed by successor chain", () => {
  // A(5) -> B(1) -> D(2); A -> C(4) -> D. C path: 5+4+2=11 critical; B has float.
  const tasks = [T(1, 5), T(2, 1), T(3, 4), T(4, 2)];
  const deps = [D(1, 2), D(1, 3), D(2, 4), D(3, 4)];
  const cp = criticalPath(tasks, deps);
  assert.equal(cp.projectLength, 11);
  const b = cp.tasks.get(2);
  assert.equal(b.slack, 3, "B total float 3");
  assert.equal(b.freeFloat, 3, "B can absorb all 3 days without moving D");
  assert.ok(cp.tasks.get(3).critical);
});

test("ES/EF/LS/LF are internally consistent (LS = LF - duration, slack = LF - EF)", () => {
  const tasks = [T(1, 5), T(2, 5), T(3, 1), T(4, 2)];
  const deps = [D(1, 2), D(1, 3), D(2, 4), D(3, 4)];
  const cp = criticalPath(tasks, deps);
  for (const [, v] of cp.tasks) {
    assert.equal(v.slack, v.lateFinish - v.earlyFinish);
    assert.equal(v.lateStart, v.lateFinish - (v.earlyFinish - v.earlyStart));
  }
});

test("near-critical set: small-slack branches flagged, big-slack ones not", () => {
  // critical chain 10d; branch with 8d task → slack 2 (near); branch 3d → slack 7 (not)
  const tasks = [T(1, 10), T(2, 8), T(3, 3)];
  const cp = criticalPath(tasks, []);
  assert.deepEqual(cp.criticalIds, [1]);
  assert.deepEqual(cp.nearCriticalIds, [2]);
});
