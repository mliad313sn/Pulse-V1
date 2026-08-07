"use strict";
import { api } from "../lib/api.js";
import { esc, fmtDate, emptyState, toast, showError } from "../lib/ui.js";
import { t } from "../lib/i18n.js";

export async function renderMyActions(container) {
  const d = await api.get("/api/v1/my-work");
  const ragClass = { G: "DONE", A: "MAJOR", R: "SLIPPED" };

  container.innerHTML = `
    <div class="page-head"><h1>${t("my.title")}</h1>
      <span class="sub">${t("my.sub")}</span></div>

    ${d.pmProjects.length ? `
      <div class="section-title" style="margin-top:0">${t("my.pmProjects", { n: d.pmProjects.length })}</div>
      <div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
        ${d.pmProjects.map((p) => `
          <a class="pcard" href="#/projects/${p.id}">
            <div class="row1"><span class="rag-dot ${p.rag}"></span><span class="code">${esc(p.code)}</span>
              <span style="margin-left:auto" class="chip prio">${esc(p.priority)}</span></div>
            <div class="title">${esc(p.title)}</div>
            <div class="pline"><div class="progress"><i style="width:${p.progress_pct}%"></i></div><span>${p.progress_pct}%</span></div>
            <div class="muted">${t("my.target")} ${fmtDate(p.target_date)} · ${esc(p.stage.replace("_", " "))}</div>
          </a>`).join("")}
      </div>` : ""}

    <div class="section-title">${t("my.openActions", { n: d.actions.length })}</div>
    <div class="panel"><ul class="simple-list">
      ${d.actions.length ? d.actions.map((a) => {
        const over = a.due_date && new Date(a.due_date) < new Date();
        return `<li><input type="checkbox" data-act="${a.id}" data-ua="${a.updated_at}" aria-label="${t("my.done")}: ${esc(a.title)}">
          ${esc(a.title)} ${a.project_code ? `<a class="muted" href="#/projects/${a.project_id}">${esc(a.project_code)}</a>` : `<span class="muted">${t("my.general")}</span>`}
          <span class="due ${over ? "over" : ""}">${fmtDate(a.due_date)}${over ? " ⚠" : ""}</span></li>`;
      }).join("") : `<li>${emptyState("☑", t("my.emptyActions"))}</li>`}</ul></div>

    <div class="section-title">${t("my.roadblocks", { n: d.roadblocks.length })}</div>
    <div class="panel"><ul class="simple-list">
      ${d.roadblocks.length ? d.roadblocks.map((r) =>
        `<li><span class="pill ${r.severity}">${r.severity}</span> ${esc(r.title)}
          <a class="muted" href="#/projects/${r.project_id}">${esc(r.project_code)}</a>
          <span class="due">${fmtDate(r.due_date)}</span></li>`).join("")
        : `<li class="muted">${t("my.none")}</li>`}</ul></div>

    <div class="section-title">${t("my.milestones", { n: d.milestones.length })}</div>
    <div class="panel"><ul class="simple-list">
      ${d.milestones.length ? d.milestones.map((m) => {
        const over = new Date(m.due_date) < new Date();
        return `<li>◈ ${esc(m.title)} <span class="pill type">${esc(m.type)}</span>
          <a class="muted" href="#/projects/${m.project_id}">${esc(m.project_code)}</a>
          <span class="due ${over ? "over" : ""}">${fmtDate(m.due_date)}${over ? " ⚠" : ""}</span></li>`;
      }).join("") : '<li class="muted">None due soon.</li>'}</ul></div>`;

  container.querySelectorAll("[data-act]").forEach((cb) => cb.onchange = async () => {
    try {
      await api.put(`/api/v1/actions/${cb.dataset.act}`, { status: "DONE", updated_at: cb.dataset.ua });
      toast("Done ✓");
      renderMyActions(container);
    } catch (err) { showError(err); cb.checked = false; }
  });
}
