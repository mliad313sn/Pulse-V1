"use strict";
import { api } from "../lib/api.js";
import { esc, fmtDate, emptyState } from "../lib/ui.js";

const HEALTH_PILL = { G: "DONE", A: "MAJOR", R: "SLIPPED" };

export async function renderPortfolios(container) {
  const d = await api.get("/api/v1/portfolios");
  const pillars = await api.get("/api/v1/pillars");
  const byPillar = new Map();
  for (const pf of d.portfolios) {
    const key = pf.pillar_name || "Unassigned pillar";
    if (!byPillar.has(key)) byPillar.set(key, []);
    byPillar.get(key).push(pf);
  }

  container.innerHTML = `
    <div class="page-head"><h1>Portfolios</h1>
      <span class="sub">Strategic pillars → portfolios → programs — health rolled up from the projects you can see</span></div>
    ${!d.portfolios.length ? emptyState("▦", "No portfolios yet. An Admin or Division Lead can create them via the API or admin tools.") :
      [...byPillar.entries()].map(([pillarName, pfs]) => `
      <h2 class="section-title">${esc(pillarName)}</h2>
      <div class="report-grid">
        ${pfs.map((pf) => `
        <div class="report-card">
          <h3>${pf.health ? `<span class="pill ${HEALTH_PILL[pf.health]}">${pf.health}</span> ` : ""}${esc(pf.title)}</h3>
          ${pf.objective ? `<p class="muted">${esc(pf.objective)}</p>` : ""}
          <div class="muted" style="margin:.35rem 0">
            ${pf.project_count} project${pf.project_count === 1 ? "" : "s"}
            ${pf.red_count ? ` · <b style="color:var(--rag-red)">${pf.red_count} red</b>` : ""}
            ${pf.amber_count ? ` · <b style="color:var(--rag-amber)">${pf.amber_count} amber</b>` : ""}
            · ${pf.site_count} site${pf.site_count === 1 ? "" : "s"} · ${pf.division_count} division${pf.division_count === 1 ? "" : "s"}
            ${pf.owner_name ? ` · Owner ${esc(pf.owner_name)}` : ""}
            ${pf.horizon_end ? ` · Horizon ${fmtDate(pf.horizon_start)} → ${fmtDate(pf.horizon_end)}` : ""}
          </div>
          ${pf.finance ? `<div class="muted">Approved <b>${Number(pf.finance.approved).toLocaleString("en-US")}</b>
            · Forecast <b>${Number(pf.finance.forecast).toLocaleString("en-US")}</b>
            · Benefits realized <b>${pf.benefits_realized}</b></div>` : ""}
          ${(pf.programs || []).length ? `<div style="margin-top:.35rem"><span class="muted">Programs:</span>
            ${pf.programs.map((pr) => `<a href="#/portfolio?program=${pr.id}">${esc(pr.title)}</a>`).join(" · ")}</div>` : ""}
          <div style="margin-top:.5rem"><a class="btn small" href="#/portfolio?portfolio=${pf.id}">View projects →</a></div>
        </div>`).join("")}
      </div>`).join("")}
    ${pillars.pillars.length && !d.portfolios.length ? `<p class="muted">Pillars defined: ${pillars.pillars.map((p) => esc(p.name)).join(", ")}</p>` : ""}`;
}
