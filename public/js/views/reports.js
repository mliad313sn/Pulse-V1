"use strict";
import { api, state } from "../lib/api.js";
import { esc, optionList } from "../lib/ui.js";
import { ensureChart, ensureXlsx } from "../lib/vendor.js";
import { icon } from "../lib/icons.js";

function tokens() {
  const css = getComputedStyle(document.documentElement);
  return {
    navy: css.getPropertyValue("--edv-navy").trim(),
    orange: css.getPropertyValue("--edv-orange").trim(),
    green: css.getPropertyValue("--rag-green").trim(),
    amber: css.getPropertyValue("--rag-amber").trim(),
    red: css.getPropertyValue("--rag-red").trim(),
    ink: css.getPropertyValue("--ink-soft").trim(),
  };
}

async function xlsxExport(rows, name) {
  await ensureXlsx();
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  window.XLSX.writeFile(wb, `PULSE_${name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

let charts = [];

export async function renderReports(container) {
  charts.forEach((c) => c.destroy());
  charts = [];
  const site = new URLSearchParams(location.hash.split("?")[1] || "").get("site") || "";
  const t = tokens();
  const q = site ? `?site=${site}` : "";

  container.innerHTML = `
    <div class="page-head"><h1>Reports</h1>
      <span class="sub">Live from the same data as the wall — every table exports to XLSX</span>
      <span style="margin-left:auto" class="flabel">Site:</span>
      <select id="r-site" class="btn">${optionList(state.meta.sites, "code", (s) => s.code, site, "All sites")}</select>
    </div>
    <div class="report-grid">
      <div class="report-card"><h3>RAG trend (weekly snapshots)
        <button class="btn small xlsx-btn" data-x="trend">${icon("download")}XLSX</button></h3><canvas id="c-trend"></canvas></div>
      <div class="report-card"><h3>Division workload (led / engaged)
        <button class="btn small xlsx-btn" data-x="workload">${icon("download")}XLSX</button></h3><canvas id="c-workload"></canvas></div>
      <div class="report-card"><h3>Roadblock aging (open, by severity)
        <button class="btn small xlsx-btn" data-x="aging">${icon("download")}XLSX</button></h3><canvas id="c-aging"></canvas></div>
      <div class="report-card"><h3>Action resolution (last 6 months)
        <button class="btn small xlsx-btn" data-x="actions">${icon("download")}XLSX</button></h3><canvas id="c-actions"></canvas></div>
      <div class="report-card" style="grid-column:1/-1"><h3>Per-site breakdown
        <button class="btn small xlsx-btn" data-x="sites">${icon("download")}XLSX</button></h3>
        <table class="dtable" id="site-table"></table></div>
    </div>`;

  container.querySelector("#r-site").onchange = (e) => {
    location.hash = `#/reports${e.target.value ? `?site=${e.target.value}` : ""}`;
  };

  const [trend, workload, aging, actions, sites] = await Promise.all([
    ensureChart().then(() => api.get(`/api/v1/reports/rag-trend${q}`)),
    api.get(`/api/v1/reports/division-workload${q}`),
    api.get(`/api/v1/reports/roadblock-aging${q}`),
    api.get(`/api/v1/reports/action-resolution${q}`),
    api.get("/api/v1/reports/site-breakdown"),
  ]);

  const mk = (id, cfg) => charts.push(new window.Chart(container.querySelector(id), cfg));

  mk("#c-trend", {
    type: "line",
    data: {
      labels: trend.rows.map((r) => String(r.snapshot_date).slice(0, 10)),
      datasets: [
        { label: "Green", data: trend.rows.map((r) => r.g), borderColor: t.green, backgroundColor: t.green, tension: .25 },
        { label: "Amber", data: trend.rows.map((r) => r.a), borderColor: t.amber, backgroundColor: t.amber, tension: .25 },
        { label: "Red", data: trend.rows.map((r) => r.r), borderColor: t.red, backgroundColor: t.red, tension: .25 },
      ],
    },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  mk("#c-workload", {
    type: "bar",
    data: {
      labels: workload.rows.map((r) => r.code),
      datasets: [
        { label: "Led", data: workload.rows.map((r) => r.led), backgroundColor: t.navy },
        { label: "Engaged", data: workload.rows.map((r) => r.engaged), backgroundColor: t.orange },
      ],
    },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  mk("#c-aging", {
    type: "bar",
    data: {
      labels: aging.rows.map((r) => r.severity),
      datasets: [
        { label: "< 7 days", data: aging.rows.map((r) => r["0_7"]), backgroundColor: t.green },
        { label: "7–30 days", data: aging.rows.map((r) => r["7_30"]), backgroundColor: t.amber },
        { label: "> 30 days", data: aging.rows.map((r) => r["30_plus"]), backgroundColor: t.red },
      ],
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  });

  mk("#c-actions", {
    type: "bar",
    data: {
      labels: actions.rows.map((r) => r.month),
      datasets: [
        { label: "Created", data: actions.rows.map((r) => r.created), backgroundColor: t.navy },
        { label: "Done", data: actions.rows.map((r) => r.done), backgroundColor: t.green },
        { label: "Overdue now", data: actions.rows.map((r) => r.overdue), backgroundColor: t.red },
      ],
    },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  container.querySelector("#site-table").innerHTML = `
    <tr><th>Site</th><th>Projects</th><th>Green</th><th>Amber</th><th>Red</th><th>Critical roadblocks</th></tr>
    ${sites.rows.map((r) => `<tr>
      <td><a href="#/sites/${esc(r.code)}"><b>${esc(r.code)}</b></a> <span class="muted">${esc(r.name)}</span></td>
      <td>${r.projects}</td>
      <td style="color:var(--rag-green);font-weight:700">${r.g}</td>
      <td style="color:var(--rag-amber);font-weight:700">${r.a}</td>
      <td style="color:var(--rag-red);font-weight:700">${r.r}</td>
      <td>${r.critical_roadblocks}</td></tr>`).join("")}`;

  const datasets = { trend: trend.rows, workload: workload.rows, aging: aging.rows, actions: actions.rows, sites: sites.rows };
  container.querySelectorAll("[data-x]").forEach((b) =>
    b.onclick = () => xlsxExport(datasets[b.dataset.x], `report_${b.dataset.x}${site ? "_" + site : ""}`));
}
