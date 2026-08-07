"use strict";
// SPM Phase 3 — the capacity kernel is pure arithmetic, so it is tested as
// arithmetic: day-weighting, leave reducing capacity rather than consuming it,
// tentative work reported separately, and candidate ranking that explains
// itself.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { forecast, loadForPeriod, buckets, overlapDays, rankCandidates } = require("../../src/modules/resources/capacity");

test("overlapDays counts inclusive days and returns 0 when ranges miss", () => {
  assert.equal(overlapDays("2026-01-01", "2026-01-31", "2026-01-01", "2026-01-31"), 31);
  assert.equal(overlapDays("2026-01-15", "2026-02-15", "2026-01-01", "2026-01-31"), 17); // 15th–31st
  assert.equal(overlapDays("2026-03-01", "2026-03-31", "2026-01-01", "2026-01-31"), 0);
});

test("month buckets follow calendar months; week buckets anchor on Monday", () => {
  const m = buckets("2026-01-15", 3, "month");
  assert.deepEqual(m.map((b) => b.key), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(m[1].end, "2026-02-28");
  const w = buckets("2026-01-15", 2, "week"); // Thursday → week starts Monday the 12th
  assert.equal(w[0].start, "2026-01-12");
  assert.equal(w[0].end, "2026-01-18");
  assert.equal(w[1].start, "2026-01-19");
});

test("load is day-weighted: a booking covering half a month costs half its percent", () => {
  const period = { key: "2026-04", label: "2026-04", start: "2026-04-01", end: "2026-04-30" };
  const r = loadForPeriod([
    { id: 1, start_date: "2026-04-01", end_date: "2026-04-15", percent: 100, project_code: "PRJ-1" },
  ], period);
  // 15 of 30 days at 100% = 50%
  assert.equal(r.committed_percent, 50);
  assert.equal(r.available_percent, 50);
  assert.equal(r.over_allocated, false);
});

test("leave reduces capacity; BAU consumes it; over-allocation is explained", () => {
  const period = { key: "2026-05", label: "2026-05", start: "2026-05-01", end: "2026-05-31" };
  const r = loadForPeriod([
    { id: 1, start_date: "2026-05-01", end_date: "2026-05-31", percent: 20, allocation_type: "LEAVE" },
    { id: 2, start_date: "2026-05-01", end_date: "2026-05-31", percent: 30, allocation_type: "BAU" },
    { id: 3, start_date: "2026-05-01", end_date: "2026-05-31", percent: 60, project_code: "PRJ-9" },
  ], period);
  assert.equal(r.leave_percent, 20);
  assert.equal(r.capacity_percent, 80, "leave removes capacity rather than filling it");
  assert.equal(r.used_percent, 90, "BAU 30 + project 60");
  assert.equal(r.available_percent, -10);
  assert.equal(r.over_allocated, true);

  const f = forecast([
    { id: 1, start_date: "2026-05-01", end_date: "2026-05-31", percent: 20, allocation_type: "LEAVE" },
    { id: 2, start_date: "2026-05-01", end_date: "2026-05-31", percent: 30, allocation_type: "BAU" },
    { id: 3, start_date: "2026-05-01", end_date: "2026-05-31", percent: 60, project_code: "PRJ-9" },
  ], { from: "2026-05-01", periods: 1 });
  assert.match(f[0].explanation, /Over-allocated: 90% booked against 80% capacity/);
  assert.match(f[0].explanation, /20% of the period is leave/);
  assert.match(f[0].explanation, /PRJ-9 60%/);
});

test("tentative work does not over-allocate but is flagged as at risk", () => {
  const f = forecast([
    { id: 1, start_date: "2026-06-01", end_date: "2026-06-30", percent: 70, project_code: "PRJ-1" },
    { id: 2, start_date: "2026-06-01", end_date: "2026-06-30", percent: 50, project_code: "PRJ-2", commitment: "TENTATIVE" },
  ], { from: "2026-06-01", periods: 1 });
  assert.equal(f[0].over_allocated, false);
  assert.equal(f[0].at_risk, true);
  assert.equal(f[0].tentative_percent, 50);
  assert.match(f[0].explanation, /would push it to 120% against 100% capacity/);
});

test("candidate ranking: proficiency floor excludes, availability and site rank, every result explains itself", () => {
  const req = { percent: 50, skill_id: 7, skill_name: "Fibre splicing", min_proficiency: 3, site_id: 2 };
  const ranked = rankCandidates([
    { user_id: 1, name: "Ada", proficiency: 5, certified: true, site_id: 2, available_percent: 80 },
    { user_id: 2, name: "Ben", proficiency: 2, certified: false, site_id: 2, available_percent: 100 },
    { user_id: 3, name: "Cleo", proficiency: 4, certified: false, site_id: 9, available_percent: 20 },
    { user_id: 4, name: "Dre", proficiency: null, certified: false, site_id: 2, available_percent: 100 },
  ], req);

  assert.equal(ranked[0].name, "Ada", "expert, certified, on site, enough capacity wins");
  assert.equal(ranked[0].fits_fully, true);
  assert.match(ranked[0].reason, /proficiency 5\/5; certified; 80% free covers the 50% requested; on site/);

  const ben = ranked.find((r) => r.name === "Ben");
  assert.equal(ben.eligible, false);
  assert.match(ben.reason, /proficiency 2 is below the required 3/);

  const dre = ranked.find((r) => r.name === "Dre");
  assert.equal(dre.eligible, false);
  assert.match(dre.reason, /No recorded Fibre splicing skill/);

  const cleo = ranked.find((r) => r.name === "Cleo");
  assert.equal(cleo.fits_fully, false);
  assert.match(cleo.reason, /only 20% free against 50% requested; different site/);
});
