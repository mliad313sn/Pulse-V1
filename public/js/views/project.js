"use strict";
import { api, state } from "../lib/api.js";
import { esc, fmtDate, isoDate, ragDot, avatar, modal, toast, showError, optionList, emptyState } from "../lib/ui.js";
import { exportProjectDeck } from "../lib/deck.js";

const STAGES = ["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN"];
let activeTab = "timeline";

export async function renderProject(container, projectId) {
  const d = await api.get(`/api/v1/projects/${projectId}`);
  const p = d.project;
  const canFull = d.access === "FULL";
  const canPartial = canFull || d.access === "PARTIAL";
  const m = state.meta;

  const stageIdx = STAGES.indexOf(p.stage);
  const stepper = STAGES.map((s, i) => `
    <span class="step ${p.operating_status === "ON_HOLD" || p.stage === "CLOSED" ? "" : i < stageIdx ? "done" : i === stageIdx ? "now" : ""}">
      <span class="node">${s}</span>${i < STAGES.length - 1 ? '<span class="bar"></span>' : ""}</span>`).join("");

  container.innerHTML = `
    <a href="#/portfolio" style="font-size:.8rem;color:var(--ink-soft)">← Portfolio</a>
    <div class="proj-header" style="margin-top:8px">
      <div class="toprow">
        ${ragDot(p)}
        <h1>${esc(p.title)}</h1>
        <span style="color:var(--ink-faint);font-weight:700;font-size:.8rem">${esc(p.code)}</span>
        <span class="chip prio">${esc(p.priority)}</span>
        ${p.governance === "LITE" ? '<span class="chip site" title="Light governance: same stages and approvals, lighter gate paperwork">LITE</span>' : ""}
        ${p.confidential ? '<span class="chip conf">CONFIDENTIAL</span>' : ""}
        <span style="margin-left:auto" class="chip stage">${esc(p.stage.replace("_", " "))}</span>
        ${canFull ? '<button class="btn small" id="edit-project">✎ Edit</button>' : ""}
        <button class="btn primary small" id="export-project-deck">⬇ Project deck</button>
      </div>
      <div class="stepper">${stepper}${p.operating_status === "ON_HOLD" ? '<span class="chip stage HOLD" style="margin-left:10px">ON HOLD</span>' : ""}${p.operating_status === "CANCELLED" ? '<span class="chip conf" style="margin-left:10px">CANCELLED</span>' : ""}</div>
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
          <button data-tab="plan">Plan</button>
          <button data-tab="roadblocks">Roadblocks ${d.roadblocks.filter((r) => r.status !== "RESOLVED").length ? `<span class="badge-count">${d.roadblocks.filter((r) => r.status !== "RESOLVED").length}</span>` : ""}</button>
          <button data-tab="actions">Actions</button>
          <button data-tab="updates">Updates &amp; Decisions</button>
          <button data-tab="deliverables">Deliverables</button>
          <button data-tab="changes">Changes</button>
          <button data-tab="documents">Documents</button>
        </div>
        <div id="tab-content"></div>
      </div>
      <div class="rail">
        <div class="exec">
          <h3>Executive commentary</h3>
          <textarea id="exec-text" ${canFull ? "" : "readonly"} placeholder="What must the CFO/CIO understand this month?">${esc(p.exec_commentary || "")}</textarea>
          ${canFull ? '<button class="btn primary small" id="save-exec" style="margin-top:8px">Save commentary</button>' : ""}
          ${canFull ? '<span id="ai-draft-slot"></span>' : ""}
          <div class="hint" style="color:rgba(255,255,255,.7)">Feeds the deck verbatim.</div>
        </div>
        ${d.gate && d.gate.next ? `<div class="panel"><h3>Next gate → ${esc(d.gate.next)}</h3>
          <div class="panel-body" style="font-size:.84rem;display:flex;flex-direction:column;gap:6px">
            ${d.gate.requirements.map((r) => `<div>${r.met
              ? '<span style="color:var(--rag-green-text);font-weight:700">✓</span>'
              : '<span style="color:var(--rag-amber-text);font-weight:700">○</span>'} ${esc(r.label)}</div>`).join("")}
            <div class="muted" style="border-top:1px solid var(--line);padding-top:6px">
              ${d.gate.requirements.every((r) => r.met)
                ? "All requirements met — the stage can be advanced."
                : "Complete the open items, then advance the stage from ✎ Edit."}
              ${p.governance === "LITE" ? " · LITE governance: lighter evidence, same approvals." : ""}</div>
          </div>
        </div>` : ""}
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
    plan: () => planTab(d, canFull, reload),
    roadblocks: () => roadblocksTab(d, canFull, canPartial, reload),
    actions: () => actionsTab(d, canPartial, reload),
    updates: () => updatesTab(d, canFull, canPartial, reload),
    deliverables: () => deliverablesTab(d, canFull, reload),
    changes: () => changesTab(d, canFull, canPartial, reload),
    documents: () => documentsTab(d, canFull, canPartial, reload),
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
  // SPM P9 — AI draft (only offered when the deployment has a key; the draft
  // lands in the textarea for human review, it is never auto-saved)
  const aiSlot = container.querySelector("#ai-draft-slot");
  if (aiSlot) {
    api.get("/api/v1/ai/status").then((ai) => {
      if (!ai.enabled) return;
      const btn = document.createElement("button");
      btn.className = "btn small";
      btn.style.marginTop = "8px";
      btn.textContent = "✨ Draft with AI";
      btn.title = "Drafts a cited summary from this project's records — review and edit before saving";
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = "Drafting…";
        try {
          const r = await api.post(`/api/v1/projects/${p.id}/ai/summary`, {});
          container.querySelector("#exec-text").value = r.draft;
          toast("Draft ready — review, edit, then Save commentary");
        } catch (err) { showError(err); }
        finally { btn.disabled = false; btn.textContent = "✨ Draft with AI"; }
      };
      aiSlot.appendChild(btn);
    }).catch(() => {});
  }
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
        <div class="field"><label>Stage</label><select name="stage">${["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN", "CLOSED"].map((s) => `<option ${p.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></div></div>
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
      ${["ADMIN", "DIVISION_LEAD"].includes(state.user.role) ? `<div class="field"><label>Governance tier</label>
        <select name="governance">
          <option value="STANDARD" ${p.governance !== "LITE" ? "selected" : ""}>STANDARD — full gate evidence</option>
          <option value="LITE" ${p.governance === "LITE" ? "selected" : ""}>LITE — light paperwork for small/simple projects (same stages, same approvals)</option>
        </select></div>` : ""}
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
      const gov = box.querySelector("[name=governance]");
      if (gov) body.governance = gov.value;
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

// ===== Plan tab (E07: workstreams, tasks, critical path) =====
function planTab(d, canFull, reload) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="panel"><div class="panel-body muted">Loading plan…</div></div>`;
  api.get(`/api/v1/projects/${d.project.id}/plan`).then((plan) => {
    const critical = new Set(plan.criticalPath.criticalIds || []);
    const wsName = Object.fromEntries(plan.workstreams.map((w) => [w.id, w.title]));
    wrap.innerHTML = `<div class="panel">
      ${canFull ? `<div class="quickadd">
        <input type="text" id="ws-title" placeholder="Add workstream… (Enter)">
        <select id="ws-lead">${optionList(state.meta.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, "", "Lead…")}</select>
      </div>` : ""}
      <div class="panel-body">
        <div class="muted" style="margin-bottom:8px">
          Critical path: <b>${plan.criticalPath.projectLength || 0} day(s)</b> ·
          ${critical.size} critical task(s) marked ⚑</div>
        ${plan.workstreams.map((w) => `<div style="margin-bottom:4px">
          <b style="color:var(--edv-navy)">${esc(w.title)}</b>
          <span class="pill ${w.status === "DONE" ? "DONE" : w.status === "IN_PROGRESS" ? "IN_PROGRESS" : "NOT_STARTED"}">${esc(w.status.replace("_", " "))}</span>
          <span class="muted">${esc(w.lead_name || "no lead")} · ${fmtDate(w.start_date)} → ${fmtDate(w.end_date)}</span></div>`).join("") || '<span class="muted">No workstreams yet.</span>'}
      </div>
      ${canFull ? `<div class="quickadd" style="border-radius:0">
        <input type="text" id="task-title" placeholder="Add task… (Enter)">
        <select id="task-ws"><option value="">No workstream</option>${plan.workstreams.map((w) => `<option value="${w.id}">${esc(w.title)}</option>`).join("")}</select>
        <select id="task-owner">${optionList(state.meta.users.filter((u) => u.role !== "VIEWER"), "id", (u) => u.name, "", "Owner…")}</select>
        <input type="date" id="task-start"><input type="date" id="task-finish">
      </div>` : ""}
      ${plan.tasks.length ? `<table class="ms-list">
        <tr><th></th><th>Task</th><th>Workstream</th><th>Owner</th><th>Planned</th><th>Slack</th><th>Status</th></tr>
        ${plan.tasks.map((t) => `<tr>
          <td>${critical.has(t.id) ? '<span title="Critical path" style="color:var(--rag-red)">⚑</span>' : ""}</td>
          <td>${esc(t.title)}</td>
          <td class="muted">${esc(wsName[t.workstream_id] || "—")}</td>
          <td class="muted">${esc(t.owner_name || "—")}</td>
          <td>${fmtDate(t.planned_start)} → ${fmtDate(t.planned_finish)}</td>
          <td class="muted">${plan.criticalPath.slack ? (plan.criticalPath.slack[t.id] ?? "—") + "d" : "—"}</td>
          <td><select data-task="${t.id}" data-ua="${t.updated_at}">
            ${["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"].map((st) => `<option ${t.status === st ? "selected" : ""}>${st}</option>`).join("")}
          </select></td></tr>`).join("")}</table>` : emptyState("▦", "No tasks yet.", canFull ? "Add tasks above; link dependencies via the API or upcoming Gantt view." : "")}
    </div>`;
    const wsAdd = wrap.querySelector("#ws-title");
    if (wsAdd) wsAdd.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !wsAdd.value.trim()) return;
      try {
        await api.post(`/api/v1/projects/${d.project.id}/workstreams`, {
          title: wsAdd.value.trim(),
          lead_user_id: wrap.querySelector("#ws-lead").value ? Number(wrap.querySelector("#ws-lead").value) : null,
        });
        toast("Workstream added"); reload();
      } catch (err) { showError(err); }
    });
    const tAdd = wrap.querySelector("#task-title");
    if (tAdd) tAdd.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !tAdd.value.trim()) return;
      try {
        await api.post(`/api/v1/projects/${d.project.id}/tasks`, {
          title: tAdd.value.trim(),
          workstream_id: wrap.querySelector("#task-ws").value ? Number(wrap.querySelector("#task-ws").value) : null,
          owner_user_id: wrap.querySelector("#task-owner").value ? Number(wrap.querySelector("#task-owner").value) : null,
          planned_start: wrap.querySelector("#task-start").value || null,
          planned_finish: wrap.querySelector("#task-finish").value || null,
        });
        toast("Task added"); reload();
      } catch (err) { showError(err); }
    });
    wrap.querySelectorAll("[data-task]").forEach((sel) => sel.onchange = async () => {
      try {
        await api.put(`/api/v1/tasks/${sel.dataset.task}`, { status: sel.value, updated_at: sel.dataset.ua });
        toast("Task updated"); reload();
      } catch (err) { showError(err); if (err.status === 409) reload(); }
    });
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

// ===== E06 — Change control + baselines tab =====
function changesTab(d, canFull, canPartial, reload) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="panel"><div class="panel-body muted">Loading change control…</div></div>`;
  const u = state.user;
  const canDecide = u.role === "ADMIN" || u.isSteeringCommittee === true;
  const pid = d.project.id;

  Promise.all([
    api.get(`/api/v1/projects/${pid}/baselines`),
    api.get(`/api/v1/projects/${pid}/change-requests`),
  ]).then(([bl, crs]) => {
    const pillFor = (s) => s === "APPROVED" ? "DONE" : s === "REJECTED" ? "SLIPPED" : "MAJOR";
    wrap.innerHTML = `
      <div class="panel">
        <h3 style="padding:10px 14px 0">Baselines <span class="muted">(immutable snapshots — forecast lives on the project)</span></h3>
        <div class="panel-body">
        ${bl.baselines.length ? `<table class="ms-list">
          <tr><th>V</th><th>Label</th><th>Target date</th><th>Budget approved</th><th>Milestones</th><th>Captured</th></tr>
          ${bl.baselines.map((b) => `<tr>
            <td><b>v${b.version}</b></td><td>${esc(b.label)}${b.change_title ? `<br><span class="muted">CR: ${esc(b.change_title)}</span>` : ""}</td>
            <td>${fmtDate(b.target_date)}</td>
            <td>${b.budget_approved != null ? Number(b.budget_approved).toLocaleString("en-US") : "—"}</td>
            <td>${(b.milestones_json || []).length}</td>
            <td class="muted">${fmtDate(b.created_at)} · ${esc(b.created_by_name || "")}</td>
          </tr>`).join("")}</table>
          <div class="muted" style="margin-top:6px">Current forecast target: <b>${fmtDate(bl.forecast.target_date)}</b></div>`
          : emptyState("▣", "No baseline captured yet.", canFull ? "Capture v1 before execution starts." : "")}
        ${canFull ? '<button class="btn small" id="capture-bl" style="margin-top:8px">Capture baseline</button>' : ""}
        </div>
      </div>
      <div class="panel" style="margin-top:14px">
        <h3 style="padding:10px 14px 0">Change requests</h3>
        <div class="panel-body">
        ${canPartial || canFull ? '<button class="btn navy small" id="new-cr">＋ New change request</button>' : ""}
        ${crs.changeRequests.length ? `<ul class="simple-list" style="margin-top:8px">
          ${crs.changeRequests.map((c) => `<li>
            <span class="pill ${pillFor(c.status)}">${c.status}</span>
            <b>${esc(c.title)}</b> <span class="chip div">${c.type}</span><br>
            <span class="muted">${esc(c.rationale)}</span>
            ${c.schedule_impact_days ? `<br><span class="muted">Schedule impact: ${c.schedule_impact_days}d</span>` : ""}
            ${c.cost_impact ? `<br><span class="muted">Cost impact: ${Number(c.cost_impact).toLocaleString("en-US")}</span>` : ""}
            ${c.status !== "PENDING" ? `<br><span class="muted">Decision by ${esc(c.approver_name || "—")}: ${esc(c.decision_note || "")}</span>` : ""}
            ${c.status === "PENDING" && canDecide ? `
              <br><button class="btn small" data-decide="APPROVED" data-cr="${c.id}" data-ua="${c.updated_at}">Approve</button>
              <button class="btn small ghost-danger" data-decide="REJECTED" data-cr="${c.id}" data-ua="${c.updated_at}">Reject</button>` : ""}
          </li>`).join("")}</ul>`
          : `<div class="muted" style="margin-top:8px">No change requests. Material scope/schedule/budget changes need one.</div>`}
        </div>
      </div>`;

    const cap = wrap.querySelector("#capture-bl");
    if (cap) cap.onclick = () => modal({
      title: "Capture baseline",
      body: `<div class="field"><label>Label</label><input name="label" value="${bl.baselines.length ? "Re-baseline" : "Original baseline"}"></div>
        <p class="muted">Snapshots current dates, approved budget and the milestone plan. Baselines are permanent.</p>`,
      onSave: async (box) => {
        await api.post(`/api/v1/projects/${pid}/baselines`, { label: box.querySelector("[name=label]").value });
        toast("Baseline captured");
        reload();
      },
    });

    const ncr = wrap.querySelector("#new-cr");
    if (ncr) ncr.onclick = () => modal({
      title: "New change request",
      body: `
        <div class="field"><label>Type</label><select name="type">
          ${["SCOPE","SCHEDULE","BUDGET","BENEFIT","RESOURCE","CANCELLATION"].map((t) => `<option>${t}</option>`).join("")}</select></div>
        <div class="field"><label>Title</label><input name="title" required></div>
        <div class="field"><label>Rationale (min 10 chars)</label><textarea name="rationale"></textarea></div>
        <div class="frow">
          <div class="field"><label>Schedule impact (days)</label><input name="sched" type="number"></div>
          <div class="field"><label>Cost impact</label><input name="cost" type="number" step="0.01"></div>
        </div>
        <div class="field"><label>Affected milestones</label><input name="ms"></div>`,
      onSave: async (box) => {
        const v = (n) => box.querySelector(`[name=${n}]`).value;
        await api.post(`/api/v1/projects/${pid}/change-requests`, {
          type: v("type"), title: v("title"), rationale: v("rationale"),
          schedule_impact_days: v("sched") ? Number(v("sched")) : null,
          cost_impact: v("cost") ? Number(v("cost")) : null,
          affected_milestones: v("ms") || null,
        });
        toast("Change request submitted — Steering Committee notified");
        reload();
      },
    });

    wrap.querySelectorAll("[data-decide]").forEach((b) => b.onclick = () => modal({
      title: `${b.dataset.decide === "APPROVED" ? "Approve" : "Reject"} change request`,
      body: `<div class="field"><label>Decision note (required)</label><textarea name="note"></textarea></div>
        ${b.dataset.decide === "APPROVED" ? '<p class="muted">Approval captures a new baseline automatically.</p>' : ""}`,
      onSave: async (box) => {
        await api.post(`/api/v1/projects/${pid}/change-requests/${b.dataset.cr}/decision`, {
          decision: b.dataset.decide, note: box.querySelector("[name=note]").value, updated_at: b.dataset.ua,
        });
        toast(`Change request ${b.dataset.decide.toLowerCase()}`);
        reload();
      },
    }));
  });
  return wrap;
}

// ===== E24 — Documents tab (attachments) =====
function documentsTab(d, canFull, canPartial, reload) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="panel"><div class="panel-body muted">Loading documents…</div></div>`;
  const pid = d.project.id;
  const fmtSize = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

  api.get(`/api/v1/projects/${pid}/attachments`).then(({ attachments }) => {
    wrap.innerHTML = `<div class="panel"><div class="panel-body">
      ${canPartial ? `<div class="quickadd" style="align-items:center">
        <input type="file" id="att-file" aria-label="Choose file">
        <button class="btn navy small" id="att-upload">⬆ Upload</button>
        <span class="muted">pdf, docx, xlsx, pptx, png, jpg, txt, csv, msg · max 25 MB</span></div>` : ""}
      ${attachments.length ? `<table class="ms-list">
        <tr><th>File</th><th>Size</th><th>V</th><th>Uploaded</th><th></th></tr>
        ${attachments.map((a) => `<tr>
          <td><a href="/api/v1/attachments/${a.id}" download><b>${esc(a.filename)}</b></a>
            ${a.description ? `<br><span class="muted">${esc(a.description)}</span>` : ""}</td>
          <td>${fmtSize(a.size_bytes)}</td><td>v${a.version}</td>
          <td class="muted">${fmtDate(a.created_at)} · ${esc(a.uploaded_by || "")}</td>
          <td>${canFull ? `<button class="btn small ghost-danger" data-del="${a.id}">✕</button>` : ""}</td>
        </tr>`).join("")}</table>`
        : emptyState("🗎", "No documents yet.", canPartial ? "Upload plans, sign-offs and evidence here." : "")}
    </div></div>`;

    const upBtn = wrap.querySelector("#att-upload");
    if (upBtn) upBtn.onclick = async () => {
      const input = wrap.querySelector("#att-file");
      if (!input.files.length) { toast("Choose a file first", true); return; }
      const fd = new FormData();
      fd.append("file", input.files[0]);
      try {
        const res = await fetch(`/api/v1/projects/${pid}/attachments`, {
          method: "POST", body: fd, headers: { "X-CSRF-Token": state.csrf },
        });
        const body = await res.json();
        if (!res.ok) throw Object.assign(new Error(body.error || "Upload failed"), { status: res.status });
        toast(`Uploaded ${body.attachment.filename} (v${body.attachment.version})`);
        reload();
      } catch (err) { showError(err); }
    };
    wrap.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      try {
        await api.del(`/api/v1/attachments/${b.dataset.del}`);
        toast("Document removed");
        reload();
      } catch (err) { showError(err); }
    });
  });
  return wrap;
}
