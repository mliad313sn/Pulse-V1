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
