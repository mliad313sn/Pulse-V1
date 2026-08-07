"use strict";
// SPM Phase 2 — working calendars, date constraints and resource leveling.
// Weekends and holidays must never be counted as working time, a deadline that
// cannot be met must produce NEGATIVE float rather than a comfortable zero,
// and leveling must propose rather than move.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const cal = require("../../src/modules/tasks/calendar");
const { criticalPath, levelResources, durationDays } = require("../../src/modules/tasks/schedule");

// 2026-06-01 is a Monday.
const MonFri = { working_days: [1, 2, 3, 4, 5], hours_per_day: 8, exceptions: [] };
const withHoliday = {
  ...MonFri,
  exceptions: [{ exception_date: "2026-06-03", working: false, note: "Public holiday (Wednesday)" }],
};
const withWorkedSaturday = {
  ...MonFri,
  exceptions: [{ exception_date: "2026-06-06", working: true, note: "Recovery Saturday" }],
};

test("weekends are not working days, and exceptions override in both directions", () => {
  assert.equal(cal.isWorkingDay("2026-06-01", MonFri), true, "Monday");
  assert.equal(cal.isWorkingDay("2026-06-06", MonFri), false, "Saturday");
  assert.equal(cal.isWorkingDay("2026-06-03", withHoliday), false, "holiday beats the working week");
  assert.equal(cal.isWorkingDay("2026-06-06", withWorkedSaturday), true, "a worked Saturday beats the weekend");
});

test("working days between dates skip weekends and holidays", () => {
  // Mon 1st → Fri 5th inclusive = 5 working days
  assert.equal(cal.workingDaysBetween("2026-06-01", "2026-06-05", MonFri), 5);
  // the same week with Wednesday off = 4
  assert.equal(cal.workingDaysBetween("2026-06-01", "2026-06-05", withHoliday), 4);
  // Mon 1st → Mon 8th spans a weekend: 6 working days, not 8
  assert.equal(cal.workingDaysBetween("2026-06-01", "2026-06-08", MonFri), 6);
});

test("adding working days jumps the weekend", () => {
  // Friday 5th + 1 working day = Monday 8th
  assert.equal(cal.iso(cal.addWorkingDays("2026-06-05", 1, MonFri)), "2026-06-08");
  // starting on a Saturday snaps forward to Monday first
  assert.equal(cal.iso(cal.addWorkingDays("2026-06-06", 0, MonFri)), "2026-06-08");
  // with the recovery Saturday, offset 0 IS that Saturday
  assert.equal(cal.iso(cal.addWorkingDays("2026-06-06", 0, withWorkedSaturday)), "2026-06-06");
});

test("task duration is measured in working days when a calendar applies", () => {
  const t = { planned_start: "2026-06-01", planned_finish: "2026-06-08" };
  assert.equal(durationDays(t), 8, "calendar days without a calendar");
  assert.equal(durationDays(t, MonFri), 6, "working days with one");
});

test("CPM with a calendar returns real dates that never land on a weekend", () => {
  const tasks = [
    { id: 1, title: "A", status: "NOT_STARTED", planned_start: "2026-06-01", planned_finish: "2026-06-03" },
    { id: 2, title: "B", status: "NOT_STARTED", planned_start: "2026-06-04", planned_finish: "2026-06-05" },
  ];
  const deps = [{ predecessor_task_id: 1, successor_task_id: 2, dep_type: "FS", lag_days: 0 }];
  const r = criticalPath(tasks, deps, { calendar: MonFri, projectStart: "2026-06-01" });

  assert.equal(r.calendarApplied, true);
  const b = r.tasks.get(2);
  // A takes 3 working days (Mon–Wed), so B starts Thursday and takes 2 days → Friday
  assert.equal(b.earlyStartDate, "2026-06-04");
  assert.equal(b.earlyFinishDate, "2026-06-05");

  // the same plan with Wednesday off pushes B into the following week
  const h = criticalPath(tasks, deps, { calendar: withHoliday, projectStart: "2026-06-01" });
  assert.equal(h.tasks.get(2).earlyStartDate, "2026-06-05");
  assert.equal(h.tasks.get(2).earlyFinishDate, "2026-06-08", "the weekend is skipped, not consumed");
});

test("START_NO_EARLIER_THAN delays a task; MUST_START_ON reports an impossible sequence", () => {
  const tasks = [
    { id: 1, title: "A", status: "NOT_STARTED", planned_start: "2026-06-01", planned_finish: "2026-06-02" },
    { id: 2, title: "B", status: "NOT_STARTED", planned_start: "2026-06-03", planned_finish: "2026-06-03",
      constraint_type: "START_NO_EARLIER_THAN", constraint_date: "2026-06-10" },
  ];
  const deps = [{ predecessor_task_id: 1, successor_task_id: 2, dep_type: "FS", lag_days: 0 }];
  const r = criticalPath(tasks, deps, { calendar: MonFri, projectStart: "2026-06-01" });
  assert.equal(r.tasks.get(2).earlyStartDate, "2026-06-10", "the constraint holds the task back");
  assert.equal(r.violations.length, 0, "a satisfiable constraint is not a violation");

  const impossible = criticalPath([
    tasks[0],
    { ...tasks[1], constraint_type: "MUST_START_ON", constraint_date: "2026-06-01" },
  ], deps, { calendar: MonFri, projectStart: "2026-06-01" });
  const v = impossible.violations.find((x) => x.constraint === "MUST_START_ON");
  assert.ok(v, "an unsatisfiable MUST_START_ON is reported, never silently ignored");
  assert.match(v.detail, /cannot release it until/);
});

test("a deadline that cannot be met produces negative float, not a comfortable zero", () => {
  const tasks = [
    { id: 1, title: "Long build", status: "NOT_STARTED",
      planned_start: "2026-06-01", planned_finish: "2026-06-30",
      constraint_type: "FINISH_NO_LATER_THAN", constraint_date: "2026-06-10" },
  ];
  const r = criticalPath(tasks, [], { calendar: MonFri, projectStart: "2026-06-01" });
  const t = r.tasks.get(1);
  assert.ok(t.slack < 0, `expected negative float, got ${t.slack}`);
  assert.equal(t.behindDeadline, true);
  assert.ok(r.violations.some((v) => v.task_id === 1 && /beyond the latest finish/.test(v.detail)));
});

test("resource leveling proposes a shift within float and refuses to invent one when there is none", () => {
  // Two overlapping tasks owned by the same person, one with float
  const tasks = [
    { id: 1, title: "Critical run", status: "NOT_STARTED", owner_user_id: 7,
      planned_start: "2026-06-01", planned_finish: "2026-06-05" },
    { id: 2, title: "Flexible job", status: "NOT_STARTED", owner_user_id: 7,
      planned_start: "2026-06-01", planned_finish: "2026-06-03" },
    { id: 3, title: "Successor", status: "NOT_STARTED", owner_user_id: 9,
      planned_start: "2026-06-08", planned_finish: "2026-06-09" },
  ];
  const deps = [{ predecessor_task_id: 1, successor_task_id: 3, dep_type: "FS", lag_days: 0 }];
  const r = levelResources(tasks, deps, { calendar: MonFri, projectStart: "2026-06-01" });

  assert.equal(r.checkedPeople, 2);
  const clash = r.conflicts.find((c) => c.user_id === 7);
  assert.ok(clash, "the double-booking is found");
  assert.deepEqual(clash.tasks.sort(), [1, 2]);
  assert.ok(clash.overlap_days > 0);
  assert.match(r.note, /never moves/);
  assert.ok(clash.suggestion.length > 0, "every conflict carries a human-readable suggestion");

  // nobody double-booked → nothing to report
  const clean = levelResources([tasks[0], tasks[2]], deps, { calendar: MonFri, projectStart: "2026-06-01" });
  assert.equal(clean.conflicts.length, 0);
});
