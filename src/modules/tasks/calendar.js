"use strict";
// SPM Phase 2 — working-calendar arithmetic. Pure, no I/O.
//
// A calendar is { working_days: [1..7 ISO weekdays], exceptions: Map(iso -> bool) }
// where an exception of false is a holiday and true is a day that IS worked
// despite falling outside the normal week (recovery weekends, shutdown crews).
//
// Everything the CPM does is expressed in WORKING-DAY OFFSETS from a project
// start; these helpers are the only place that knows how an offset becomes a
// real date, so weekends and holidays cannot leak into the arithmetic.

const DAY = 86400000;
const toUTC = (v) => (v instanceof Date
  ? new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
  : new Date(`${String(v).slice(0, 10)}T00:00:00Z`));
const iso = (d) => d.toISOString().slice(0, 10);
const isoWeekday = (d) => d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Sunday = 7

const DEFAULT_CALENDAR = { working_days: [1, 2, 3, 4, 5], exceptions: new Map(), hours_per_day: 8 };

function normalize(cal) {
  if (!cal) return DEFAULT_CALENDAR;
  // Exception dates arrive either as ISO strings or as JS Date objects (pg
  // returns DATE columns as Dates, whose String() is "Mon Jun 01 2026 …" —
  // slicing that would silently produce a key that never matches).
  const exceptions = cal.exceptions instanceof Map
    ? cal.exceptions
    : new Map((cal.exceptions || []).map((e) => [iso(toUTC(e.exception_date)), e.working === true]));
  return {
    working_days: cal.working_days && cal.working_days.length ? cal.working_days.map(Number) : [1, 2, 3, 4, 5],
    hours_per_day: Number(cal.hours_per_day || 8),
    exceptions,
  };
}

function isWorkingDay(date, calendar) {
  const cal = normalize(calendar);
  const d = toUTC(date);
  const override = cal.exceptions.get(iso(d));
  if (override !== undefined) return override; // exceptions win in both directions
  return cal.working_days.includes(isoWeekday(d));
}

// The first working day on or after `date`.
function nextWorkingDay(date, calendar) {
  let d = toUTC(date);
  for (let guard = 0; guard < 3650; guard++) {
    if (isWorkingDay(d, calendar)) return d;
    d = new Date(d.getTime() + DAY);
  }
  throw new Error("No working day found within 10 years — check the calendar definition");
}

// Working days between two dates, inclusive of both ends (0 if end < start).
function workingDaysBetween(start, end, calendar) {
  let d = toUTC(start);
  const last = toUTC(end);
  if (last < d) return 0;
  let n = 0;
  for (let guard = 0; guard < 36500 && d <= last; guard++) {
    if (isWorkingDay(d, calendar)) n++;
    d = new Date(d.getTime() + DAY);
  }
  return n;
}

// Add `offset` working days to a date. Offset 0 = the first working day on or
// after `from`, so offsets and durations compose without off-by-one games.
function addWorkingDays(from, offset, calendar) {
  let d = nextWorkingDay(from, calendar);
  let remaining = Math.max(0, Math.round(offset));
  for (let guard = 0; guard < 36500 && remaining > 0; guard++) {
    d = nextWorkingDay(new Date(d.getTime() + DAY), calendar);
    remaining--;
  }
  return d;
}

// The working-day offset of `date` relative to `origin` (origin itself = 0).
// Non-working dates map to the offset of the next working day.
function offsetOf(date, origin, calendar) {
  const target = nextWorkingDay(date, calendar);
  const start = nextWorkingDay(origin, calendar);
  if (target <= start) return 0;
  return workingDaysBetween(start, target, calendar) - 1;
}

module.exports = {
  isWorkingDay, nextWorkingDay, workingDaysBetween, addWorkingDays, offsetOf,
  normalize, iso, toUTC, DEFAULT_CALENDAR,
};
