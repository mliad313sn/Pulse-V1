"use strict";
// SPM Phase 6 — pure portfolio mathematics.
//
// optimizePortfolio: 0/1 knapsack (dynamic programming, $1k granularity)
// maximizing total value under a budget constraint. Mandatory candidates are
// funded FIRST regardless of score (compliance is not optional); the DP runs
// over the remaining budget. Every inclusion/exclusion carries a reason.
function optimizePortfolio(candidates, budgetTotal) {
  const GRAIN = 1000;
  const mandatory = candidates.filter((c) => c.mandatory);
  const optional = candidates.filter((c) => !c.mandatory);
  const mandatoryCost = mandatory.reduce((s, c) => s + Number(c.cost || 0), 0);
  const selected = mandatory.map((c) => ({ ...c, reason: `MANDATORY: ${c.mandatory_reason || "compliance"}` }));
  const remaining = Math.max(0, Number(budgetTotal) - mandatoryCost);

  const W = Math.floor(remaining / GRAIN);
  const items = optional.map((c) => ({
    ...c,
    w: Math.max(1, Math.ceil(Number(c.cost || 0) / GRAIN)),
    v: Number(c.value || 0),
  }));
  // DP table: best value for capacity w using first i items
  const dp = Array.from({ length: items.length + 1 }, () => new Float64Array(W + 1));
  for (let i = 1; i <= items.length; i++) {
    const it = items[i - 1];
    for (let w = 0; w <= W; w++) {
      dp[i][w] = dp[i - 1][w];
      if (it.w <= w) dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - it.w] + it.v);
    }
  }
  // backtrack
  const chosen = new Set();
  let w = W;
  for (let i = items.length; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      chosen.add(items[i - 1].id);
      w -= items[i - 1].w;
    }
  }
  const rejected = [];
  for (const it of items) {
    if (chosen.has(it.id)) {
      selected.push({ ...it, reason: `Selected: value ${it.v} for ${Number(it.cost).toLocaleString("en-US")} fits the remaining budget` });
    } else {
      rejected.push({ ...it, reason: `Not funded: including it displaces more value than it adds within the budget` });
    }
  }
  const totalCost = selected.reduce((s, c) => s + Number(c.cost || 0), 0);
  const totalValue = selected.reduce((s, c) => s + Number(c.value || c.v || 0), 0);
  return {
    budget: Number(budgetTotal), mandatoryCost,
    selected, rejected,
    totalCost, totalValue,
    overBudget: totalCost > Number(budgetTotal),
    explanation: `Mandatory items consume ${mandatoryCost.toLocaleString("en-US")}; ` +
      `optimal packing of the remaining ${remaining.toLocaleString("en-US")} funds ` +
      `${selected.length - mandatory.length} of ${optional.length} optional candidates ` +
      `for total value ${Math.round(totalValue * 100) / 100}.`,
  };
}

// evaluateMoves: deterministic what-if effects of scenario moves on projects.
// Moves: {project_id, action: DEFER|STOP|BUDGET_DELTA, months?, amount?}
function evaluateMoves(projects, moves) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const effects = [];
  let budgetDelta = 0;
  for (const m of moves) {
    const p = byId.get(m.project_id);
    if (!p) { effects.push({ project_id: m.project_id, error: "Project not in scope" }); continue; }
    if (m.action === "DEFER") {
      const months = Number(m.months || 0);
      let newTarget = null;
      if (p.target_date) {
        const d = new Date(p.target_date);
        d.setUTCMonth(d.getUTCMonth() + months);
        newTarget = d.toISOString().slice(0, 10);
      }
      effects.push({
        project_id: p.id, code: p.code, action: "DEFER",
        schedule: { from: p.target_date ? String(p.target_date).slice(0, 10) : null, to: newTarget, months },
        detail: `${p.code} deferred ${months} month(s)${newTarget ? ` — target moves to ${newTarget}` : ""}`,
      });
    } else if (m.action === "STOP") {
      const freed = Math.max(0, Number(p.budget_approved || 0) - Number(p.budget_actual || 0));
      budgetDelta -= freed;
      effects.push({
        project_id: p.id, code: p.code, action: "STOP",
        budget: { freed },
        detail: `${p.code} stopped — frees ${freed.toLocaleString("en-US")} of unspent approved budget`,
      });
    } else if (m.action === "BUDGET_DELTA") {
      const amount = Number(m.amount || 0);
      budgetDelta += amount;
      effects.push({
        project_id: p.id, code: p.code, action: "BUDGET_DELTA",
        budget: { delta: amount },
        detail: `${p.code} budget ${amount >= 0 ? "increased" : "reduced"} by ${Math.abs(amount).toLocaleString("en-US")}`,
      });
    } else {
      effects.push({ project_id: m.project_id, error: `Unknown action ${m.action}` });
    }
  }
  return { effects, budgetDelta };
}

module.exports = { optimizePortfolio, evaluateMoves };
