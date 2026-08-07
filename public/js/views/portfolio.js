"use strict";
import { api, state } from "../lib/api.js";
import { el, esc, fmtDate, daysUntil, ragDot, avatar, emptyState, effectiveRag, optionList, modal, toast } from "../lib/ui.js";
import { exportGroupDeck } from "../lib/deck.js";
import { t } from "../lib/i18n.js";

const FILTERS = { division: "", site: "", stage: "", rag: "", priority: "", pm: "", q: "", portfolio: "", program: "" };

function kpiBanner(projects) {
  const eff = effectiveRag;
  const g = projects.filter((p) => eff(p) === "G").length;
  const a = projects.filter((p) => eff(p) === "A").length;
  const r = projects.filter((p) => eff(p) === "R").length;
  const crit = projects.reduce((s, p) => s + (p.critical_roadblocks || 0), 0);
  const overdue = projects.reduce((s, p) => s + (p.overdue_actions || 0), 0);
  const silent = projects.filter((p) => p.rag_signals_json?.freshness?.value === "R").length;
  return `
    <div class="kpi"><div class="num">${projects.length}</div><div class="lbl">Projects in view</div></div>
    <div class="kpi rag"><div class="num"><i class="g">${g}</i><i class="a">${a}</i><i class="r">${r}</i></div><div class="lbl">Green / Amber / Red</div></div>
    <div class="kpi ${crit ? "alert" : ""}"><div class="num">${crit}</div><div class="lbl">Open critical roadblocks</div></div>
    <div class="kpi ${overdue ? "alert" : ""}"><div class="num">${overdue}</div><div class="lbl">Overdue actions</div></div>
    <div class="kpi ${silent ? "alert" : ""}"><div class="num">${silent}</div><div class="lbl">Silent projects (&gt;30d)</div></div>
    <div class="kpi"><div class="num">${projects.filter((p) => p.next_milestone?.type === "GO_LIVE" && daysUntil(p.next_milestone.due_date) <= 30).length}</div><div class="lbl">GO_LIVE ≤ 30 days</div></div>`;
}

export function projectCard(p) {
  const divChips = (p.divisions || [])
    .sort((x, y) => (x.role === "LEAD" ? -1 : 1) - (y.role === "LEAD" ? -1 : 1))
    .map((d) => `<span class="chip div ${d.role === "LEAD" ? "lead" : ""}">${esc(d.code)}</span>`).join("");
  const siteChips = (p.sites || []).map((s) => `<span class="chip site">${esc(s)}</span>`).join("");
  const rb = p.top_roadblock
    ? `<span class="warn">⚑ ${esc(p.top_roadblock.title)} (${esc(p.top_roadblock.severity)})</span>`
    : `<span style="color:var(--rag-green-text)">✓ No open roadblocks</span>`;
  const nm = p.next_milestone
    ? `◈ Next: ${esc(p.next_milestone.title)} — <b>${fmtDate(p.next_milestone.due_date)}</b>`
    : `<span class="muted">No open milestones</span>`;
  const days = p.target_date == null ? "—"
    : daysUntil(p.target_date) < 0 ? `<span class="warn">${-daysUntil(p.target_date)}d past target</span>`
    : `${daysUntil(p.target_date)}d to target`;
  return `
  <a class="pcard" href="#/projects/${p.id}">
    <div class="row1">
      ${ragDot(p)}
      <span class="code">${esc(p.code)}</span>
      ${p.governance === "LITE" ? '<span class="chip site" title="Light governance">LITE</span>' : ""}
      ${p.confidential ? '<span class="chip conf">CONFIDENTIAL</span>' : ""}
      <span style="margin-left:auto" class="chip prio">${esc(p.priority)}</span>
    </div>
    <div class="title">${esc(p.title)}</div>
    <div class="chips"><span class="chip stage">${esc(p.stage.replace("_", " "))}</span>${p.operating_status === "ON_HOLD" ? '<span class="chip stage HOLD">ON HOLD</span>' : ""}${p.operating_status === "CANCELLED" ? '<span class="chip conf">CANCELLED</span>' : ""}${divChips}${siteChips}</div>
    <div class="pline">
      <div class="progress"><i style="width:${p.progress_pct}%"></i></div>
      <span>${p.progress_pct}% <span style="color:var(--ink-faint)">(milestones done)</span></span>
    </div>
    <div class="meta">${rb}<span>${nm}</span></div>
    <div class="foot">
      <span class="pm-cell">${p.pm_name ? `${avatar(p.pm_name, p.pm_role === "CONTRIBUTOR")}
        <span>${esc(p.pm_name)}<br><span style="font-size:.66rem;color:var(--ink-faint)">PM${p.pm_role === "CONTRIBUTOR" ? " · Site IT lead" : ""}</span></span>` : '<span class="muted">No PM assigned</span>'}</span>
      <span>${days}</span>
    </div>
  </a>`;
}

function newProjectModal(onDone) {
  const m = state.meta;
  modal({
    title: "New project",
    wide: true,
    saveLabel: "Create project",
    body: `
      <div class="frow"><div class="field" style="flex:2"><label>Title</label><input name="title" required></div>
        <div class="field"><label>Priority</label><select name="priority">${["P1", "P2", "P3"].map((p) => `<option ${p === "P2" ? "selected" : ""}>${p}</option>`).join("")}</select></div></div>
      <div class="frow"><div class="field"><label>Lead division</label><select name="lead">${optionList(m.divisions, "id", (d) => `${d.code} — ${d.name}`)}</select></div>
        <div class="field"><label>Project manager (any non-Viewer, incl. site IT leads)</label>
          <select name="pm">${optionList(m.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, "", "— none yet —")}</select></div></div>
      <div class="frow"><div class="field"><label>Engaged divisions</label>
          <select name="engaged" multiple size="4">${optionList(m.divisions, "id", (d) => d.code)}</select><div class="hint">Ctrl/Cmd-click for multiple</div></div>
        <div class="field"><label>Sites</label>
          <select name="sites" multiple size="4">${optionList(m.sites, "id", (s) => s.code)}</select></div></div>
      <div class="frow"><div class="field"><label>Start date</label><input name="start" type="date"></div>
        <div class="field"><label>Target date</label><input name="target" type="date"></div>
        <div class="field"><label>Stage</label><select name="stage">${["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN"].map((s) => `<option>${s}</option>`).join("")}</select></div></div>
      <div class="field"><label>Description</label><textarea name="description"></textarea></div>
      <div class="frow"><div class="field"><label>Sponsor</label><input name="sponsor"></div>
        <div class="field"><label>Governance tier</label><select name="governance">
          <option value="STANDARD">STANDARD — full gate evidence</option>
          <option value="LITE">LITE — small/simple project, lighter paperwork</option>
        </select><div class="hint">Same stages &amp; approvals either way — LITE only trims required evidence.</div></div></div>`,
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`).value;
      const multi = (n) => [...box.querySelector(`[name=${n}]`).selectedOptions].map((o) => Number(o.value));
      const lead = Number(v("lead"));
      const res = await api.post("/api/v1/projects", {
        title: v("title"), priority: v("priority"), lead_division_id: lead,
        project_manager_id: v("pm") ? Number(v("pm")) : null,
        stage: v("stage"), description: v("description") || null, sponsor: v("sponsor") || null,
        governance: v("governance"),
        start_date: v("start") || null, target_date: v("target") || null,
        divisions: multi("engaged").filter((id) => id !== lead).map((id) => ({ division_id: id, role_in_project: "ENGAGED" })),
        sites: multi("sites"),
      });
      toast(`Project ${res.project.code} created`);
      onDone();
    },
  });
}

export async function renderPortfolio(container) {
  const m = state.meta;
  // Deep links from the Portfolios view: #/portfolio?portfolio=3 / ?program=5
  const qIdx = location.hash.indexOf("?");
  if (qIdx >= 0) {
    const qs = new URLSearchParams(location.hash.slice(qIdx + 1));
    FILTERS.portfolio = qs.get("portfolio") || "";
    FILTERS.program = qs.get("program") || "";
  }
  container.innerHTML = `
    <div class="page-head"><h1>${t("wall.title")}</h1>
      <span class="sub">${t("wall.sub")}</span>
      ${["ADMIN", "DIVISION_LEAD"].includes(state.user.role) ? `<button class="btn navy" id="new-project" style="margin-left:auto">${t("wall.newProject")}</button>` : ""}
    </div>
    <div class="kpi-banner" id="kpis"></div>
    <div class="filterbar">
      <span class="flabel">${t("wall.filter")}</span>
      <select id="f-division" aria-label="${t("wall.divisionAll")}">${optionList(m.divisions, "code", (d) => `${d.code} — ${d.name}`, FILTERS.division, t("wall.divisionAll"))}</select>
      <select id="f-site" aria-label="${t("wall.siteAll")}">${optionList(m.sites, "code", (s) => s.code, FILTERS.site, t("wall.siteAll"))}</select>
      <select id="f-stage" aria-label="${t("wall.stageAll")}"><option value="">${t("wall.stageAll")}</option>${["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN", "CLOSED"].map((s) => `<option ${FILTERS.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="f-rag" aria-label="${t("wall.ragAll")}"><option value="">${t("wall.ragAll")}</option>${["G", "A", "R"].map((r) => `<option ${FILTERS.rag === r ? "selected" : ""}>${r}</option>`).join("")}</select>
      <select id="f-priority" aria-label="${t("wall.priorityAll")}"><option value="">${t("wall.priorityAll")}</option>${["P1", "P2", "P3"].map((p) => `<option ${FILTERS.priority === p ? "selected" : ""}>${p}</option>`).join("")}</select>
      <select id="f-pm" aria-label="${t("wall.pmAll")}">${optionList(m.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, FILTERS.pm, t("wall.pmAll"))}</select>
      ${FILTERS.portfolio || FILTERS.program ? `<span class="pill DONE">${FILTERS.program ? t("wall.hierarchyOn.program") : t("wall.hierarchyOn.portfolio")}</span>` : ""}
      <button class="clear" id="f-clear">${t("wall.clear")}</button>
      <span style="flex:1"></span>
      <button class="btn primary" id="export-deck">${t("wall.exportDeck")}</button>
      <a class="btn small" id="export-xlsx" download>${t("wall.exportXlsx")}</a>
      <a class="btn small" id="export-pdf" download>${t("wall.exportPdf")}</a>
    </div>
    <div class="card-grid" id="cards"></div>`;

  let current = [];
  async function refresh() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(FILTERS)) if (v) params.set(k, v);
    const res = await api.get(`/api/v1/projects?${params}`);
    current = res.projects;
    // server-side exports carry the SAME filters; scope is resolved server-side
    container.querySelector("#export-xlsx").href = `/api/v1/exports/portfolio.xlsx?${params}`;
    container.querySelector("#export-pdf").href = `/api/v1/exports/portfolio.pdf?${params}`;
    container.querySelector("#kpis").innerHTML = kpiBanner(current);
    container.querySelector("#cards").innerHTML = current.length
      ? current.map(projectCard).join("")
      : emptyState("◎", t("wall.emptyTitle"), t("wall.emptyHint"));
  }

  for (const key of ["division", "site", "stage", "rag", "priority", "pm"]) {
    container.querySelector(`#f-${key}`).onchange = (e) => { FILTERS[key] = e.target.value; refresh(); };
  }
  container.querySelector("#f-clear").onclick = () => {
    Object.keys(FILTERS).forEach((k) => (FILTERS[k] = ""));
    if (location.hash.includes("?")) location.hash = "#/portfolio"; // re-renders via router
    else renderPortfolio(container);
  };
  const npBtn = container.querySelector("#new-project");
  if (npBtn) npBtn.onclick = () => newProjectModal(refresh);
  container.querySelector("#export-deck").onclick = () =>
    exportGroupDeck(current, { site: FILTERS.site, division: FILTERS.division, stage: FILTERS.stage });

  await refresh();
}
