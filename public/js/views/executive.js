"use strict";
import { api, state } from "../lib/api.js";
import { esc, fmtDate, emptyState } from "../lib/ui.js";

const RAG_PILL = { G: "DONE", A: "MAJOR", R: "SLIPPED" };

export async function renderExecutive(container) {
  const d = await api.get("/api/v1/reports/executive");
  const ex = d.exceptions;
  container.innerHTML = `
    <div class="page-head"><h1>Executive Command Center</h1>
      <span class="sub">What needs attention, what is late, what is coming — one screen</span></div>

    <div class="kpi-banner">
      <div class="kpi ${d.attention.length ? "alert" : ""}"><div class="num">${d.attention.length}</div><div class="lbl">RED projects</div></div>
      <div class="kpi ${d.gatesWaiting.length ? "alert" : ""}"><div class="num">${d.gatesWaiting.length}</div><div class="lbl">Decisions waiting (gates)</div></div>
      <div class="kpi"><div class="num">${d.goLives.length}</div><div class="lbl">GO_LIVEs ≤ 45 days</div></div>
      <div class="kpi ${ex.overdue_milestones ? "alert" : ""}"><div class="num">${ex.overdue_milestones}</div><div class="lbl">Overdue milestones</div></div>
      <div class="kpi ${ex.critical_roadblocks ? "alert" : ""}"><div class="num">${ex.critical_roadblocks}</div><div class="lbl">Critical roadblocks</div></div>
      <div class="kpi ${d.overloaded.length ? "alert" : ""}"><div class="num">${d.overloaded.length}</div><div class="lbl">Overloaded people</div></div>
    </div>

    <div class="report-grid">
      <div class="report-card"><h3>Needs intervention — and why</h3>
        <ul class="simple-list">${d.attention.length ? d.attention.map((p) => `
          <li><span class="pill SLIPPED">R</span> <a href="#/projects/${p.id}"><b>${esc(p.code)}</b></a>
            ${esc(p.title)}<br><span class="muted">${esc(p.why)} · PM ${esc(p.pm_name || "—")}</span></li>`).join("")
          : `<li>${emptyState("✓", "Nothing red right now.")}</li>`}</ul></div>

      <div class="report-card"><h3>Decisions waiting (Steering gates)</h3>
        <ul class="simple-list">${d.gatesWaiting.length ? d.gatesWaiting.map((p) => `
          <li>⏳ <a href="#/projects/${p.id}"><b>${esc(p.code)}</b></a> ${esc(p.title)}
            <span class="muted">PLANNING → EXECUTION ready for approval</span></li>`).join("")
          : '<li class="muted">No gates waiting.</li>'}</ul></div>

      <div class="report-card"><h3>Upcoming go-lives</h3>
        <ul class="simple-list">${d.goLives.length ? d.goLives.map((g) => `
          <li>◈ <b>${fmtDate(g.due_date)}</b> — <a href="#/projects/${g.project_id}">${esc(g.code)}</a>
            ${esc(g.project_title)} · ${esc(g.title)}</li>`).join("")
          : '<li class="muted">None in the next 45 days.</li>'}</ul></div>

      <div class="report-card"><h3>Resource pressure</h3>
        <ul class="simple-list">${d.overloaded.length ? d.overloaded.map((o) => `
          <li>⚠ <b>${esc(o.name)}</b> <span class="muted">${esc(o.explanation)}</span></li>`).join("")
          : '<li class="muted">Nobody over 100% today.</li>'}</ul></div>

      <div class="report-card"><h3>Site health</h3>
        <table class="dtable"><tr><th>Site</th><th>Projects</th><th>G</th><th>A</th><th>R</th><th>Critical RB</th></tr>
          ${d.sites.filter((s) => s.projects > 0).map((s) => `<tr>
            <td><a href="#/sites/${esc(s.code)}"><b>${esc(s.code)}</b></a></td><td>${s.projects}</td>
            <td style="color:var(--rag-green);font-weight:700">${s.g}</td>
            <td style="color:var(--rag-amber);font-weight:700">${s.a}</td>
            <td style="color:var(--rag-red);font-weight:700">${s.r}</td>
            <td>${s.critical_roadblocks}</td></tr>`).join("")}</table></div>

      ${d.finance ? `<div class="report-card"><h3>Financial position (authorized view)</h3>
        <div class="panel-body" style="font-size:1rem">
          Approved <b>${d.finance.approved.toLocaleString("en-US")}</b> ·
          Forecast <b>${d.finance.forecast.toLocaleString("en-US")}</b> ·
          Variance <b style="color:${d.finance.variance > 0 ? "var(--rag-red)" : "var(--rag-green)"}">
            ${d.finance.variance >= 0 ? "+" : ""}${d.finance.variance.toLocaleString("en-US")}</b>
        </div></div>` : ""}
    </div>`;
}
