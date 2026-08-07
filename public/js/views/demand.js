"use strict";
// SPM P1 — Demand backlog: ranked ideas with explainable scores, intake modal,
// Steering decisions, Admin/DL conversion. Controls appear only for roles that
// can actually use them (the server enforces regardless).
import { api, state } from "../lib/api.js";
import { esc, fmtDate, modal, toast, showError, optionList, emptyState } from "../lib/ui.js";

const MODELS = [["wsjf", "WSJF"], ["rice", "RICE"], ["weighted", "Weighted"], ["cd3", "Cost of delay"]];
let model = "wsjf";

export async function renderDemand(container) {
  const u = state.user;
  const canRaise = u.role !== "VIEWER";
  const canDecide = u.role === "ADMIN" || u.isSteeringCommittee === true;
  const canConvert = ["ADMIN", "DIVISION_LEAD"].includes(u.role);

  const [rankedRes, allRes] = await Promise.all([
    api.get(`/api/v1/demands/ranked?model=${model}`),
    api.get("/api/v1/demands"),
  ]);
  const backlog = rankedRes.demands;
  const drafts = allRes.demands.filter((d) => d.status === "DRAFT");
  const decided = allRes.demands.filter((d) => ["APPROVED", "REJECTED", "CONVERTED"].includes(d.status));

  const pill = (s) => s === "APPROVED" ? "DONE" : s === "REJECTED" ? "SLIPPED" : s === "CONVERTED" ? "DONE" : "MAJOR";

  container.innerHTML = `
    <div class="page-head"><h1>Demand</h1>
      <span class="sub">Every idea scored, ranked and formally decided before it becomes a project</span>
      ${canRaise ? '<button class="btn navy" id="new-demand" style="margin-left:auto">＋ New idea</button>' : ""}
    </div>

    <div class="filterbar">
      <span class="flabel">Ranking model:</span>
      ${MODELS.map(([k, label]) => `<button class="btn small ${model === k ? "navy" : ""}" data-model="${k}">${label}</button>`).join("")}
      <span class="muted" style="margin-left:8px">Mandatory/compliance items always rank first</span>
    </div>

    <div class="panel"><h3 style="padding:10px 14px 0">Submitted backlog (${backlog.length})</h3>
      <div class="panel-body">
      ${backlog.length ? `<table class="ms-list">
        <tr><th>#</th><th>Idea</th><th>Score — why</th><th>Effort</th><th>From</th><th></th></tr>
        ${backlog.map((d) => `<tr>
          <td><b>${d.rank}</b></td>
          <td><b>${esc(d.title)}</b>${d.mandatory ? ' <span class="chip conf">MANDATORY</span>' : ""}
            ${d.problem ? `<br><span class="muted">${esc(d.problem)}</span>` : ""}</td>
          <td class="muted" style="max-width:320px">${esc(d.scoring.formula)}
            ${d.scoring.missing?.length ? `<br><span style="color:var(--rag-amber-text)">Missing: ${d.scoring.missing.join(", ")}</span>` : ""}</td>
          <td>${d.estimated_effort_weeks != null ? `${d.estimated_effort_weeks}w` : "—"}</td>
          <td class="muted">${esc(d.requester_name || "—")}${d.site_code ? ` · ${esc(d.site_code)}` : ""}</td>
          <td>${canDecide ? `
            <button class="btn small" data-decide="APPROVED" data-id="${d.id}" data-ua="${d.updated_at}">Approve</button>
            <button class="btn small ghost-danger" data-decide="REJECTED" data-id="${d.id}" data-ua="${d.updated_at}">Reject</button>` : ""}</td>
        </tr>`).join("")}</table>`
        : emptyState("◇", "No submitted ideas.", canRaise ? "Raise one — it takes a minute." : "")}
      </div>
    </div>

    ${drafts.length ? `<div class="panel" style="margin-top:14px"><h3 style="padding:10px 14px 0">My drafts</h3>
      <div class="panel-body"><ul class="simple-list">
        ${drafts.map((d) => `<li><b>${esc(d.title)}</b>
          ${d.requester_id === u.id || canConvert ? `<button class="btn small" data-submit="${d.id}" data-ua="${d.updated_at}">Submit for review</button>` : ""}
        </li>`).join("")}</ul></div></div>` : ""}

    ${decided.length ? `<div class="panel" style="margin-top:14px"><h3 style="padding:10px 14px 0">Decided</h3>
      <div class="panel-body"><ul class="simple-list">
        ${decided.map((d) => `<li><span class="pill ${pill(d.status)}">${d.status}</span> <b>${esc(d.title)}</b>
          ${d.decision_note ? `<span class="muted">— ${esc(d.decision_note)}</span>` : ""}
          ${d.project_code ? ` <a href="#/portfolio"><span class="chip div">${esc(d.project_code)}</span></a>` : ""}
          ${d.status === "APPROVED" && canConvert ? `<button class="btn small navy" data-convert="${d.id}">Convert to project</button>` : ""}
        </li>`).join("")}</ul></div></div>` : ""}`;

  container.querySelectorAll("[data-model]").forEach((b) => b.onclick = () => { model = b.dataset.model; renderDemand(container); });

  const nd = container.querySelector("#new-demand");
  if (nd) nd.onclick = () => modal({
    title: "New idea",
    wide: true,
    body: `
      <div class="field"><label>Title</label><input name="title" required></div>
      <div class="field"><label>What hurts today?</label><textarea name="problem"></textarea></div>
      <div class="field"><label>What gets better if we do it?</label><textarea name="outcome"></textarea></div>
      <div class="frow">
        <div class="field"><label>Business value (1–10)</label><input name="bv" type="number" min="1" max="10"></div>
        <div class="field"><label>Time criticality (1–10)</label><input name="tc" type="number" min="1" max="10"></div>
        <div class="field"><label>Risk reduction (1–10)</label><input name="rr" type="number" min="1" max="10"></div>
        <div class="field"><label>Effort (weeks)</label><input name="eff" type="number" min="0" step="0.5"></div>
      </div>
      <div class="field"><label><input type="checkbox" name="mand"> Mandatory / compliance (needs a reason)</label></div>
      <div class="field"><label>Mandatory reason</label><input name="mandReason" placeholder="e.g. regulator deadline"></div>`,
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`).value;
      const num = (n) => (v(n) === "" ? null : Number(v(n)));
      await api.post("/api/v1/demands", {
        title: v("title"), problem: v("problem") || null, outcome_hypothesis: v("outcome") || null,
        business_value: num("bv"), time_criticality: num("tc"), risk_reduction: num("rr"),
        estimated_effort_weeks: num("eff"),
        mandatory: box.querySelector("[name=mand]").checked,
        mandatory_reason: v("mandReason") || null,
      });
      toast("Idea saved as draft — submit it when ready");
      renderDemand(container);
    },
  });

  container.querySelectorAll("[data-submit]").forEach((b) => b.onclick = async () => {
    try {
      await api.put(`/api/v1/demands/${b.dataset.submit}`, { status: "SUBMITTED", updated_at: b.dataset.ua });
      toast("Submitted for review");
      renderDemand(container);
    } catch (err) { showError(err); }
  });

  container.querySelectorAll("[data-decide]").forEach((b) => b.onclick = () => modal({
    title: `${b.dataset.decide === "APPROVED" ? "Approve" : "Reject"} demand`,
    body: `<div class="field"><label>Decision note (required)</label><textarea name="note"></textarea></div>`,
    onSave: async (box) => {
      await api.post(`/api/v1/demands/${b.dataset.id}/decision`, {
        decision: b.dataset.decide, note: box.querySelector("[name=note]").value, updated_at: b.dataset.ua,
      });
      toast(`Demand ${b.dataset.decide.toLowerCase()}`);
      renderDemand(container);
    },
  }));

  container.querySelectorAll("[data-convert]").forEach((b) => b.onclick = () => modal({
    title: "Convert to project",
    body: `<div class="field"><label>Lead division</label><select name="lead">${optionList(state.meta.divisions, "id", (d) => `${d.code} — ${d.name}`)}</select></div>
      <div class="field"><label>Governance tier</label><select name="gov">
        <option value="STANDARD">STANDARD — full gate evidence</option>
        <option value="LITE">LITE — small/simple project</option></select></div>
      <p class="muted">Creates an IDEA-stage project carrying the demand's narrative and site, permanently linked for traceability.</p>`,
    onSave: async (box) => {
      const res = await api.post(`/api/v1/demands/${b.dataset.convert}/convert`, {
        lead_division_id: Number(box.querySelector("[name=lead]").value),
        governance: box.querySelector("[name=gov]").value,
      });
      toast(`Project ${res.project.code} created from demand`);
      renderDemand(container);
    },
  }));
}
