"use strict";
import { api, state } from "../lib/api.js";
import { esc, fmtDate, ragDot, modal, toast, showError, optionList, emptyState } from "../lib/ui.js";
import { connectPresenter, disconnectPresenter } from "../lib/presenter.js";

const canManage = () => ["ADMIN", "DIVISION_LEAD"].includes(state.user.role);

export async function renderMeetings(container) {
  const res = await api.get("/api/v1/meetings");
  container.innerHTML = `
    <div class="page-head"><h1>Meetings</h1>
      <span class="sub">The tool IS the meeting — agenda, capture and minutes live here</span>
      ${canManage() ? '<button class="btn navy" id="new-meeting" style="margin-left:auto">＋ Prepare meeting</button>' : ""}
    </div>
    <div class="panel">
      ${res.meetings.length ? res.meetings.map((mt) => `
        <div class="meeting-row clickable" data-id="${mt.id}" style="border-bottom:1px solid var(--line)">
          <span class="mstatus ${mt.status}">${mt.status}</span>
          <b style="color:var(--edv-navy)">${esc(mt.title)}</b>
          <span class="muted">${esc(mt.type.replace(/_/g, " "))}${mt.site_code ? ` · scope ${esc(mt.site_code)}` : " · all sites"}</span>
          <span class="muted" style="margin-left:auto">${fmtDate(mt.date)} · ${mt.item_count} agenda item(s)</span>
        </div>`).join("")
        : emptyState("▶", "No meetings yet.", canManage() ? "Prepare one — the agenda builds itself from live project data." : "")}
    </div>`;
  container.querySelectorAll("[data-id]").forEach((r) => r.onclick = () => (location.hash = `#/meetings/${r.dataset.id}`));
  const btn = container.querySelector("#new-meeting");
  if (btn) btn.onclick = () => prepareModal();
}

function prepareModal() {
  const m = state.meta;
  const today = new Date().toISOString().slice(0, 10);
  modal({
    title: "Prepare meeting",
    saveLabel: "Create + build agenda",
    body: `
      <div class="frow"><div class="field" style="flex:2"><label>Title</label><input name="title" value="Infra ↔ Ops Weekly Sync"></div></div>
      <div class="frow">
        <div class="field"><label>Date</label><input name="date" type="date" value="${today}"></div>
        <div class="field"><label>Type</label><select name="type">
          <option value="INFRA_OPS_SYNC">Infra ↔ Ops sync</option>
          <option value="PROJECT_REVIEW">Project review</option>
          <option value="ADHOC">Ad hoc</option></select></div>
        <div class="field"><label>Site scope (optional)</label>
          <select name="site">${optionList(m.sites, "id", (s) => s.code, "", "All sites")}</select>
          <div class="hint">Scoped: all 6 agenda rules apply to that site only</div></div></div>
      <div class="field"><label>Attendees</label>
        <select name="attendees" multiple size="7">${optionList(m.users, "id", (u) => `${u.name} (${u.role.replace("_", " ")})`)}</select></div>
      <p class="muted">Auto-agenda: RED projects · AMBER · new roadblocks since last closed sync · overdue actions by owner · GO_LIVE ≤30d · silent projects.</p>`,
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`).value;
      const res = await api.post("/api/v1/meetings", {
        title: v("title"), date: v("date"), type: v("type"),
        site_id: v("site") ? Number(v("site")) : null,
        attendees: [...box.querySelector("[name=attendees]").selectedOptions].map((o) => Number(o.value)),
      });
      toast("Agenda built from live data");
      location.hash = `#/meetings/${res.meeting.id}`;
    },
  });
}

// ===== meeting room: prepare view / LIVE presenter view / closed minutes =====
export async function renderMeetingLive(container, meetingId) {
  const d = await api.get(`/api/v1/meetings/${meetingId}`);
  const mt = d.meeting;
  if (mt.status === "CLOSED") return renderMinutes(container, d);
  if (mt.status === "LIVE") return renderLive(container, d);
  return renderPrepare(container, d);
}

function renderPrepare(container, d) {
  const mt = d.meeting;
  container.innerHTML = `
    <a href="#/meetings" style="font-size:.8rem;color:var(--ink-soft)">← Meetings</a>
    <div class="page-head" style="margin-top:8px"><h1>${esc(mt.title)}</h1>
      <span class="mstatus PLANNED">PLANNED</span>
      <span class="sub">${fmtDate(mt.date)} · ${esc(mt.type.replace(/_/g, " "))}${mt.site_id ? " · site-scoped" : ""}</span>
      ${d.canDrive ? `<button class="btn primary" id="go-live" style="margin-left:auto">▶ Go live</button>` : ""}
    </div>
    <div class="section-title">Agenda (${d.items.length}) — drag order via arrows, remove what you don't need</div>
    <div class="panel"><table class="ms-list">
      <tr><th></th><th>Item</th><th>Why on agenda</th><th>Notes</th>${d.canDrive ? "<th></th>" : ""}</tr>
      ${d.items.map((it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${it.code ? `<b>${esc(it.code)}</b> ${esc(it.project_title)}` : "<i>General</i>"}</td>
        <td>${it.reason ? `<span class="agenda-reason ${it.reason.includes("RED") ? "red" : it.reason.includes("Silent") ? "silent" : it.reason.includes("GO_LIVE") ? "golive" : "overdue"}">${esc(it.reason)}</span>` : ""}</td>
        <td class="muted" style="max-width:340px">${esc(it.notes || "")}</td>
        ${d.canDrive ? `<td class="row-actions">
          <button class="btn small" data-up="${it.id}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn small" data-down="${it.id}" ${i === d.items.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn small ghost-danger" data-rm="${it.id}">✕</button></td>` : ""}
      </tr>`).join("")}</table>
      ${d.canDrive ? `<div class="quickadd" style="border-radius:0 0 8px 8px;border-top:1px solid var(--line);border-bottom:0">
        <select id="add-project">${optionList([], "id", () => "")}</select>
        <button class="btn navy small" id="add-item">＋ Add project item</button></div>` : ""}
    </div>
    <div class="section-title">Attendees (${d.attendees.length})</div>
    <div class="panel"><div class="panel-body">${d.attendees.map((a) => `<span class="chip div">${esc(a.name)}</span>`).join(" ") || '<span class="muted">None picked yet.</span>'}</div></div>`;

  const reload = () => renderMeetingLive(container, mt.id);
  if (d.canDrive) {
    container.querySelector("#go-live").onclick = async () => {
      await api.post(`/api/v1/meetings/${mt.id}/start`, {});
      reload();
    };
    // populate add-project select lazily
    api.get("/api/v1/projects").then((res) => {
      container.querySelector("#add-project").innerHTML =
        res.projects.map((p) => `<option value="${p.id}">${esc(p.code)} ${esc(p.title)}</option>`).join("");
    });
    container.querySelector("#add-item").onclick = async () => {
      const pid = Number(container.querySelector("#add-project").value);
      if (!pid) return;
      await api.put(`/api/v1/meetings/${mt.id}/items`, { ops: [{ op: "add", project_id: pid }] });
      reload();
    };
    const move = async (id, delta) => {
      const idx = d.items.findIndex((x) => x.id === Number(id));
      const other = d.items[idx + delta];
      await api.put(`/api/v1/meetings/${mt.id}/items`, { ops: [
        { op: "reorder", id: Number(id), order_index: other.order_index },
        { op: "reorder", id: other.id, order_index: d.items[idx].order_index },
      ]});
      reload();
    };
    container.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => move(b.dataset.up, -1));
    container.querySelectorAll("[data-down]").forEach((b) => b.onclick = () => move(b.dataset.down, 1));
    container.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
      await api.put(`/api/v1/meetings/${mt.id}/items`, { ops: [{ op: "remove", id: Number(b.dataset.rm) }] });
      reload();
    });
  }
}

let liveIdx = 0;
let rtPresenting = false; // survives re-renders while driving the room

function renderLive(container, d) {
  const mt = d.meeting;
  const items = d.items;
  if (liveIdx >= items.length) liveIdx = 0;
  const it = items[liveIdx];

  const projBlock = it && it.code ? `
    <div class="meet-card">
      <div class="mc-head">
        ${ragDot({ rag_computed: it.rag, rag_override: null, rag_signals_json: it.rag_signals_json })}
        <span class="title">${esc(it.project_title)}</span>
        <span class="code">${esc(it.code)}</span>
        ${it.reason ? `<span class="agenda-reason ${it.reason.includes("RED") ? "red" : it.reason.includes("Silent") ? "silent" : it.reason.includes("GO_LIVE") ? "golive" : "overdue"}">${esc(it.reason)}</span>` : ""}
        <span style="margin-left:auto" class="chip stage">${esc((it.stage || "").replace("_", " "))}</span>
        ${(it.sites || []).map((s) => `<span class="chip site">${esc(s)}</span>`).join("")}
      </div>
      <div class="meet-grid">
        <div><h4>State in 30 seconds</h4>
          <div class="bigline">Progress <b>${it.progress_pct}%</b> · target <b>${fmtDate(it.target_date)}</b> · PM <b>${esc(it.pm_name || "—")}</b></div>
          ${(it.open_roadblocks || []).slice(0, 3).map((r) => `<div class="bigline">⚑ ${esc(r.title)} <span class="pill ${r.severity}">${r.severity}</span></div>`).join("") || '<div class="bigline" style="color:var(--rag-green)">✓ No open roadblocks</div>'}
        </div>
        <div><h4>Open actions on this project</h4>
          ${(it.open_actions || []).slice(0, 5).map((a) => `<div class="bigline" style="font-size:.92rem">• ${esc(a.title)} — ${esc(a.owner || "?")}${a.overdue ? ' <span style="color:var(--rag-red);font-weight:700">(overdue)</span>' : ` (${fmtDate(a.due_date)})`}</div>`).join("") || '<div class="bigline muted">None.</div>'}
        </div>
      </div>
      ${it.notes ? `<div class="meet-item-note"><b>Notes:</b> ${esc(it.notes)}</div>` : ""}
    </div>`
    : `<div class="meet-card"><div class="mc-head"><span class="title">General item</span></div>
       <div class="meet-item-note">${esc(it?.notes || "")}</div></div>`;

  container.innerHTML = `
    <div class="meet-header" style="margin:-22px -22px 20px;position:static">
      <span class="live-dot"></span>
      <span class="mtitle">${esc(mt.title)}</span>
      <span class="mtag">LIVE · PRESENTER MODE</span>
      <span class="mscope">Room follows the presenter live · GMT</span>
      <span id="rt-status" class="chip div" title="Realtime room">⇄ connecting…</span>
      <div class="mprog"><span>Item ${items.length ? liveIdx + 1 : 0} / ${items.length}</span>
        ${d.canDrive ? `<button class="btn small" style="background:#fff;color:var(--edv-navy)" id="rt-present">📡 Present to room</button>` : ""}
        ${d.canDrive ? `<button class="btn small" style="background:#fff;color:var(--edv-navy)" id="close-meeting">■ Close &amp; generate minutes</button>` : ""}</div>
    </div>
    ${projBlock}
    <div class="captured" style="background:var(--surface-card);border:1px dashed var(--line);color:var(--ink)">
      <h4 style="color:var(--ink-faint)">Captured this meeting — real objects linked to project + meeting</h4>
      <ul>${d.captured.map((c) => `<li><span class="ctype ${c.kind}">${c.kind.toUpperCase()}</span>
        ${esc(c.text)}${c.owner ? ` — ${esc(c.owner)}` : ""}${c.project_code ? ` — ${esc(c.project_code)}` : ""}
        ${c.kind === "decision" ? (c.change_request_id
          ? ` <span class="chip stage" title="Converted to change request">CR #${c.change_request_id}</span>`
          : (d.canDrive ? ` <button class="btn small convert-cr" data-id="${c.id}" data-text="${esc(c.text)}" title="Convert this decision into a governed change request">→ Change request</button>` : "")) : ""}</li>`).join("") || "<li class='muted'>Nothing captured yet.</li>"}</ul>
    </div>
    ${d.canDrive ? `<div class="capture-bar" style="position:sticky;bottom:0;margin:20px -22px -22px;border-radius:0">
      <span class="cap-label">CAPTURE →</span>
      <button class="cap" data-kind="action">+ Action</button>
      <button class="cap" data-kind="decision">+ Decision</button>
      <button class="cap" data-kind="roadblock">+ Roadblock</button>
      <button class="cap" data-kind="note">✎ Note</button>
      <button class="cap" id="simulate-btn" title="Evaluate a portfolio scenario live — nothing is changed">⚗ Simulate</button>
      <div class="nav-btns">
        <button id="prev" ${liveIdx === 0 ? "disabled" : ""}>‹ Prev</button>
        <button id="next" ${liveIdx >= items.length - 1 ? "disabled" : ""}>Next ›</button>
      </div></div>` : `<label class="btn" style="margin-top:14px;display:inline-flex;align-items:center;gap:6px">
        <input type="checkbox" id="rt-follow" checked> Follow presenter</label>`}`;

  const reload = () => renderMeetingLive(container, mt.id);

  // ===== E15 realtime room: pointers only, data via authorized REST =====
  let following = !d.canDrive;
  const statusChip = container.querySelector("#rt-status");
  const rt = connectPresenter(mt.id, {
    onStatus: (s) => { if (statusChip) statusChip.textContent = s === "connected" ? "⇄ room live" : "⇄ reconnecting…"; },
    onRoom: (r) => {
      if (statusChip && r.presenterName) statusChip.textContent = `⇄ ${r.presenterName} presenting · ${r.followers} in room`;
      if (following && r.context != null) applyContext(r.context);
    },
    onContext: (ctx) => { if (following) applyContext(ctx); },
    onPresenter: (p) => {
      if (statusChip) statusChip.textContent = p.presenterName ? `⇄ ${p.presenterName} presenting` : "⇄ room live";
      if (p.presenterId !== state.user.id) rtPresenting = false;
    },
    onFollowers: (n) => { if (statusChip && !statusChip.textContent.includes("presenting")) statusChip.textContent = `⇄ room live · ${n} in room`; },
    onError: (e) => toast(e, true),
  });
  function applyContext(ctx) {
    const m = /^item:(\d+)$/.exec(ctx);
    if (m && Number(m[1]) !== liveIdx) { liveIdx = Number(m[1]); reload(); }
  }
  const followBox = container.querySelector("#rt-follow");
  if (followBox) followBox.onchange = () => { following = followBox.checked; }; // opt-out (§38)
  const presentBtn = container.querySelector("#rt-present");
  if (presentBtn) presentBtn.onclick = () => { rtPresenting = true; rt.present(); rt.pivot(`item:${liveIdx}`); };

  if (!d.canDrive) return;

  container.querySelector("#prev").onclick = () => { liveIdx--; if (rtPresenting) rt.pivot(`item:${liveIdx}`); reload(); };
  container.querySelector("#next").onclick = () => { liveIdx++; if (rtPresenting) rt.pivot(`item:${liveIdx}`); reload(); };
  container.querySelector("#close-meeting").onclick = async () => {
    try {
      await api.post(`/api/v1/meetings/${mt.id}/close`, {});
      toast("Meeting closed — minutes generated");
      reload();
    } catch (err) { showError(err); }
  };
  container.querySelectorAll(".cap").forEach((b) => {
    if (b.id === "simulate-btn") { b.onclick = () => simulateModal(); return; }
    b.onclick = () => captureModal(d, it, b.dataset.kind, reload);
  });
  container.querySelectorAll(".convert-cr").forEach((b) =>
    b.onclick = () => convertDecisionModal(d.meeting.id, Number(b.dataset.id), b.dataset.text, reload));
}

// SPM P8 — decision → governed change request (stays PENDING for Steering)
function convertDecisionModal(meetingId, decisionId, text, reload) {
  modal({
    title: "Convert decision to change request",
    saveLabel: "Create change request (PENDING)",
    body: `
      <p class="muted" style="font-size:.85rem">“${esc(text)}”<br>
      The change request is created <b>PENDING</b> — Steering/Admin still decide it through change control.</p>
      <div class="frow">
        <div class="field"><label>Type</label><select name="type">
          ${["SCHEDULE", "SCOPE", "BUDGET", "BENEFIT", "RESOURCE", "CANCELLATION"].map((t) => `<option>${t}</option>`).join("")}
        </select></div>
        <div class="field"><label>Schedule impact (days, optional)</label><input name="days" type="number" step="1"></div>
      </div>
      <div class="field"><label>Impact analysis (optional)</label><textarea name="impact"></textarea></div>`,
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`)?.value;
      await api.post(`/api/v1/meetings/${meetingId}/decisions/${decisionId}/convert-to-cr`, {
        type: v("type"),
        schedule_impact_days: v("days") ? Number(v("days")) : null,
        impact_analysis: v("impact")?.trim() || null,
      });
      toast("Change request created — awaiting Steering decision");
      reload();
    },
  });
}

// SPM P8 — live scenario simulation in the meeting: pure evaluation, no writes
async function simulateModal() {
  let scenarios;
  try { scenarios = (await api.get("/api/v1/scenarios")).scenarios; }
  catch (err) { return showError(err); }
  if (!scenarios.length) return toast("No scenarios yet — create one under Executive → Scenarios", true);
  const box = modal({
    title: "Simulate a portfolio scenario (read-only)",
    saveLabel: "Close",
    body: `
      <div class="field"><label>Scenario</label><select name="scenario">
        ${scenarios.map((s) => `<option value="${s.id}">${esc(s.title)} (${s.status})</option>`).join("")}
      </select></div>
      <div id="sim-out" class="muted" style="font-size:.85rem">Pick a scenario to see its effects — nothing is changed by simulating.</div>`,
    onSave: async () => {},
  });
  const sel = box.querySelector("[name=scenario]");
  const out = box.querySelector("#sim-out");
  const run = async () => {
    out.textContent = "Evaluating…";
    try {
      const ev = await api.get(`/api/v1/scenarios/${sel.value}/evaluate`);
      out.innerHTML = `
        ${ev.budgetDelta != null ? `<p><b>Portfolio budget delta:</b> ${Number(ev.budgetDelta).toLocaleString()} USD</p>` : `<p class="muted">Money detail hidden (finance flag required).</p>`}
        <ul>${ev.effects.map((e) => `<li><b>${esc(e.code || `#${e.project_id}`)}</b> — ${esc(e.action)}
          ${e.schedule ? `: target ${esc(String(e.schedule.from || "?"))} → ${esc(String(e.schedule.to || "?"))}` : ""}
          ${e.budget && e.budget.freed != null ? ` · frees ${Number(e.budget.freed).toLocaleString()} USD` : ""}
          ${e.detail ? ` · ${esc(e.detail)}` : ""}${e.error ? ` · ${esc(e.error)}` : ""}</li>`).join("") || "<li class='muted'>No effects computed.</li>"}</ul>`;
    } catch (err) { out.textContent = err.message || "Evaluation failed"; }
  };
  sel.onchange = run;
  run();
}

function captureModal(d, currentItem, kind, reload) {
  const m = state.meta;
  const users = m.users.filter((u) => u.role !== "VIEWER");
  const projectSelect = `<div class="field"><label>Project</label>
    <select name="project">${d.items.filter((i) => i.code).map((i) =>
      `<option value="${i.project_id}" ${currentItem && i.project_id === currentItem.project_id ? "selected" : ""}>${esc(i.code)} ${esc(i.project_title)}</option>`).join("")}</select></div>`;
  const bodies = {
    action: `${projectSelect}
      <div class="field"><label>Action title</label><input name="title" autofocus></div>
      <div class="frow"><div class="field"><label>Owner</label><select name="owner">${optionList(users, "id", (u) => u.name)}</select></div>
      <div class="field"><label>Due</label><input name="due" type="date"></div></div>`,
    decision: `${projectSelect}
      <div class="field"><label>Decision</label><input name="title" autofocus></div>
      <div class="field"><label>Decided by</label><input name="by" value="${esc(state.user.name)}"></div>`,
    roadblock: `${projectSelect}
      <div class="field"><label>Roadblock title</label><input name="title" autofocus></div>
      <div class="frow"><div class="field"><label>Severity</label><select name="sev">${["CRITICAL", "MAJOR", "MINOR"].map((s) => `<option ${s === "MAJOR" ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label>Owner</label><select name="owner">${optionList(users, "id", (u) => u.name, "", "—")}</select></div></div>`,
    note: `${projectSelect}
      <div class="field"><label>Note</label><textarea name="title" autofocus></textarea></div>`,
  };
  modal({
    title: `Capture ${kind}`,
    saveLabel: "Save (creates real object)",
    body: bodies[kind],
    onSave: async (box) => {
      const v = (n) => box.querySelector(`[name=${n}]`)?.value;
      const project_id = Number(v("project")) || null;
      const payloads = {
        action: { kind, project_id, title: v("title"), owner_user_id: Number(v("owner")), due_date: v("due") || null },
        decision: { kind, project_id, text: v("title"), decided_by: v("by") || undefined },
        roadblock: { kind, project_id, title: v("title"), severity: v("sev"), owner_user_id: v("owner") ? Number(v("owner")) : null },
        note: { kind, project_id, text: v("title") },
      };
      if (!v("title")?.trim()) throw new Error("Title is required");
      await api.post(`/api/v1/meetings/${d.meeting.id}/capture`, payloads[kind]);
      toast(`${kind[0].toUpperCase() + kind.slice(1)} captured & linked`);
      reload();
    },
  });
}

function renderMinutes(container, d) {
  const mt = d.meeting;
  container.innerHTML = `
    <a href="#/meetings" style="font-size:.8rem;color:var(--ink-soft)">← Meetings</a>
    <div class="page-head" style="margin-top:8px"><h1>${esc(mt.title)} — Minutes</h1>
      <span class="mstatus CLOSED">CLOSED</span>
      <span style="margin-left:auto"></span>
      <button class="btn" id="print-minutes">🖨 Print / PDF</button>
      <button class="btn primary" id="copy-minutes">⧉ Copy for email</button>
    </div>
    <iframe class="minutes-frame" src="/api/v1/meetings/${mt.id}/minutes.html"></iframe>`;
  container.querySelector("#print-minutes").onclick = () => {
    container.querySelector("iframe").contentWindow.print();
  };
  container.querySelector("#copy-minutes").onclick = async () => {
    const doc = container.querySelector("iframe").contentDocument;
    const html = doc.body.innerHTML;
    const text = doc.body.innerText;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      toast("Minutes copied — paste into an email");
    } catch {
      await navigator.clipboard.writeText(text);
      toast("Minutes copied as text");
    }
  };
}
