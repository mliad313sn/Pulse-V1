"use strict";
import { api, state } from "../lib/api.js";
import { esc, fmtDate, emptyState } from "../lib/ui.js";

const RAG_PILL = { G: "DONE", A: "MAJOR", R: "SLIPPED" };

export async function renderWarRoom(container) {
  const d = await api.get("/api/v1/warroom");

  container.innerHTML = `
    <div class="page-head"><h1>War Room</h1>
      <span class="sub">Active portfolio · stage-gates · RACI responsibilities${state.user.enterpriseAccess === false ? " · scoped to your site" : ""}</span>
    </div>

    ${d.myRaci.length ? `
      <div class="section-title" style="margin-top:0">My RACI responsibilities (${d.myRaci.length})</div>
      <div class="panel" style="margin-bottom:18px"><ul class="simple-list">
        ${d.myRaci.map((r) => `<li>
          <span class="pill ${r.raci_role === "R" ? "CRITICAL" : r.raci_role === "A" ? "MAJOR" : "MINOR"}" title="${{ R: "Responsible", A: "Accountable", C: "Consulted", I: "Informed" }[r.raci_role]}">${r.raci_role}</span>
          ${esc(r.title)} <a class="muted" href="#/projects/${r.project_id}">${esc(r.project_code)}</a>
          <span class="pill ${r.status === "DELIVERED" ? "DONE" : r.status === "IN_PROGRESS" ? "IN_PROGRESS" : "NOT_STARTED"}">${esc(r.status.replace("_", " "))}</span>
          <span class="due">${fmtDate(r.due_date)}</span></li>`).join("")}
      </ul></div>` : ""}

    <div class="section-title" style="margin-top:0">Active projects & stage-gates (${d.projects.length})</div>
    <div class="panel" style="overflow-x:auto"><table class="dtable">
      <tr><th>Project</th><th>RAG</th><th>Governance phase</th><th>Next gate</th><th>Gate requirements</th><th>Deliverables</th><th>PM</th></tr>
      ${d.projects.length ? d.projects.map((p) => `<tr>
        <td><a href="#/projects/${p.id}"><b>${esc(p.code)}</b></a> ${esc(p.title)}<br>
            <span class="muted">${(p.sites || []).join(", ") || "—"} · target ${fmtDate(p.target_date)}</span></td>
        <td><span class="pill ${RAG_PILL[p.rag]}">${p.rag}</span></td>
        <td><b>${esc(p.governance)}</b> <span class="muted">(${esc(p.stage.replace("_", " "))})</span></td>
        <td>${p.gate.next ? `→ ${esc(p.gate.next)}` : '<span class="muted">terminal</span>'}</td>
        <td>${p.gate.requirements.length ? p.gate.requirements.map((r) =>
            `<div style="white-space:nowrap">${r.met ? "✅" : "⬜"} ${esc(r.label)}</div>`).join("")
            : '<span class="muted">none — gate open</span>'}</td>
        <td>${p.deliverable_count ? `${p.delivered_count}/${p.deliverable_count} delivered` : '<span class="muted">—</span>'}</td>
        <td>${esc(p.pm_name || "—")}</td>
      </tr>`).join("") : `<tr><td colspan="7">${emptyState("⚑", "No active projects in your scope.")}</td></tr>`}
    </table></div>

    <div class="section-title">Recent gate approvals</div>
    <div class="panel"><ul class="simple-list">
      ${d.transitions.length ? d.transitions.map((t) => `<li>
        <b>${esc(t.project_code)}</b> ${esc(t.from_stage)} → ${esc(t.to_stage)}
        <span class="muted">approved by ${esc(t.approved_by_name)}${t.note ? ` — ${esc(t.note)}` : ""}</span>
        <span class="due">${fmtDate(t.created_at)}</span></li>`).join("")
        : '<li class="muted">No gate transitions recorded yet.</li>'}
    </ul></div>`;
}
