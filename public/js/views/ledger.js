"use strict";
// PULSE ↔ SDP — the capacity ledger view.
//
// The question this screen exists to answer: for any person and any month,
// how many hours are actually left after the helpdesk, routine BAU and project
// commitments have taken their share.
//
// Two rules the UI must never break:
//   * a modelled hour is never shown as if it were measured, and
//   * load that could not be attributed to anybody is shown, not hidden.
import { api } from "../lib/api.js";
import { esc, modal, toast, showError } from "../lib/ui.js";

let months = 6;
let siteFilter = "";
let overloadedOnly = false;

const fmt = (n) => (n == null ? "—" : Math.round(n));

export async function renderLedger(container) {
  container.innerHTML = `<div class="page-head"><h1>Capacity ledger</h1></div><p class="muted">Loading…</p>`;
  let data, unattributed;
  try {
    [data, unattributed] = await Promise.all([
      api.get(`/api/v1/reports/capacity-ledger?months=${months}&site=${encodeURIComponent(siteFilter)}&overloaded=${overloadedOnly}`),
      api.get(`/api/v1/reports/unattributed-load?months=${months}`),
    ]);
  } catch (err) { return showError(err); }

  const sites = [...new Set(data.rows.map((r) => r.site_code).filter(Boolean))].sort();

  const cell = (c) => {
    const cls = c.status === "RED" ? "led-red" : c.status === "AMBER" ? "led-amber"
      : c.status === "NO_CAPACITY_DATA" ? "led-nodata" : "led-green";
    const badge = c.provenance === "MODELLED" ? '<span class="prov prov-model" title="Modelled from an effort standard, not measured">~</span>'
      : c.provenance === "MEASURED" ? '<span class="prov prov-meas" title="Measured from real worklogs">✓</span>'
        : c.provenance === "MIXED" ? '<span class="prov prov-mixed" title="Partly measured, partly modelled">±</span>' : "";
    return `<td class="led-cell ${cls}" title="${esc(c.explanation)}">
      <b>${c.headroom_hours == null ? "—" : fmt(c.headroom_hours)}</b>${badge}
      ${c.utilisation_pct != null ? `<span class="led-util">${Math.round(c.utilisation_pct)}%</span>` : ""}
    </td>`;
  };

  container.innerHTML = `
    <div class="page-head"><h1>Capacity ledger</h1>
      <span class="muted">Available hours − helpdesk − BAU − projects = headroom</span>
      <span style="margin-left:auto"></span>
      <select id="led-site"><option value="">All sites</option>
        ${sites.map((s) => `<option value="${esc(s)}" ${s === siteFilter ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
      <select id="led-months">${[3, 6, 12].map((n) =>
        `<option value="${n}" ${n === months ? "selected" : ""}>${n} months</option>`).join("")}</select>
      <label class="btn small"><input type="checkbox" id="led-over" ${overloadedOnly ? "checked" : ""}> Over capacity only</label>
    </div>

    <div class="note-strip">
      <b>${data.as_of ? `Helpdesk load as of ${new Date(data.as_of).toLocaleString()}` : "No helpdesk load imported yet"}</b>
      — PULSE reads its own copy, so this screen works when ServiceDesk Plus is unreachable.
      <span class="prov prov-model">~</span> modelled ·
      <span class="prov prov-meas">✓</span> measured ·
      <span class="prov prov-mixed">±</span> mixed
    </div>

    <div class="panel"><h3>Headroom by person and month <span class="muted">(hours left, and utilisation)</span></h3>
      <div class="panel-body" style="overflow-x:auto">
        ${data.rows.length ? `<table class="led-table">
          <thead><tr><th>Person</th><th>Site</th>${data.window.periods.map((p) =>
            `<th>${esc(p)}</th>`).join("")}</tr></thead>
          <tbody>${data.rows.map((r) => `<tr>
            <td class="led-name">${esc(r.name)}${r.employment !== "STAFF"
              ? ` <span class="chip div" title="Not permanent staff">${esc(r.employment)}</span>` : ""}</td>
            <td class="muted">${esc(r.site_code || "—")}</td>
            ${r.periods.map(cell).join("")}</tr>`).join("")}</tbody>
        </table>
        <div class="muted" style="margin-top:8px;font-size:.8rem">
          Each cell shows hours of headroom; hover for the full arithmetic. Red is negative headroom,
          amber is 90% or more utilised. Grey means no capacity has been recorded for that person —
          they are shown deliberately rather than dropped.</div>`
        : `<p class="muted">Nobody matches this filter.</p>`}
      </div>
    </div>

    <div class="room-grid" style="margin-top:18px">
      <div class="panel"><h3>Group totals</h3>
        <div class="panel-body" style="overflow-x:auto">
          <table class="led-table">
            <thead><tr><th>Month</th><th class="num">Available</th><th class="num">Helpdesk</th>
              <th class="num">BAU</th><th class="num">Projects</th><th class="num">Headroom</th>
              <th class="num">Used</th><th class="num">Over</th></tr></thead>
            <tbody>${data.totals.by_period.map((t) => `<tr>
              <td>${esc(t.period)}</td>
              <td class="num">${fmt(t.available_hours)}</td>
              <td class="num">${fmt(t.helpdesk_hours)}</td>
              <td class="num">${fmt(t.bau_hours)}</td>
              <td class="num">${fmt(t.project_hours)}</td>
              <td class="num ${t.headroom_hours < 0 ? "led-neg" : ""}">${fmt(t.headroom_hours)}</td>
              <td class="num">${t.utilisation_pct == null ? "—" : `${Math.round(t.utilisation_pct)}%`}</td>
              <td class="num">${t.overloaded || ""}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>

      <div class="panel"><h3>Unattributed load
        <span class="chip ${unattributed.gate1_pass ? "site" : "conf"}">${unattributed.unattributed_pct}%</span></h3>
        <div class="panel-body">
          <p class="muted" style="font-size:.86rem">${esc(unattributed.explanation)}
          Work that cannot be attributed to a person is shown here rather than quietly dropped —
          otherwise a site could look healthier simply by not recording tickets.</p>
          ${unattributed.rows.length ? `<table class="led-table">
            <thead><tr><th>Month</th><th>Site</th><th>Why</th><th class="num">Tickets</th></tr></thead>
            <tbody>${unattributed.rows.slice(0, 12).map((r) => `<tr>
              <td>${esc(r.period)}</td><td>${esc(r.site_code || "—")}</td>
              <td class="muted">${esc(REASONS[r.reason] || r.reason)}</td>
              <td class="num">${r.tickets}</td></tr>`).join("")}</tbody></table>`
            : `<p class="muted">Nothing unattributed.</p>`}
        </div>
      </div>
    </div>`;

  container.querySelector("#led-site").onchange = (e) => { siteFilter = e.target.value; renderLedger(container); };
  container.querySelector("#led-months").onchange = (e) => { months = Number(e.target.value); renderLedger(container); };
  container.querySelector("#led-over").onchange = (e) => { overloadedOnly = e.target.checked; renderLedger(container); };

  container.querySelectorAll(".led-cell").forEach((td, i) => {
    td.onclick = () => {
      const rowIdx = Math.floor(i / data.window.periods.length);
      const colIdx = i % data.window.periods.length;
      const row = data.rows[rowIdx];
      if (row) detailModal(row, row.periods[colIdx]);
    };
  });
}

const REASONS = {
  NO_TECHNICIAN: "Ticket had no technician assigned",
  UNRESOLVED_ALIAS: "Technician name not yet matched to a person",
  NO_TECH_GROUP: "Ticket had no team, so no site could be determined",
  NO_PULSE_USER: "Person exists but has no PULSE account",
};

function detailModal(row, cell) {
  modal({
    title: `${row.name} — ${cell.period}`,
    saveLabel: "Close",
    body: `
      <p style="font-size:.92rem">${esc(cell.explanation)}</p>
      <table class="led-table" style="margin-top:10px">
        <tbody>
          <tr><td>Available</td><td class="num">${fmt(cell.available_hours)} h</td></tr>
          <tr><td>Helpdesk${cell.helpdesk_tickets ? ` (${cell.helpdesk_tickets} tickets)` : ""}</td>
              <td class="num">${fmt(cell.helpdesk_hours)} h</td></tr>
          <tr><td>Routine BAU</td><td class="num">${fmt(cell.bau_hours)} h</td></tr>
          <tr><td>Project commitment</td><td class="num">${fmt(cell.project_hours)} h</td></tr>
          ${cell.tentative_hours ? `<tr><td>Tentative (not yet committed)</td>
              <td class="num">${fmt(cell.tentative_hours)} h</td></tr>` : ""}
          <tr><td><b>Headroom</b></td><td class="num"><b>${fmt(cell.headroom_hours)} h</b></td></tr>
        </tbody>
      </table>
      ${cell.breakdown.length ? `<h4 style="margin:14px 0 6px;font-size:.86rem">Project commitments</h4>
        <ul style="margin:0 0 0 18px;font-size:.86rem">
          ${cell.breakdown.map((b) => `<li>${esc(b.title)} — ${b.percent}%${
            b.hours != null ? ` (${fmt(b.hours)} h)` : ""}${b.tentative ? " <em>tentative</em>" : ""}</li>`).join("")}
        </ul>` : ""}
      <p class="muted" style="margin-top:12px;font-size:.82rem">
        Helpdesk hours are <b>${esc((cell.provenance || "none").toLowerCase())}</b>.
        ${cell.provenance === "MODELLED"
          ? "They come from ticket counts multiplied by an effort standard set by IT management — not from measured time."
          : cell.provenance === "MEASURED" ? "They come from real technician worklogs."
            : "No helpdesk load has been imported for this person and month."}
        Confidence: ${esc(cell.data_confidence)}.</p>`,
    onSave: async () => {},
  });
}
