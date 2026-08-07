"use strict";
// SPM P3 — capacity view: a forward heatmap of who is over-allocated, at
// risk, or free (project + BAU + leave + tentative), the skill gap, and the
// resource-request queue with automated matching.
import { api } from "../lib/api.js";
import { esc, modal, toast, showError, emptyState } from "../lib/ui.js";

const GRAINS = { month: "Months", week: "Weeks" };
let grain = "month";
let periods = 6;
let overloadedOnly = false;

export async function renderCapacity(container) {
  container.innerHTML = `<div class="page-head"><h1>Capacity</h1></div><p class="muted">Loading…</p>`;
  let cap, gap, requests;
  try {
    [cap, gap, requests] = await Promise.all([
      api.get(`/api/v1/reports/capacity?periods=${periods}&grain=${grain}&overloaded=${overloadedOnly}`),
      api.get("/api/v1/reports/skill-gap"),
      api.get("/api/v1/resource-requests"),
    ]);
  } catch (err) { return showError(err); }

  const cell = (p) => {
    const cls = p.over_allocated ? "cap-over" : p.at_risk ? "cap-risk"
      : p.available_percent > 50 ? "cap-free" : "cap-ok";
    return `<td class="cap-cell ${cls}" title="${esc(p.explanation)}">
      <b>${p.used_percent}%</b>${p.tentative_percent ? `<span class="cap-tent">+${p.tentative_percent}</span>` : ""}
      ${p.leave_percent ? `<span class="cap-leave">🏖${p.leave_percent}</span>` : ""}</td>`;
  };

  const openRequests = requests.requests.filter((r) => r.status !== "FILLED" && r.status !== "REJECTED");

  container.innerHTML = `
    <div class="page-head"><h1>Capacity</h1>
      <span class="muted">Who is over-committed, when — and what is still unstaffed</span>
      <span style="margin-left:auto"></span>
      <select id="cap-grain">${Object.entries(GRAINS).map(([k, v]) =>
        `<option value="${k}" ${k === grain ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="cap-periods">${[3, 6, 12].map((n) =>
        `<option value="${n}" ${n === periods ? "selected" : ""}>${n} ahead</option>`).join("")}</select>
      <label class="btn small"><input type="checkbox" id="cap-over" ${overloadedOnly ? "checked" : ""}> Over-allocated only</label>
    </div>

    <div class="panel"><h3>Forward load — day-weighted, leave removes capacity</h3>
      <div class="panel-body" style="overflow-x:auto">
        ${cap.rows.length ? `<table class="cap-table">
          <thead><tr><th>Person</th>${cap.window.periods.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead>
          <tbody>${cap.rows.map((r) => `<tr>
            <td class="cap-name">${esc(r.name)} <span class="muted">${esc(r.site_code || "")}</span></td>
            ${r.periods.map(cell).join("")}</tr>`).join("")}</tbody></table>
          <div class="muted" style="margin-top:8px;font-size:.8rem">
            Cell shows committed + BAU as a share of capacity. <span class="cap-tent">+n</span> is tentative work
            that would tip the person over; 🏖 marks leave. Hover any cell for the full explanation.</div>`
          : `<p class="muted">No one matches this filter.</p>`}
      </div>
    </div>

    <div class="room-grid" style="margin-top:18px">
      <div class="panel"><h3>Unstaffed demand (${openRequests.length})</h3>
        <div class="panel-body">
          ${openRequests.length ? openRequests.map((r) => `
            <div class="bigline" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <b>${esc(r.role)}</b> ${r.percent}% · ${esc(r.project_code)}
              ${r.skill_name ? `<span class="chip div">${esc(r.skill_name)}${r.min_proficiency ? ` ≥${r.min_proficiency}` : ""}</span>` : ""}
              <span class="chip stage">${esc(r.status)}</span>
              <span class="muted">${esc(String(r.start_date).slice(0, 10))} → ${esc(String(r.end_date).slice(0, 10))}</span>
              <button class="btn small match-btn" data-id="${r.id}" style="margin-left:auto">Find people</button>
            </div>`).join("")
            : `<p class="muted">Nothing waiting to be staffed.</p>`}
        </div>
      </div>
      <div class="panel"><h3>Skill gap</h3>
        <div class="panel-body">
          ${gap.rows.length ? gap.rows.map((g) => `
            <div class="bigline"><span class="pill ${g.severity === "CRITICAL" ? "CRITICAL" : g.severity === "HIGH" ? "MAJOR" : "MINOR"}">${esc(g.severity)}</span>
              <b>${esc(g.skill_name)}</b> — ${esc(g.explanation)}</div>`).join("")
            : `<p class="muted">No skills recorded yet.</p>`}
        </div>
      </div>
    </div>`;

  container.querySelector("#cap-grain").onchange = (e) => { grain = e.target.value; renderCapacity(container); };
  container.querySelector("#cap-periods").onchange = (e) => { periods = Number(e.target.value); renderCapacity(container); };
  container.querySelector("#cap-over").onchange = (e) => { overloadedOnly = e.target.checked; renderCapacity(container); };
  container.querySelectorAll(".match-btn").forEach((b) =>
    b.onclick = () => matchModal(Number(b.dataset.id), () => renderCapacity(container)));
}

async function matchModal(requestId, reload) {
  let data;
  try { data = await api.get(`/api/v1/resource-requests/${requestId}/candidates`); }
  catch (err) { return showError(err); }
  const eligible = data.candidates.filter((c) => c.eligible);
  const box = modal({
    title: `Candidates for ${data.request.role} (${data.request.percent}%)`,
    saveLabel: "Assign selected",
    wide: true,
    body: `
      <p class="muted" style="font-size:.85rem">Ranked by skill fit, free capacity in the window, and site.
      ${data.request.status !== "APPROVED" ? "<b>This request is not approved yet — approve it before assigning.</b>" : ""}</p>
      <table class="cap-table"><thead><tr><th></th><th>Person</th><th>Score</th><th>Why</th></tr></thead>
        <tbody>${data.candidates.map((c) => `<tr>
          <td>${c.eligible ? `<input type="radio" name="pick" value="${c.user_id}">` : ""}</td>
          <td>${esc(c.name)} <span class="muted">${esc(c.site_code || "")}</span></td>
          <td>${c.score}</td>
          <td class="muted" style="font-size:.82rem">${esc(c.reason)}</td></tr>`).join("")}</tbody></table>
      ${eligible.length ? "" : `<p class="muted">Nobody currently has free capacity in this window.</p>`}`,
    onSave: async (b) => {
      const pick = b.querySelector("[name=pick]:checked");
      if (!pick) throw new Error("Select a person to assign");
      await api.post(`/api/v1/resource-requests/${requestId}/fulfil`, { user_id: Number(pick.value) });
      toast("Assigned — allocation created");
      reload();
    },
  });
  return box;
}
