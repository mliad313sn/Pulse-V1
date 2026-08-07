"use strict";
import { api, state } from "../lib/api.js";
import { esc, fmtDate, emptyState, toast } from "../lib/ui.js";
import { projectCard } from "./portfolio.js";
import { exportGroupDeck } from "../lib/deck.js";
import { icon } from "../lib/icons.js";

const LENS_SITES = ["SGO", "HGO", "ITY", "SML", "MGO", "KGO", "DKR", "ABJ", "OUA"];

export async function renderSiteLens(container, siteCode) {
  const site = siteCode || state.user.siteId
    ? (siteCode || state.meta.sites.find((s) => s.id === state.user.siteId)?.code || "SGO")
    : "SGO";

  container.innerHTML = `
    <div class="page-head"><h1>Site Lens</h1>
      <span class="sub">Everything about one site — the site IT manager's daily page</span>
      <button class="btn primary" id="site-deck" style="margin-left:auto">${icon("download")}Export ${esc(site)} deck</button>
    </div>
    <div class="site-picker">${LENS_SITES.map((s) =>
      `<button class="${s === site ? "active" : ""}" data-site="${s}">${s}</button>`).join("")}</div>
    <div id="lens-body" style="margin-top:16px"><div class="muted">Loading ${esc(site)}…</div></div>`;

  container.querySelectorAll("[data-site]").forEach((b) =>
    b.onclick = () => { location.hash = `#/sites/${b.dataset.site}`; });

  const [cards, lens] = await Promise.all([
    api.get(`/api/v1/projects?site=${site}`),
    api.get(`/api/v1/reports/site-lens?site=${site}`),
  ]);

  container.querySelector("#site-deck").onclick = () =>
    exportGroupDeck(cards.projects, { site });

  const body = container.querySelector("#lens-body");
  body.innerHTML = `
    ${lens.goLives.length ? `<div class="golive-strip"><span class="glabel">Upcoming GO_LIVE</span>
      ${lens.goLives.map((g) => `<span class="gitem"><b>${fmtDate(g.due_date)}</b> — ${esc(g.project_title)} · ${esc(g.title)}</span>`).join("")}</div>` : ""}
    <div class="lens-grid">
      <div class="col">
        <h3 class="section-title" style="margin-top:0">Active projects at ${esc(site)} (${cards.projects.length})</h3>
        <div class="card-grid" style="grid-template-columns:1fr">${cards.projects.length
          ? cards.projects.map(projectCard).join("")
          : emptyState("◎", `No active projects at ${site}.`)}</div>
      </div>
      <div class="col">
        <div class="panel"><h3>Site milestones next 60 days</h3>
          <ul class="simple-list">${lens.milestones.length ? lens.milestones.map((m) => {
            const over = m.due_date && new Date(m.due_date) < new Date();
            return `<li>◈ ${esc(m.title)} <span class="muted">${esc(m.project_code)}</span>
              <span class="due ${over ? "over" : ""}">${fmtDate(m.due_date)}${over ? " ⚠" : ""}</span></li>`;
          }).join("") : '<li class="muted">Nothing due in the next 60 days.</li>'}</ul></div>
        <div class="panel"><h3>Readiness checklists</h3>
          <div class="panel-body">${lens.readiness.length ? lens.readiness.map((r) => {
            const done = r.items.filter((i) => i.checked).length;
            return `<div style="font-size:.84rem;margin-bottom:4px">${esc(r.title)} <span class="muted">${esc(r.project_code)}</span></div>
              <div style="display:flex;align-items:center;gap:8px;font-size:.76rem;color:var(--ink-soft);margin-bottom:10px">
                <div class="progress" style="flex:1"><i style="width:${Math.round((done / r.items.length) * 100)}%;${done < r.items.length ? "background:var(--rag-amber)" : ""}"></i></div>
                <span>${done}/${r.items.length}</span></div>`;
          }).join("") : '<span class="muted" style="font-size:.84rem">No SITE_READINESS milestones here yet.</span>'}</div></div>
        <div class="panel"><h3>Roadblocks touching this site</h3>
          <ul class="simple-list">${lens.roadblocks.length ? lens.roadblocks.map((r) =>
            `<li><span class="pill ${r.severity}">${r.severity}</span> ${esc(r.title)}
             <span class="muted">${esc(r.project_code)}</span><span class="due">${fmtDate(r.due_date)}</span></li>`).join("")
            : `<li style="color:var(--rag-green)">✓ No open roadblocks at ${esc(site)}.</li>`}</ul></div>
        <div class="panel"><h3>Actions owned by site staff</h3>
          <ul class="simple-list">${lens.actions.length ? lens.actions.map((a) =>
            `<li>☐ ${esc(a.title)} <span class="muted">${esc(a.owner_name)}${a.project_code ? " · " + esc(a.project_code) : ""}</span>
             <span class="due ${a.overdue ? "over" : ""}">${fmtDate(a.due_date)}${a.overdue ? " ⚠" : ""}</span></li>`).join("")
            : `<li class="muted">No open actions owned by ${esc(site)} staff.</li>`}</ul></div>
      </div>
    </div>`;
}
