"use strict";
// SPM Phase 1 — prioritization model mathematics (pure, explainable).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { wsjf, rice, weighted, cd3, rank } = require("../../src/modules/demand/scoring");

test("WSJF: (BV+TC+RR)/effort, explainable, missing inputs reported", () => {
  const r = wsjf({ business_value: 8, time_criticality: 6, risk_reduction: 4, estimated_effort_weeks: 9 });
  assert.equal(r.score, 2);
  assert.match(r.formula, /WSJF = \(BV 8 \+ TC 6 \+ RR 4\) \/ 9w = 2/);
  const partial = wsjf({ business_value: 8 });
  assert.equal(partial.score, null);
  assert.deepEqual(partial.missing.sort(), ["estimated_effort_weeks", "risk_reduction", "time_criticality"]);
});

test("RICE: reach×impact×confidence%/effort; tiny efforts floored at 0.5w", () => {
  const r = rice({ reach: 200, impact: 2, confidence: 80, estimated_effort_weeks: 4 });
  assert.equal(r.score, 80);
  const floored = rice({ reach: 10, impact: 1, confidence: 100, estimated_effort_weeks: 0.1 });
  assert.equal(floored.score, 20, "effort floor prevents division blowups");
});

test("weighted: default weights favor business value; CD3 ranks by cost of delay per week", () => {
  const w = weighted({ business_value: 10, time_criticality: 5, risk_reduction: 5 });
  assert.equal(w.score, 7.5); // 10*.5 + 5*.3 + 5*.2
  const c = cd3({ cost_of_delay_week: 30000, estimated_effort_weeks: 6 });
  assert.equal(c.score, 5000);
});

test("rank: mandatory pins to top regardless of score; unscored sink to bottom", () => {
  const rows = rank([
    { id: 1, title: "big score", business_value: 10, time_criticality: 10, risk_reduction: 10, estimated_effort_weeks: 1, mandatory: false },
    { id: 2, title: "compliance", business_value: 1, time_criticality: 1, risk_reduction: 1, estimated_effort_weeks: 50, mandatory: true, mandatory_reason: "Regulator deadline Q4" },
    { id: 3, title: "unscored", mandatory: false },
    { id: 4, title: "middling", business_value: 5, time_criticality: 5, risk_reduction: 2, estimated_effort_weeks: 4, mandatory: false },
  ], "wsjf");
  assert.deepEqual(rows.map((r) => r.id), [2, 1, 4, 3]);
  assert.equal(rows[0].rank, 1);
  assert.match(rows[0].scoring.formula, /MANDATORY: Regulator deadline/);
  assert.equal(rows[3].scoring.score, null, "unscored last, visibly missing inputs");
});
