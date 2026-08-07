"use strict";
// SPM Phase 1 — pure, explainable prioritization models. Every score returns
// {score, formula, inputs, missing} so any ranking can show exactly WHY.
// Mandatory/compliance demands rank above every scored demand, always.

// WSJF (SAFe): (business value + time criticality + risk reduction) / job size
function wsjf(d) {
  const missing = ["business_value", "time_criticality", "risk_reduction", "estimated_effort_weeks"]
    .filter((f) => d[f] == null);
  if (missing.length) return { score: null, missing, formula: "WSJF = (BV + TC + RR) / effort" };
  const num = Number(d.business_value) + Number(d.time_criticality) + Number(d.risk_reduction);
  const size = Math.max(Number(d.estimated_effort_weeks), 0.5);
  const score = Math.round((num / size) * 100) / 100;
  return {
    score, missing: [],
    formula: `WSJF = (BV ${d.business_value} + TC ${d.time_criticality} + RR ${d.risk_reduction}) / ${size}w = ${score}`,
  };
}

// RICE: reach × impact × confidence% / effort
function rice(d) {
  const missing = ["reach", "impact", "confidence", "estimated_effort_weeks"].filter((f) => d[f] == null);
  if (missing.length) return { score: null, missing, formula: "RICE = reach × impact × confidence / effort" };
  const size = Math.max(Number(d.estimated_effort_weeks), 0.5);
  const score = Math.round((Number(d.reach) * Number(d.impact) * (Number(d.confidence) / 100) / size) * 100) / 100;
  return {
    score, missing: [],
    formula: `RICE = ${d.reach} × ${d.impact} × ${d.confidence}% / ${size}w = ${score}`,
  };
}

// Weighted model: configurable weights over the 1–10 factors (defaults below)
const DEFAULT_WEIGHTS = { business_value: 0.5, time_criticality: 0.3, risk_reduction: 0.2 };
function weighted(d, weights = DEFAULT_WEIGHTS) {
  const missing = Object.keys(weights).filter((f) => d[f] == null);
  if (missing.length) return { score: null, missing, formula: "weighted sum of scored factors" };
  let score = 0;
  const parts = [];
  for (const [f, w] of Object.entries(weights)) {
    score += Number(d[f]) * w;
    parts.push(`${f.replace(/_/g, " ")} ${d[f]}×${w}`);
  }
  score = Math.round(score * 100) / 100;
  return { score, missing: [], formula: `weighted = ${parts.join(" + ")} = ${score}` };
}

// Cost of Delay: what a week of waiting costs (rank by CoD/effort = CD3)
function cd3(d) {
  const missing = ["cost_of_delay_week", "estimated_effort_weeks"].filter((f) => d[f] == null);
  if (missing.length) return { score: null, missing, formula: "CD3 = cost-of-delay/week ÷ effort weeks" };
  const size = Math.max(Number(d.estimated_effort_weeks), 0.5);
  const score = Math.round((Number(d.cost_of_delay_week) / size) * 100) / 100;
  return {
    score, missing: [],
    formula: `CD3 = ${Number(d.cost_of_delay_week).toLocaleString("en-US")}/w ÷ ${size}w = ${score}`,
  };
}

const MODELS = { wsjf, rice, weighted, cd3 };

// Rank a list under a model: mandatory first (by created), then score desc,
// unscored last. Returns rows decorated with {rank, scoring:{...}}.
function rank(demands, model = "wsjf", weights) {
  const fn = MODELS[model];
  if (!fn) throw new Error(`Unknown scoring model: ${model}`);
  const scored = demands.map((d) => ({
    ...d,
    scoring: d.mandatory
      ? { score: null, formula: `MANDATORY: ${d.mandatory_reason}`, missing: [], mandatory: true }
      : fn(d, weights),
  }));
  scored.sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    const sa = a.scoring.score, sb = b.scoring.score;
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });
  scored.forEach((d, i) => { d.rank = i + 1; });
  return scored;
}

module.exports = { wsjf, rice, weighted, cd3, rank, MODELS, DEFAULT_WEIGHTS };
