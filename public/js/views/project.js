"use strict";
import { api, state } from "../lib/api.js";
import { esc, fmtDate, isoDate, ragDot, avatar, modal, toast, showError, optionList, emptyState } from "../lib/ui.js";
import { exportProjectDeck } from "../lib/deck.js";

const STAGES = ["IDEA", "DESIGN", "BUILD", "DEPLOY", "RUN"];
let activeTab = "timeline";

export async function renderProject(container, projectId) {
  const d = await api.get(`/api/v1/projects/${projectId}`);
  const p = d.project;
  const canFull = d.access === "FULL";
  const canPartial = canFull || d.access === "PARTIAL";
  const m = state.meta;

  const stageIdx = STAGES.indexOf(p.stage);
  const stepper = STAGES.map((s, i) => `
    <span class="step ${p.stage === "ON_HOLD" || p.stage === "CLOSED" ? "" : i < stageIdx ? "done" : i === stageIdx ? "now" : ""}">
      <span class="node">${s}</span>${i < STAGES.length - 1 ? '<span class="bar"></span>' : ""}</span>`).join("");

  container.innerHTML = `
    <a href="#/portfolio" style="font-size:.8rem;color:var(--ink-soft)">← Portfolio</a>
    <div class="proj-header" style="margin-top:8px">
      <div class="toprow">
        ${ragDot(p)}
        <h1>${esc(p.title)}</h1>
        <span style="color:var(--ink-faint);font-weight:700;font-size:.8rem">${esc(p.code)}</span>
        <span class="chip prio">${esc(p.priority)}</span>
        ${p.confidential ? '<span class="chip conf">CONFIDENTIAL</span>' : ""}
        <span style="margin-left:auto" class="chip stage ${p.stage === "ON_HOLD" ? "HOLD" : ""}">${esc(p.stage.replace("_", " "))}</span>
        ${canFull ? '<button class="btn small" id="edit-project">✎ Edit</button>' : ""}
        <button class="btn primary small" id="export-project-deck">⬇ Project deck</button>
      </div>
      <div class="stepper">${stepper}${p.stage === "ON_HOLD" ? '<span class="chip stage HOLD" style="margin-left:10px">ON HOLD</span>' : ""}</div>
      <div class="facts">
        <span>Project Manager<b>${d.pm ? `${avatar(d.pm.name, d.pm.role === "CONTRIBUTOR", 20)} ${esc(d.pm.name)}
          <span style="font-weight:400;color:var(--ink-faint)">(${esc(d.pm.role.replace("_", " "))})</span>` : "—"}</b></span>
        <span>Sponsor<b>${esc(p.sponsor || "—")}</b></span>
        <span>Divisions<b>${d.divisions.map((x) => `<span class="chip div ${x.role_in_project === "LEAD" ? "lead" : ""}">${esc(x.code)}</span>`).join(" ")}</b></span>
        <span>Sites<b>${d.sites.length ? d.sites.map((s) => `<span class="chip site">${esc(s.code)}</span>`).join(" ") : "—"}</b></span>
        <span>Start → Target<b>${fmtDate(p.start_date)} → ${fmtDate(p.target_date)}</b></span>
        <span>Progress (computed)<b>${p.progress_pct}% — ${d.milestones.filter((x) => x.status === "DONE").length} / ${d.milestones.length} milestones done</b></span>
      </div>
    </div>
    <div class="room-grid">
      <div>
        <div class="tabs">
          <button data-tab="timeline">Timeline</button>
          <button data-tab="roadblocks">Roadblocks ${d.roadblocks.filter((r) => r.status !== "RESOLVED").length ? `<span class="badge-count">${d.roadblocks.filter((r) => r.status !== "RESOLVED").length}</span>` : ""}</button>
          <button data-tab="actions">Actions</button>
          <button data-tab="updates">Updates &amp; Decisions</button>
          <button data-tab="deliverables">Deliverables</button>
        </div>
        <div id="tab-content"></div>
      </div>
      <div class="rail">
        <div class="exec">
          <h3>Executive commentary</h3>
          <textarea id="exec-text" ${canFull ? "" : "readonly"} placeholder="What must the CFO/CIO understand this month?">${esc(p.exec_commentary || "")}</textarea>
          ${canFull ? '<button class="btn primary small" id="save-exec" style="margin-top:8px">Save commentary</button>' : ""}
          <div class="hint" style="color:rgba(255,255,255,.7)">Feeds the deck verbatim.</div>
        </div>
        <div class="panel"><h3>RAG breakdown</h3>
          <div class="panel-body" style="font-size:.84rem;display:flex;flex-direction:column;gap:7px">
            ${Object.entries({ schedule: "Schedule", roadblocks: "Roadblocks", actions: "Actions", freshness: "Freshness" })
              .map(([k, name]) => {
                const s = p.rag_signals_json?.[k];
                return s ? `<div><span class="pill ${s.value === "G" ? "DONE" : s.value === "A" ? "MAJOR" : "SLIPPED"}">${s.value}</span> ${name} — ${esc(s.detail)}</div>` : "";
              }).join("")}
            <div style="border-top:1px solid var(--line);padding-top:7px"><b>Computed: ${p.rag_computed}</b> (worst of 4)
              ${p.rag_override ? `<br><b>Override: ${p.rag_override}</b> <span class="manual-badge">MANUAL</span><br><span class="muted">${esc(p.rag_override_reason)}</span>` : ""}</div>
            ${canFull ? '<button class="btn small" id="override-btn">Set / clear override</button>' : ""}
          </div>
        </div>
      </div>
    </div>`;

  const reload = () => renderProject(container, projectId);

  // ===== tabs =====
  const tabContent = container.querySelector("#tab-content");
  const tabs = {
    timeline: () => timelineTab(d, canFull, reload),
    roadblocks: () => roadblocksTab(d, canFull, canPartial, reload),
    actions: () => actionsTab(d, canPartial, reload),
    updates: () => updatesTab(d, canFull, canPartial, reload),
    deliverables: () => deliverablesTab(d, canFull, reload),
  };
  container.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === activeTab);
    b.onclick = () => {
      activeTab = b.dataset.tab;
      container.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
      tabContent.innerHTML = "";
      tabContent.appendChild(tabs[activeTab]());
    };
  });
  tabContent.appendChild(tabs[activeTab]());

  // ===== header actions =====
  container.querySelector("#export-project-deck").onclick = () => exportProjectDeck(d);
  const execBtn = container.querySelector("#save-exec");
  if (execBtn) execBtn.onclick = async () => {
    try {
      await api.put(`/api/v1/projects/${p.id}`, {
        exec_commentary: container.querySelector("#exec-text").value, updated_at: p.updated_at,
      });
      toast("Commentary saved");
      reload();
    } catch (err) { showError(err); if (err.status === 409) reload(); }
  };
  const editBtn = container.querySelector("#edit-project");
  if (editBtn) editBtn.onclick = () => editProjectModal(d, reload);
  const ovrBtn = container.querySelector("#override-btn");
  if (ovrBtn) ovrBtn.onclick = () => overrideModal(p, reload);
}

function editProjectModal(d, reload) {
  const p = d.project;
  const m = state.meta;
  const engagedIds = d.divisions.filter((x) => x.role_in_project !== "LEAD").map((x) => x.division_id);
  const siteIds = d.sites.map((s) => s.site_id);
  modal({
    title: `Edit ${p.code}`,
    wide: true,
    body: `
      <div class="frow"><div class="field" style="flex:2"><label>Title</label><input name="title" value="${esc(p.title)}"></div>
        <div class="field"><label>Priority</label><select name="priority">${["P1", "P2", "P3"].map((x) => `<option ${p.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div class="field"><label>Stage</label><select name="stage">${["IDEA", "DESIGN", "BUILD", "DEPLOY", "RUN", "CLOSED", "ON_HOLD"].map((s) => `<option ${p.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></div></div>
      <div class="frow">
        <div class="field"><label>Lead division</label><select name="lead">${optionList(m.divisions, "id", (x) => x.code, p.lead_division_id)}</select></div>
        <div class="field"><label>Project manager</label><select name="pm">${optionList(m.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, p.project_manager_id ?? "", "— none —")}</select></div>
        <div class="field"><label>Sponsor</label><input name="sponsor" value="${esc(p.sponsor || "")}"></div></div>
      <div class="frow">
        <div class="field"><label>Engaged divisions</label><select name="engaged" multiple size="4">${m.divisions.map((x) => `<option value="${x.id}" ${engagedIds.includes(x.id) ? "selected" : ""}>${esc(x.code)}</option>`).join("")}</select></div>
        <div class="field"><label>Sites</label><select name="sites" multiple size="4">${m.sites.map((s) => `<option value="${s.id}" ${siteIds.includes(s.id) ? "selected" : ""}>${esc(s.code)}</option>`).join("")}</select></div>
        <div class="field"><label>Start</label><input name="start" type="date" value="${isoDate(p.start_date)}">
          <label style="margin-top:8px">Target</label><input name="target" type="date" value="${isoDate(p.target_date)}"></div></div>
      <div class="field"><label>Description</label><textarea name="description">${esc(p.description || "")}</textarea></div>
      ${state.user.role === "ADMIN" ? `<div class="field"><label><input type="checkbox" name="confidential" ${p.confidential ? "checked" : ""}> Confidential (hidden from Contributors &amp; Viewers)</label></div>` : ""}`,
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`).value;
      const multi = (n) => [...box.querySelector(`[name=${n}]`).selectedOptions].map((o) => Number(o.value));
      const lead = Number(v("lead"));
      const body = {
        title: v("title"), priority: v("priority"), stage: v("stage"),
        lead_division_id: lead,
        project_manager_id: v("pm") ? Number(v("pm")) : null,
        sponsor: v("sponsor") || null, description: v("description") || null,
        start_date: v("start") || null, target_date: v("target") || null,
        divisions: [{ division_id: lead, role_in_project: "LEAD" },
          ...multi("engaged").filter((id) => id !== lead).map((id) => ({ division_id: id, role_in_project: "ENGAGED" }))],
        sites: multi("sites"),
        updated_at: p.updated_at,
      };
      const conf = box.querySelector("[name=confidential]");
      if (conf) body.confidential = conf.checked;
      await api.put(`/api/v1/projects/${p.id}`, body);
      toast("Project updated");
      reload();
    },
  });
}

function overrideModal(p, reload) {
  modal({
    title: "Manual RAG override",
    body: `
      <p class="muted" style="margin-bottom:12px">Computed RAG stays visible — an override adds a "manual" badge and needs a reason (≥30 characters). Clear the override to return to computed truth.</p>
      <div class="frow"><div class="field"><label>Override</label>
        <select name="ovr"><option value="">— none (computed ${p.rag_computed}) —</option>
          ${["G", "A", "R"].map((r) => `<option ${p.rag_override === r ? "selected" : ""}>${r}</option>`).join("")}</select></div></div>
      <div class="field"><label>Reason (min 30 chars)</label><textarea name="reason">${esc(p.rag_override_reason || "")}</textarea></div>`,
    onSave: async (box) => {
      const ovr = box.querySelector("[name=ovr]").value || null;
      await api.put(`/api/v1/projects/${p.id}`, {
        rag_override: ovr,
        rag_override_reason: ovr ? box.querySelector("[name=reason]").value : null,
        updated_at: p.updated_at,
      });
      toast(ovr ? "Override set" : "Override cleared — computed RAG applies");
      reload();
    },
  });
}

// ===== Timeline tab =====
function timelineTab(d, canFull, reload) {
  const wrap = document.createElement("div");
  const ms = d.milestones;
  const typePill = (t) => `<span class="pill type">${esc(t)}</span>`;
  const stPill = (s) => `<span class="pill ${s}">${esc(s.replace("_", " "))}</span>`;

  // horizontal axis: place milestones by due date
  let axis = "";
  const dated = ms.filter((x) => x.due_date);
  if (dated.length >= 2) {
    const times = dated.map((x) => new Date(x.due_date).getTime());
    const min = Math.min(...times), max = Math.max(...times);
    const span = Math.max(max - min, 1);
    const pos = (t) => 6 + ((t - min) / span) * 88;
    const today = Date.now();
    const todayPos = today >= min && today <= max ? pos(today) : null;
    axis = `<div class="tl-axis">
      ${todayPos ? `<span class="today" style="left:${todayPos}%"></span>` : ""}
      ${dated.map((x) => {
        const overdue = x.status !== "DONE" && new Date(x.due_date) < new Date();
        const cls = x.status === "DONE" ? "done" : x.status === "SLIPPED" || overdue ? "slipped" : "future";
        const gate = x.type === "SECURITY_GATE" || x.type === "GO_LIVE" ? "gate" : "";
        return `<span class="tl-ms ${cls} ${gate}" style="left:${pos(new Date(x.due_date).getTime())}%">
          <span class="knob"></span><span class="t">${esc(x.title.slice(0, 22))}<br>${fmtDate(x.due_date)}</span></span>`;
      }).join("")}
    </div>`;
  }

  wrap.innerHTML = `<div class="panel">${axis}
    ${canFull ? `<div class="quickadd">
      <input type="text" id="ms-title" placeholder="Add milestone: title…">
      <select id="ms-type">${["STANDARD", "SECURITY_GATE", "SITE_READINESS", "UAT", "GO_LIVE"].map((t) => `<option>${t}</option>`).join("")}</select>
      <select id="ms-owner">${optionList(state.meta.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, "", "Owner…")}</select>
      <input type="date" id="ms-due">
      <button class="btn navy small" id="ms-add">Add</button></div>` : ""}
    ${ms.length ? `<table class="ms-list">
      <tr><th>Milestone</th><th>Type</th><th>Owner(s)</th><th>Due</th><th>Status</th>${canFull ? "<th></th>" : ""}</tr>
      ${ms.map((x) => {
        const overdueCls = x.status !== "DONE" && x.due_date && new Date(x.due_date) < new Date() ? 'style="color:var(--rag-red);font-weight:700"' : "";
        const readiness = x.type === "SITE_READINESS" && x.readiness ? `
          <div class="readiness">
            <div style="font-size:.68rem;letter-spacing:.05em;color:var(--ink-faint);font-weight:700;margin-bottom:4px">
              SITE_READINESS — ${x.readiness.filter((r) => r.checked).length}/${x.readiness.length}</div>
            ${x.readiness.map((r) => `<label><input type="checkbox" data-ready="${r.id}" ${r.checked ? "checked" : ""}>
              <span class="${r.checked ? "done-check" : ""}">${esc(r.label)}</span></label>`).join("")}
          </div>` : "";
        return `<tr>
          <td>${esc(x.title)}${readiness}</td>
          <td>${typePill(x.type)}</td>
          <td>${x.owner_name ? avatar(x.owner_name, false, 22) : ""}${x.co_owner_name ? avatar(x.co_owner_name, true, 22) : ""}
              <span class="muted">${esc(x.owner_name || "")}</span></td>
          <td ${overdueCls}>${fmtDate(x.due_date)}</td>
          <td>${stPill(x.status)}</td>
          ${canFull ? `<td class="row-actions">
            ${x.status !== "DONE" ? `<button class="btn small" data-done="${x.id}" data-ua="${x.updated_at}">✓ Done</button>` : ""}
            ${x.status !== "DONE" && x.status !== "SLIPPED" ? `<button class="btn small ghost-danger" data-slip="${x.id}" data-ua="${x.updated_at}">Slip</button>` : ""}</td>` : ""}
        </tr>`;
      }).join("")}</table>` : emptyState("◈", "No milestones yet.", canFull ? "Add the first milestone above — progress is computed from them." : "")}
  </div>`;

  const addBtn = wrap.querySelector("#ms-add");
  if (addBtn) addBtn.onclick = async () => {
    const title = wrap.querySelector("#ms-title").value.trim();
    if (!title) return;
    try {
      await api.post(`/api/v1/projects/${d.project.id}/milestones`, {
        title, type: wrap.querySelector("#ms-type").value,
        owner_user_id: wrap.querySelector("#ms-owner").value ? Number(wrap.querySelector("#ms-owner").value) : null,
        due_date: wrap.querySelector("#ms-due").value || null,
      });
      toast("Milestone added");
      reload();
    } catch (err) { showError(err); }
  };
  wrap.querySelectorAll("[data-done]").forEach((b) => b.onclick = async () => {
    try {
      await api.put(`/api/v1/milestones/${b.dataset.done}`, { status: "DONE", updated_at: b.dataset.ua });
      toast("Milestone done — progress recomputed");
      reload();
    } catch (err) { showError(err); if (err.status === 409) reload(); }
  });
  wrap.querySelectorAll("[data-slip]").forEach((b) => b.onclick = async () => {
    try {
      await api.put(`/api/v1/milestones/${b.dataset.slip}`, { status: "SLIPPED", updated_at: b.dataset.ua });
      toast("Milestone marked slipped");
      reload();
    } catch (err) { showError(err); if (err.status === 409) reload(); }
  });
  wrap.querySelectorAll("[data-ready]").forEach((cb) => cb.onchange = async () => {
    try {
      await api.put(`/api/v1/readiness/${cb.dataset.ready}`, { checked: cb.checked });
      toast("Checklist updated");
    } catch (err) { showError(err); cb.checked = !cb.checked; }
  });
  return wrap;
}

// ===== Roadblocks tab =====
function roadblocksTab(d, canFull, canPartial, reload) {
  const wrap = document.createElement("div");
  const rbs = d.roadblocks;
  wrap.innerHTML = `<div class="panel">
    ${canPartial ? `<div class="quickadd">
      <input type="text" id="rb-title" placeholder="Raise roadblock: title…">
      <select id="rb-sev">${["CRITICAL", "MAJOR", "MINOR"].map((s) => `<option ${s === "MAJOR" ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="rb-owner">${optionList(state.meta.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, "", "Owner…")}</select>
      <input type="date" id="rb-due">
      <button class="btn navy small" id="rb-add">Raise</button></div>` : ""}
    ${rbs.length ? `<table class="ms-list">
      <tr><th>Roadblock</th><th>Severity</th><th>Owner</th><th>Due</th><th>Age</th><th>Status</th><th></th></tr>
      ${rbs.map((r) => `<tr>
        <td><b>${esc(r.title)}</b>${r.description ? `<br><span class="muted">${esc(r.description)}</span>` : ""}
            ${r.resolution_note ? `<br><span class="muted">Resolution: ${esc(r.resolution_note)}</span>` : ""}</td>
        <td><span class="pill ${r.severity}">${r.severity}</span></td>
        <td>${esc(r.owner_name || "—")}</td>
        <td>${fmtDate(r.due_date)}</td>
        <td>${r.age_days}d</td>
        <td><span class="pill ${r.status}">${esc(r.status.replace("_", " "))}</span></td>
        <td class="row-actions">
          ${r.status !== "RESOLVED" && r.status !== "ESCALATED" ? `<button class="btn small ghost-danger" data-esc="${r.id}">Escalate ↑</button>` : ""}
          ${r.status !== "RESOLVED" ? `<button class="btn small" data-resolve="${r.id}" data-ua="${r.updated_at}">Resolve</button>` : ""}
        </td></tr>`).join("")}</table>`
      : emptyState("⚑", "No roadblocks on this project.", "That is the goal — raise one the moment something blocks you.")}
  </div>`;

  const addBtn = wrap.querySelector("#rb-add");
  if (addBtn) addBtn.onclick = async () => {
    const title = wrap.querySelector("#rb-title").value.trim();
    if (!title) return;
    try {
      await api.post(`/api/v1/projects/${d.project.id}/roadblocks`, {
        title, severity: wrap.querySelector("#rb-sev").value,
        owner_user_id: wrap.querySelector("#rb-owner").value ? Number(wrap.querySelector("#rb-owner").value) : null,
        due_date: wrap.querySelector("#rb-due").value || null,
      });
      toast("Roadblock raised — RAG recomputed");
      reload();
    } catch (err) { showError(err); }
  };
  wrap.querySelectorAll("[data-esc]").forEach((b) => b.onclick = async () => {
    try {
      await api.post(`/api/v1/roadblocks/${b.dataset.esc}/escalate`, {});
      toast("Escalated — Admin + engaged Division Leads notified");
      reload();
    } catch (err) { showError(err); }
  });
  wrap.querySelectorAll("[data-resolve]").forEach((b) => b.onclick = () => {
    modal({
      title: "Resolve roadblock",
      body: `<div class="field"><label>Resolution note</label><textarea name="note"></textarea></div>`,
      saveLabel: "Resolve",
      onSave: async (box) => {
        await api.put(`/api/v1/roadblocks/${b.dataset.resolve}`, {
          status: "RESOLVED", resolution_note: box.querySelector("[name=note]").value || null,
          updated_at: b.dataset.ua,
        });
        toast("Roadblock resolved");
        reload();
      },
    });
  });
  return wrap;
}

// ===== Actions tab =====
function actionsTab(d, canPartial, reload) {
  const wrap = document.createElement("div");
  const open = d.actions.filter((a) => a.status === "OPEN");
  const closed = d.actions.filter((a) => a.status !== "OPEN");
  const row = (a) => {
    const overdue = a.status === "OPEN" && a.due_date && new Date(a.due_date) < new Date();
    return `<li>
      <input type="checkbox" data-act="${a.id}" data-ua="${a.updated_at}" ${a.status === "DONE" ? "checked disabled" : ""}>
      <span class="${a.status !== "OPEN" ? "done-check" : ""}">${esc(a.title)}</span>
      <span class="muted">${esc(a.owner_name || "")}${a.source === "MEETING" ? " · from meeting" : ""}</span>
      <span class="due ${overdue ? "over" : ""}">${a.status === "DONE" ? `done ${fmtDate(a.done_date)}` : `due ${fmtDate(a.due_date)}${overdue ? " ⚠" : ""}`}</span></li>`;
  };
  wrap.innerHTML = `<div class="panel">
    ${canPartial ? `<div class="quickadd">
      <input type="text" id="qa-title" placeholder="Quick add: action title… (Enter to save)">
      <select id="qa-owner">${optionList(state.meta.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, state.user.id)}</select>
      <input type="date" id="qa-due"></div>` : ""}
    <ul class="simple-list">${open.length || closed.length ? open.map(row).join("") + closed.map(row).join("")
      : ""}</ul>
    ${!open.length && !closed.length ? emptyState("☑", "No actions yet.", canPartial ? "Type a title above and press Enter — 3 fields, done." : "") : ""}
  </div>`;
  const qa = wrap.querySelector("#qa-title");
  if (qa) qa.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !qa.value.trim()) return;
    try {
      await api.post(`/api/v1/projects/${d.project.id}/actions`, {
        title: qa.value.trim(),
        owner_user_id: Number(wrap.querySelector("#qa-owner").value),
        due_date: wrap.querySelector("#qa-due").value || null,
      });
      toast("Action created — owner notified");
      reload();
    } catch (err) { showError(err); }
  });
  wrap.querySelectorAll("[data-act]").forEach((cb) => cb.onchange = async () => {
    try {
      await api.put(`/api/v1/actions/${cb.dataset.act}`, { status: "DONE", updated_at: cb.dataset.ua });
      toast("Action done");
      reload();
    } catch (err) { showError(err); cb.checked = false; if (err.status === 409) reload(); }
  });
  return wrap;
}

// ===== Updates & Decisions tab =====
function updatesTab(d, canFull, canPartial, reload) {
  const wrap = document.createElement("div");
  const feed = [
    ...d.statusUpdates.map((u) => ({ kind: "update", at: u.created_at, u })),
    ...d.decisions.map((x) => ({ kind: "decision", at: x.created_at, x })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  wrap.innerHTML = `<div class="panel">
    ${canPartial ? `<div class="quickadd">
      <select id="su-mood">${["ON_TRACK", "WATCH", "AT_RISK"].map((x) => `<option>${x}</option>`).join("")}</select>
      <input type="text" id="su-text" maxlength="400" placeholder="Post update: ≤400 chars, 20 seconds, done. (Enter to post)"></div>` : ""}
    ${canFull ? `<div class="quickadd" style="border-radius:0">
      <input type="text" id="dec-text" placeholder="Log decision… (Enter to save)">
      <input type="text" id="dec-by" placeholder="Decided by" value="${esc(state.user.name)}"></div>` : ""}
    <div class="feed">
      ${feed.length ? feed.map((f) => f.kind === "update" ? `
        <div class="feed-item">${avatar(f.u.author_name)}
          <div class="fbody"><span class="mood ${f.u.mood}">${esc(f.u.mood.replace("_", " "))}</span> ${esc(f.u.summary)}
            <div class="fmeta">${esc(f.u.author_name)} · ${fmtDate(f.u.date)} · status update</div></div></div>` : `
        <div class="feed-item decision-item">${avatar(f.x.decided_by || "?")}
          <div class="fbody"><b>DECISION —</b> ${esc(f.x.text)}
            <div class="fmeta">Decided by ${esc(f.x.decided_by || "—")} · ${fmtDate(f.x.date)}</div></div></div>`).join("")
        : emptyState("✎", "No updates yet.", canPartial ? "Mood + one sentence. The project speaks, or it goes amber at 21 days." : "")}
    </div></div>`;

  const su = wrap.querySelector("#su-text");
  if (su) su.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !su.value.trim()) return;
    try {
      await api.post(`/api/v1/projects/${d.project.id}/updates`, {
        mood: wrap.querySelector("#su-mood").value, summary: su.value.trim(),
      });
      toast("Update posted");
      reload();
    } catch (err) { showError(err); }
  });
  const dec = wrap.querySelector("#dec-text");
  if (dec) dec.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !dec.value.trim()) return;
    try {
      await api.post(`/api/v1/projects/${d.project.id}/decisions`, {
        text: dec.value.trim(), decidedBy: wrap.querySelector("#dec-by").value || undefined,
      });
      toast("Decision logged");
      reload();
    } catch (err) { showError(err); }
  });
  return wrap;
}

// ===== Deliverables + RACI tab (OpsPm360) =====
function deliverablesTab(d, canFull, reload) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="panel"><div class="panel-body muted">Loading deliverables…</div></div>`;
  const RACI_LABEL = { R: "Responsible", A: "Accountable", C: "Consulted", I: "Informed" };

  api.get(`/api/v1/projects/${d.project.id}/deliverables`).then(({ deliverables }) => {
    wrap.innerHTML = `<div class="panel">
      ${canFull ? `<div class="quickadd">
        <input type="text" id="dl-title" placeholder="Add deliverable: title… (Enter to save)">
        <input type="date" id="dl-due"></div>` : ""}
      ${deliverables.length ? `<table class="ms-list">
        <tr><th>Deliverable</th><th>Due</th><th>Status</th><th>RACI</th>${canFull ? "<th></th>" : ""}</tr>
        ${deliverables.map((x) => `<tr>
          <td><b>${esc(x.title)}</b>${x.description ? `<br><span class="muted">${esc(x.description)}</span>` : ""}</td>
          <td>${fmtDate(x.due_date)}</td>
          <td><select data-dstatus="${x.id}" data-ua="${x.updated_at}" ${canFull || (x.raci || []).some((r) => r.user_id === state.user.id && "RA".includes(r.role)) ? "" : "disabled"}>
            ${["PENDING", "IN_PROGRESS", "DELIVERED"].map((s) => `<option ${x.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
          <td>${(x.raci || []).map((r) =>
            `<span class="chip div" title="${RACI_LABEL[r.role]}"><b>${r.role}</b> ${esc(r.name)}</span>`).join(" ") || '<span class="muted">unassigned</span>'}</td>
          ${canFull ? `<td><button class="btn small" data-raci="${x.id}">RACI…</button></td>` : ""}
        </tr>`).join("")}</table>`
        : emptyState("▤", "No deliverables defined yet.", canFull ? "Add one above, then tag people R/A/C/I." : "")}
    </div>`;

    const add = wrap.querySelector("#dl-title");
    if (add) add.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !add.value.trim()) return;
      try {
        await api.post(`/api/v1/projects/${d.project.id}/deliverables`, {
          title: add.value.trim(), due_date: wrap.querySelector("#dl-due").value || null,
        });
        toast("Deliverable added");
        reload();
      } catch (err) { showError(err); }
    });
    wrap.querySelectorAll("[data-dstatus]").forEach((sel) => sel.onchange = async () => {
      try {
        await api.put(`/api/v1/deliverables/${sel.dataset.dstatus}`, { status: sel.value, updated_at: sel.dataset.ua });
        toast("Deliverable updated");
        reload();
      } catch (err) { showError(err); if (err.status === 409) reload(); }
    });
    wrap.querySelectorAll("[data-raci]").forEach((b) => b.onclick = () => {
      const del = deliverables.find((x) => x.id === Number(b.dataset.raci));
      const users = state.meta.users;
      const existing = del.raci || [];
      const row = (i) => {
        const cur = existing[i] || {};
        return `<div class="frow">
          <div class="field"><select name="u${i}"><option value="">— nobody —</option>
            ${users.map((u) => `<option value="${u.id}" ${cur.user_id === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
          <div class="field" style="max-width:140px"><select name="r${i}">
            ${["R", "A", "C", "I"].map((r) => `<option ${cur.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        </div>`;
      };
      modal({
        title: `RACI — ${del.title}`,
        body: `<p class="muted" style="margin-bottom:10px">R = Responsible · A = Accountable · C = Consulted · I = Informed</p>
          ${[0, 1, 2, 3, 4, 5].map(row).join("")}`,
        onSave: async (box) => {
          const assignments = [];
          for (let i = 0; i < 6; i++) {
            const uid = box.querySelector(`[name=u${i}]`).value;
            if (uid) assignments.push({ user_id: Number(uid), raci_role: box.querySelector(`[name=r${i}]`).value });
          }
          await api.put(`/api/v1/deliverables/${del.id}/raci`, { assignments });
          toast("RACI matrix saved");
          reload();
        },
      });
    });
  });
  return wrap;
}
