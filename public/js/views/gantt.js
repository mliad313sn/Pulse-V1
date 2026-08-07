"use strict";
// SPM P11 — plan visuals: a real Gantt drawn from the CPM's computed dates
// (not the raw planned dates, so the bar you see is the schedule the engine
// actually derived), plus a kanban board over the same tasks.
//
// Both are pure rendering over the /plan payload — no second source of truth,
// no invented numbers.
import { esc } from "../lib/ui.js";

const DAY = 86400000;
const toDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : null);
const iso = (d) => d.toISOString().slice(0, 10);

// Gantt bars use the CPM's computed dates when a calendar applied, and fall
// back to the planner's own dates when it did not.
function taskWindow(task, plan) {
  const cpm = plan.criticalPath.dates?.[task.id];
  const start = toDate(cpm?.earlyStart) || toDate(task.planned_start);
  const finish = toDate(cpm?.earlyFinish) || toDate(task.planned_finish);
  return start && finish && finish >= start ? { start, finish, computed: Boolean(cpm?.earlyStart) } : null;
}

export function renderGantt(plan) {
  const rows = plan.tasks
    .map((t) => ({ task: t, win: taskWindow(t, plan) }))
    .filter((r) => r.win);
  if (!rows.length) {
    return `<div class="panel-body muted">No task has both a start and a finish yet — a Gantt needs dates.</div>`;
  }

  const min = new Date(Math.min(...rows.map((r) => r.win.start.getTime())));
  const max = new Date(Math.max(...rows.map((r) => r.win.finish.getTime())));
  const span = Math.max(1, Math.round((max - min) / DAY) + 1);
  const critical = new Set(plan.criticalPath.criticalIds || []);
  const nearCritical = new Set(plan.criticalPath.nearCriticalIds || []);
  const wsName = Object.fromEntries(plan.workstreams.map((w) => [w.id, w.title]));

  // Month ticks across the top so a long plan stays readable
  const ticks = [];
  for (let d = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
    d <= max; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const offset = Math.max(0, Math.round((d - min) / DAY));
    ticks.push({ label: iso(d).slice(0, 7), left: (offset / span) * 100 });
  }

  const bar = ({ task, win }) => {
    const left = (Math.round((win.start - min) / DAY) / span) * 100;
    const width = Math.max(1.2, ((Math.round((win.finish - win.start) / DAY) + 1) / span) * 100);
    const cpm = plan.criticalPath.dates?.[task.id] || {};
    const cls = task.status === "DONE" ? "g-done"
      : cpm.behindDeadline ? "g-late"
        : critical.has(task.id) ? "g-critical"
          : nearCritical.has(task.id) ? "g-near" : "g-normal";
    const slack = plan.criticalPath.slack?.[task.id];
    const title = `${task.title}\n${iso(win.start)} → ${iso(win.finish)}` +
      (slack != null ? `\nfloat ${slack} day(s)` : "") +
      (cpm.behindDeadline ? "\nBEHIND ITS DEADLINE" : "") +
      (win.computed ? "\n(dates computed by the scheduler)" : "\n(planned dates — no calendar applied)");
    return `<div class="g-row">
      <div class="g-label" title="${esc(task.title)}">
        ${critical.has(task.id) ? '<span class="g-flag" title="Critical path">⚑</span>' : ""}
        ${esc(task.title)}
        <span class="muted">${esc(wsName[task.workstream_id] || "")}</span>
      </div>
      <div class="g-track">
        <div class="g-bar ${cls}" style="left:${left}%;width:${width}%" title="${esc(title)}">
          <span>${esc(task.owner_name || "")}</span>
        </div>
      </div>
    </div>`;
  };

  return `
    <div class="panel-body">
      <div class="muted" style="margin-bottom:8px">
        ${iso(min)} → ${iso(max)} ·
        ${plan.criticalPath.calendarApplied
          ? `<b>earliest possible dates</b> computed from the dependency logic on
             <b>${esc(plan.calendar?.name || "the project calendar")}</b> (working days only) —
             the planner's own dates stay in the List view`
          : "planned dates (no calendar applied)"}
        ${plan.criticalPath.violations?.length
          ? ` · <span style="color:var(--rag-red-text);font-weight:700">${plan.criticalPath.violations.length} constraint violation(s)</span>`
          : ""}
      </div>
      <div class="gantt">
        <div class="g-row g-ticks"><div class="g-label"></div><div class="g-track">
          ${ticks.map((t) => `<span class="g-tick" style="left:${t.left}%">${t.label}</span>`).join("")}
        </div></div>
        ${rows.map(bar).join("")}
      </div>
      <div class="g-legend">
        <span><i class="g-bar g-critical"></i> critical</span>
        <span><i class="g-bar g-near"></i> near-critical</span>
        <span><i class="g-bar g-late"></i> past its deadline</span>
        <span><i class="g-bar g-done"></i> done</span>
      </div>
      ${plan.criticalPath.violations?.length ? `<ul class="g-violations">
        ${plan.criticalPath.violations.map((v) => `<li>${esc(v.detail)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

const BOARD_COLUMNS = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"];

export function renderBoard(plan) {
  const critical = new Set(plan.criticalPath.criticalIds || []);
  const wsName = Object.fromEntries(plan.workstreams.map((w) => [w.id, w.title]));
  const byStatus = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, []]));
  for (const t of plan.tasks) {
    if (t.status === "CANCELLED") continue;
    (byStatus[t.status] || byStatus.NOT_STARTED).push(t);
  }
  return `<div class="panel-body board">
    ${BOARD_COLUMNS.map((col) => `<div class="board-col">
      <h4>${col.replace("_", " ")} <span class="muted">${byStatus[col].length}</span></h4>
      ${byStatus[col].map((t) => `<div class="board-card" data-task="${t.id}" data-ua="${t.updated_at}">
        <div>${critical.has(t.id) ? '<span class="g-flag">⚑</span> ' : ""}${esc(t.title)}</div>
        <div class="muted">${esc(t.owner_name || "unassigned")}${
          wsName[t.workstream_id] ? ` · ${esc(wsName[t.workstream_id])}` : ""}</div>
        ${t.planned_finish ? `<div class="muted">due ${esc(String(t.planned_finish).slice(0, 10))}</div>` : ""}
      </div>`).join("") || '<div class="muted board-empty">—</div>'}
    </div>`).join("")}
  </div>`;
}
