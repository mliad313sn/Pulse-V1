"use strict";
// SPM Phase 5 — Health 2.0: explainable, weighted, multi-dimensional health.
// Pure functions, no I/O.
//
// Two deliberate design choices:
//   1. This does NOT replace the operational RAG that drives the wall. That
//      engine (compute.js) stays the single source of truth for rag_computed.
//      Health 2.0 is a richer lens over dimensions the RAG never covered
//      (finance, resources, governance, benefits) and it reports honestly
//      when the two disagree, instead of quietly creating a second truth.
//   2. Dimensions score by CRITICALITY, not counts: a single critical risk
//      outweighs five trivial ones, and a slipped GO_LIVE outweighs a slipped
//      internal checkpoint. Every dimension returns the actual records that
//      moved it, so a red number is always one click from its evidence.

const WEIGHTS = {
  schedule: 25,
  risks: 15,
  finance: 15,
  governance: 15,
  resources: 10,
  benefits: 10,
  confidence: 10,
};

const band = (score) => (score >= 80 ? "G" : score >= 60 ? "A" : "R");
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const toDate = (d) => (d ? (d instanceof Date ? d : new Date(d)) : null);
const days = (from, to) => (to.getTime() - from.getTime()) / 86400000;

// Milestone weight by type: a go-live slipping is not the same as a checkpoint.
const MILESTONE_WEIGHT = { GO_LIVE: 3, SITE_READINESS: 2, GATE: 2, STANDARD: 1 };

function scheduleDimension({ milestones = [], today }) {
  if (!milestones.length) {
    return { score: 70, detail: "No milestones planned yet — schedule health cannot be evidenced", contributors: [] };
  }
  let weightTotal = 0, lateWeight = 0;
  const contributors = [];
  for (const m of milestones) {
    const w = MILESTONE_WEIGHT[m.type] || 1;
    weightTotal += w;
    if (m.status === "DONE") continue;
    const due = toDate(m.due_date);
    const overdue = m.status === "SLIPPED" || (due && due < today);
    if (overdue) {
      lateWeight += w;
      const late = due ? Math.floor(days(due, today)) : null;
      contributors.push({
        type: "milestone", id: m.id, label: m.title,
        why: m.status === "SLIPPED" ? `marked SLIPPED (${m.type})`
          : `${late} day(s) overdue (${m.type})`,
        weight: w,
      });
    }
  }
  const score = clamp(100 - (lateWeight / weightTotal) * 100);
  return {
    score,
    detail: contributors.length
      ? `${contributors.length} milestone(s) late, weighted ${lateWeight}/${weightTotal} by importance`
      : "All milestones on or ahead of plan",
    contributors: contributors.sort((a, b) => b.weight - a.weight).slice(0, 8),
  };
}

// Risks scored by severity (probability × impact), open only, residual honoured.
function riskDimension({ risks = [], roadblocks = [] }) {
  const contributors = [];
  let penalty = 0;
  for (const r of risks) {
    if (r.status === "CLOSED") continue;
    const score = Number(r.residual_score ?? r.score ?? 0);
    if (score <= 0) continue;
    // 25 (5×5) costs 40 points; 4 costs ~6
    const p = (score / 25) * 40;
    penalty += p;
    contributors.push({ type: "risk", id: r.id, label: r.title, why: `severity ${score}/25`, weight: score });
  }
  for (const b of roadblocks) {
    if (b.status === "RESOLVED") continue;
    const p = b.severity === "CRITICAL" ? 45 : b.severity === "MAJOR" ? 20 : 5;
    penalty += p;
    contributors.push({ type: "roadblock", id: b.id, label: b.title, why: `${b.severity} roadblock open`, weight: p });
  }
  const score = clamp(100 - penalty);
  return {
    score,
    detail: contributors.length
      ? `${contributors.length} open risk(s)/roadblock(s), weighted by severity`
      : "No open risks or roadblocks",
    contributors: contributors.sort((a, b) => b.weight - a.weight).slice(0, 8),
  };
}

// Finance: budget consumption against progress, plus EVM indices when available.
// Returns null when the caller may not see money — masking is not a zero score.
function financeDimension({ finance, progressPct, evm }) {
  if (!finance) return null;
  const approved = Number(finance.approved || 0);
  const actual = Number(finance.actual || 0);
  const contributors = [];
  if (approved <= 0) {
    return { score: 70, detail: "No approved budget recorded — financial health cannot be evidenced", contributors: [] };
  }
  const spentPct = (actual / approved) * 100;
  const burnGap = spentPct - Number(progressPct || 0); // >0 = spending ahead of delivery
  let score = 100 - Math.max(0, burnGap) * 1.5;
  contributors.push({
    type: "budget", id: null,
    label: `${Math.round(spentPct)}% of approved budget spent at ${Math.round(progressPct || 0)}% progress`,
    why: burnGap > 0 ? `spending ${Math.round(burnGap)} points ahead of delivery` : "spend tracks delivery",
    weight: Math.round(Math.abs(burnGap)),
  });
  if (evm && evm.cpi != null) {
    if (evm.cpi < 1) score -= (1 - evm.cpi) * 60;
    contributors.push({
      type: "evm", id: null, label: `CPI ${evm.cpi.toFixed(2)}`,
      why: evm.cpi < 1 ? "earning less value than the cost incurred" : "cost efficient",
      weight: Math.round(Math.abs(1 - evm.cpi) * 100),
    });
  }
  if (evm && evm.spi != null) {
    if (evm.spi < 1) score -= (1 - evm.spi) * 40;
    contributors.push({
      type: "evm", id: null, label: `SPI ${evm.spi.toFixed(2)}`,
      why: evm.spi < 1 ? "behind the value the plan expected by now" : "on or ahead of plan",
      weight: Math.round(Math.abs(1 - evm.spi) * 100),
    });
  }
  return {
    score: clamp(score),
    detail: burnGap > 10
      ? `Spend is ${Math.round(burnGap)} points ahead of delivery`
      : "Spend broadly tracks delivery",
    contributors,
  };
}

// Resources: is the work actually staffed, and are those people over-committed?
function resourceDimension({ allocations = [], overloadedPeople = [], stage }) {
  const contributors = [];
  const needsStaff = !["IDEA", "CLOSED"].includes(stage);
  if (!allocations.length) {
    return needsStaff
      ? { score: 45, detail: "Nobody is allocated to this project", contributors: [] }
      : { score: 85, detail: "No allocations yet — expected at this stage", contributors: [] };
  }
  let score = 100;
  for (const p of overloadedPeople) {
    score -= 20;
    contributors.push({
      type: "user", id: p.user_id, label: p.name,
      why: `allocated ${p.total_percent}% across all projects`, weight: p.total_percent,
    });
  }
  return {
    score: clamp(score),
    detail: contributors.length
      ? `${contributors.length} allocated person/people are over-committed`
      : `${allocations.length} allocation(s), nobody over-committed`,
    contributors: contributors.sort((a, b) => b.weight - a.weight).slice(0, 8),
  };
}

// Governance: is the project being run through its own process?
function governanceDimension({ pendingChanges = [], overdueCapas = [], stage, hasBaseline, governance }) {
  const contributors = [];
  let score = 100;
  for (const cr of pendingChanges) {
    const age = cr.age_days ?? 0;
    if (age > 14) {
      score -= 15;
      contributors.push({ type: "change_request", id: cr.id, label: cr.title,
        why: `awaiting a decision for ${Math.round(age)} days`, weight: age });
    }
  }
  for (const c of overdueCapas) {
    score -= 20;
    contributors.push({ type: "capa", id: c.id, label: c.issue,
      why: `corrective action overdue since ${String(c.due_date).slice(0, 10)}`, weight: 20 });
  }
  // Past IDEA/INITIATION, work without a baseline has nothing to be measured against.
  if (!hasBaseline && ["EXECUTION", "DEPLOYMENT", "RUN"].includes(stage)) {
    score -= governance === "LITE" ? 10 : 25;
    contributors.push({ type: "baseline", id: null, label: "No baseline captured",
      why: `project is in ${stage} with nothing to measure variance against`, weight: 25 });
  }
  return {
    score: clamp(score),
    detail: contributors.length ? `${contributors.length} governance gap(s)` : "Governance up to date",
    contributors,
  };
}

// Benefits: is the reason this project exists still being tracked?
function benefitsDimension({ benefits = [], stage }) {
  const expected = ["EXECUTION", "DEPLOYMENT", "RUN", "CLOSED"].includes(stage);
  if (!benefits.length) {
    return expected
      ? { score: 50, detail: `No benefits defined, and the project is already in ${stage}`, contributors: [] }
      : { score: 80, detail: "No benefits defined yet", contributors: [] };
  }
  const contributors = [];
  let score = 100;
  for (const b of benefits) {
    if (b.status === "AT_RISK") {
      score -= 25;
      contributors.push({ type: "benefit", id: b.id, label: b.title, why: "flagged at risk", weight: 25 });
    } else if (b.status === "MISSED") {
      score -= 40;
      contributors.push({ type: "benefit", id: b.id, label: b.title, why: "recorded as missed", weight: 40 });
    }
  }
  return {
    score: clamp(score),
    detail: contributors.length ? `${contributors.length} benefit(s) at risk or missed`
      : `${benefits.length} benefit(s) tracked and on course`,
    contributors,
  };
}

// Confidence: how much should anyone trust the numbers above?
function confidenceDimension({ lastStatusUpdateAt, lastActivityAt, createdAt, today, stage, operatingStatus }) {
  if (["CLOSED"].includes(stage) || ["CANCELLED", "COMPLETED"].includes(operatingStatus)) {
    return { score: 100, detail: `Not expected to move (${stage}/${operatingStatus})`, contributors: [] };
  }
  const activity = toDate(lastActivityAt) || toDate(createdAt);
  const update = toDate(lastStatusUpdateAt);
  const contributors = [];
  let score = 100;
  const sinceActivity = activity ? Math.floor(days(activity, today)) : null;
  const sinceUpdate = update ? Math.floor(days(update, today))
    : createdAt ? Math.floor(days(toDate(createdAt), today)) : null;
  if (sinceActivity != null && sinceActivity > 30) {
    score -= 45;
    contributors.push({ type: "project", id: null, label: "No activity of any kind",
      why: `${sinceActivity} days since the last write`, weight: sinceActivity });
  }
  if (sinceUpdate != null && sinceUpdate > 21) {
    score -= 30;
    contributors.push({ type: "status_update", id: null,
      label: update ? "Stale status update" : "Never status-updated",
      why: `${sinceUpdate} days since the last status update`, weight: sinceUpdate });
  }
  return {
    score: clamp(score),
    detail: contributors.length ? "The data behind this project is going stale"
      : "Recently updated — the figures can be trusted",
    contributors,
  };
}

// ===== progress methodologies =====
// Every method returns { pct, method, basis } so the number always says where
// it came from. Falls back honestly (never silently) when inputs are missing.
function computeProgressBy(method, data) {
  const ms = data.milestones || [];
  const tasks = data.tasks || [];
  switch (method) {
    case "TASK": {
      const live = tasks.filter((t) => t.status !== "CANCELLED");
      if (!live.length) return { pct: 0, method: "TASK", basis: "no tasks yet" };
      const done = live.filter((t) => t.status === "DONE").length;
      return { pct: Math.round((done / live.length) * 100), method: "TASK",
        basis: `${done}/${live.length} tasks done` };
    }
    case "EFFORT": {
      const live = tasks.filter((t) => t.status !== "CANCELLED" && Number(t.estimated_hours) > 0);
      const total = live.reduce((s, t) => s + Number(t.estimated_hours), 0);
      if (!total) return { pct: 0, method: "EFFORT", basis: "no estimated hours recorded" };
      const remaining = live.reduce((s, t) =>
        s + (t.status === "DONE" ? 0 : Number(t.remaining_hours ?? t.estimated_hours)), 0);
      return { pct: Math.round(((total - remaining) / total) * 100), method: "EFFORT",
        basis: `${Math.round(total - remaining)}h of ${Math.round(total)}h estimated effort burned` };
    }
    case "COST": {
      const approved = Number(data.finance?.approved || 0);
      const actual = Number(data.finance?.actual || 0);
      if (!approved) return { pct: 0, method: "COST", basis: "no approved budget to measure against" };
      return { pct: clamp((actual / approved) * 100), method: "COST",
        basis: `${Math.round(actual).toLocaleString("en-US")} of ${Math.round(approved).toLocaleString("en-US")} spent` };
    }
    case "PHYSICAL": {
      if (data.progressManual == null) {
        return { pct: milestonePct(ms), method: "MILESTONE",
          basis: "physical progress selected but never entered — falling back to milestones" };
      }
      return { pct: Number(data.progressManual), method: "PHYSICAL",
        basis: data.progressManualNote || "entered by the project manager" };
    }
    default: {
      const done = ms.filter((m) => m.status === "DONE").length;
      return { pct: milestonePct(ms), method: "MILESTONE",
        basis: ms.length ? `${done}/${ms.length} milestones done` : "no milestones yet" };
    }
  }
}
function milestonePct(ms) {
  if (!ms.length) return 0;
  return Math.round((ms.filter((m) => m.status === "DONE").length / ms.length) * 100);
}

// ===== assembly =====
function computeHealth(input) {
  const today = input.today instanceof Date ? input.today : new Date(input.today || Date.now());
  const progress = computeProgressBy(input.progressMethod || "MILESTONE", input);

  const raw = {
    schedule: scheduleDimension({ milestones: input.milestones, today }),
    risks: riskDimension({ risks: input.risks, roadblocks: input.roadblocks }),
    finance: financeDimension({ finance: input.finance, progressPct: progress.pct, evm: input.evm }),
    resources: resourceDimension({ allocations: input.allocations,
      overloadedPeople: input.overloadedPeople, stage: input.stage }),
    governance: governanceDimension({ pendingChanges: input.pendingChanges, overdueCapas: input.overdueCapas,
      stage: input.stage, hasBaseline: input.hasBaseline, governance: input.governance }),
    benefits: benefitsDimension({ benefits: input.benefits, stage: input.stage }),
    confidence: confidenceDimension({ lastStatusUpdateAt: input.lastStatusUpdateAt,
      lastActivityAt: input.lastActivityAt, createdAt: input.createdAt, today,
      stage: input.stage, operatingStatus: input.operatingStatus }),
  };

  // Masked dimensions (finance without the flag) are dropped and their weight
  // redistributed — an unauthorized viewer must not see a health score that
  // silently assumes the worst about money they cannot see.
  const dimensions = {};
  let weightSum = 0;
  for (const [key, dim] of Object.entries(raw)) {
    if (dim === null) continue;
    weightSum += WEIGHTS[key];
    dimensions[key] = { ...dim, weight: WEIGHTS[key], band: band(dim.score) };
  }
  const weighted = Object.entries(dimensions)
    .reduce((sum, [k, d]) => sum + d.score * (WEIGHTS[k] / weightSum), 0);
  const score = clamp(weighted);

  const worst = Object.entries(dimensions)
    .filter(([, d]) => d.band !== "G")
    .sort((a, b) => (a[1].score - b[1].score) || (WEIGHTS[b[0]] - WEIGHTS[a[0]]));

  return {
    score,
    band: band(score),
    progress,
    dimensions,
    maskedDimensions: Object.entries(raw).filter(([, v]) => v === null).map(([k]) => k),
    drivers: worst.slice(0, 3).map(([k, d]) => ({ dimension: k, score: d.score, detail: d.detail })),
    explanation: worst.length
      ? `Health ${score}/100 (${band(score)}) — driven by ` +
        worst.slice(0, 3).map(([k, d]) => `${k} ${d.score}/100 (${d.detail.toLowerCase()})`).join("; ")
      : `Health ${score}/100 — every dimension is green`,
  };
}

module.exports = { computeHealth, computeProgressBy, WEIGHTS, band };
