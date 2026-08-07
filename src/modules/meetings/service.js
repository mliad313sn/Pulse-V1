"use strict";
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, notFound, forbidden } = require("../../middleware/errors");
const { loadProjectAccess } = require("../../middleware/authz");
const notifications = require("../notifications/service");
const actionsService = require("../actions/service");
const roadblocksService = require("../roadblocks/service");
const projectsService = require("../projects/service");

// ===== auto-agenda: the 6 rules (plan §4.3), optionally scoped to one site =====
async function buildAgenda(siteId /* nullable */, meetingType) {
  const params = [];
  let siteClause = "";
  if (siteId) {
    params.push(siteId);
    siteClause = `AND EXISTS (SELECT 1 FROM project_sites ps
                    WHERE ps.project_id = p.id AND ps.site_id = $${params.length} AND ps.deleted_at IS NULL)`;
  }
  const activeProjects = `p.deleted_at IS NULL AND p.stage NOT IN ('CLOSED') AND p.operating_status NOT IN ('CANCELLED') ${siteClause}`;

  // (a) RED projects  (b) AMBER projects — effective (override wins)
  const ragRows = await query(
    `SELECT p.id, p.code, p.title, coalesce(p.rag_override, p.rag_computed) AS rag
       FROM projects p WHERE ${activeProjects}
        AND coalesce(p.rag_override, p.rag_computed) IN ('R','A')
      ORDER BY coalesce(p.rag_override, p.rag_computed) DESC, p.priority`,
    params
  );

  // (c) new roadblocks since last CLOSED meeting of same type
  const lastClosed = await query(
    `SELECT max(m.date) AS d FROM meetings m
      WHERE m.type = $1 AND m.status = 'CLOSED' AND m.deleted_at IS NULL`,
    [meetingType]
  );
  const since = lastClosed.rows[0].d || "1970-01-01";
  const rbParams = [...params, since];
  const newRoadblocks = await query(
    `SELECT r.id, r.title, r.severity, p.id AS project_id, p.code, p.title AS project_title
       FROM roadblocks r JOIN projects p ON p.id = r.project_id
      WHERE r.deleted_at IS NULL AND r.status <> 'RESOLVED' AND ${activeProjects}
        AND r.created_at > $${rbParams.length}::date
      ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END`,
    rbParams
  );

  // (d) overdue actions grouped by owner
  const overdue = await query(
    `SELECT u.name AS owner, count(*)::int AS n,
            json_agg(json_build_object('title', a.title, 'due', a.due_date, 'project', p.code) ORDER BY a.due_date) AS items
       FROM actions a
       JOIN users u ON u.id = a.owner_user_id
       LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.deleted_at IS NULL AND a.status = 'OPEN'
        AND a.due_date < (now() AT TIME ZONE 'utc')::date
        AND (a.project_id IS NULL OR (p.deleted_at IS NULL AND p.stage NOT IN ('CLOSED')
             ${siteId ? `AND EXISTS (SELECT 1 FROM project_sites ps WHERE ps.project_id = p.id AND ps.site_id = $1 AND ps.deleted_at IS NULL)` : ""}))
      GROUP BY u.name ORDER BY n DESC`,
    params
  );

  // (e) GO_LIVE within 30 days
  const goLives = await query(
    `SELECT m.id, m.title, m.due_date, p.id AS project_id, p.code, p.title AS project_title
       FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.deleted_at IS NULL AND m.type = 'GO_LIVE' AND m.status <> 'DONE'
        AND m.due_date BETWEEN (now() AT TIME ZONE 'utc')::date AND (now() AT TIME ZONE 'utc')::date + 30
        AND ${activeProjects}
      ORDER BY m.due_date`,
    params
  );

  // (f) silent projects (no activity > 30 days; freshness-exempt stages excluded)
  const silent = await query(
    `SELECT p.id, p.code, p.title FROM projects p
      WHERE ${activeProjects}
        AND p.stage NOT IN ('RUN') AND p.operating_status NOT IN ('ON_HOLD')
        AND p.last_activity_at < now() - interval '30 days'`,
    params
  );

  // (g) gates waiting approval: PLANNING (DESIGN) projects whose milestone
  // prerequisite is met — only a Steering approver can move them forward
  const gatesWaiting = await query(
    `SELECT p.id, p.code, p.title FROM projects p
      WHERE ${activeProjects} AND p.stage = 'PLANNING'
        AND EXISTS (SELECT 1 FROM milestones m
                     WHERE m.project_id = p.id AND m.deleted_at IS NULL)`,
    params
  );

  // (h) critical/overdue CAPA
  const overdueCapa = await query(
    `SELECT c.id, c.issue, c.due_date, p.id AS project_id
       FROM capas c JOIN projects p ON p.id = c.project_id
      WHERE c.deleted_at IS NULL AND c.status <> 'CLOSED'
        AND c.due_date IS NOT NULL AND c.due_date < (now() AT TIME ZONE 'utc')::date
        AND ${activeProjects}
      ORDER BY c.due_date`,
    params
  );

  // assemble: one item per project, first matching rule tags it; ad-hoc item for overdue actions
  const items = [];
  const byProject = new Map();
  const push = (projectId, reason, note) => {
    if (projectId && byProject.has(projectId)) {
      // project already on the agenda — enrich its item instead of dropping the signal
      const item = byProject.get(projectId);
      if (note) item.notes = item.notes ? `${item.notes}\n${reason}: ${note}` : `${reason}: ${note}`;
      return;
    }
    const item = { project_id: projectId, reason, notes: note };
    if (projectId) byProject.set(projectId, item);
    items.push(item);
  };

  // a silent project is RED by construction — keep it in the RED block but with
  // its more actionable reason so the meeting asks the right question
  const silentIds = new Set(silent.rows.map((s) => s.id));
  for (const p of ragRows.rows.filter((r) => r.rag === "R")) {
    push(p.id, silentIds.has(p.id) ? "Silent project (>30d)" : "RED project", null);
  }
  for (const p of ragRows.rows.filter((r) => r.rag === "A")) push(p.id, "AMBER project", null);
  for (const rb of newRoadblocks.rows) {
    push(rb.project_id, "New roadblock", `${rb.severity}: ${rb.title}`);
  }
  if (overdue.rows.length > 0) {
    const summary = overdue.rows
      .map((o) => `${o.owner} (${o.n}): ` + o.items.map((i) => `${i.title}${i.project ? ` [${i.project}]` : ""}`).join("; "))
      .join(" | ");
    items.push({ project_id: null, reason: "Overdue actions by owner", notes: summary });
  }
  for (const g of goLives.rows) {
    push(g.project_id, "GO_LIVE ≤30 days", `${g.title} due ${g.due_date.toISOString().slice(0, 10)}`);
  }
  for (const s of silent.rows) push(s.id, "Silent project (>30d)", null);
  for (const g of gatesWaiting.rows) {
    push(g.id, "Gate awaiting Steering approval", "PLANNING → EXECUTION prerequisites met");
  }
  for (const c of overdueCapa.rows) {
    push(c.project_id, "Overdue CAPA", `${c.issue.slice(0, 120)} (due ${c.due_date.toISOString().slice(0, 10)})`);
  }

  return items;
}

function canManageMeetings(user) {
  return user.role === "ADMIN" || user.role === "DIVISION_LEAD";
}

async function createMeeting(actor, { title, date, type, site_id, attendees }) {
  if (!canManageMeetings(actor)) throw forbidden("Only Admin or Division Leads can create meetings");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO meetings (title, date, type, site_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, date, type, site_id || null, actor.id]
    );
    const meeting = rows[0];
    const agenda = await buildAgenda(site_id || null, type);
    let order = 0;
    for (const item of agenda) {
      await client.query(
        `INSERT INTO meeting_items (meeting_id, project_id, order_index, notes, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [meeting.id, item.project_id, order++, item.notes, item.reason, actor.id]
      );
    }
    for (const userId of attendees || []) {
      await client.query(
        `INSERT INTO meeting_attendees (meeting_id, user_id, created_by)
         VALUES ($1,$2,$3) ON CONFLICT (meeting_id, user_id) DO NOTHING`,
        [meeting.id, userId, actor.id]
      );
    }
    await audit.recordCreate(client, "meeting", meeting.id, actor.id);
    // MEETING_SCHEDULED -> PMs of agenda projects (plan §2)
    const pms = await client.query(
      `SELECT DISTINCT p.project_manager_id AS pm FROM meeting_items mi
         JOIN projects p ON p.id = mi.project_id
        WHERE mi.meeting_id = $1 AND p.project_manager_id IS NOT NULL AND mi.deleted_at IS NULL`,
      [meeting.id]
    );
    for (const r of pms.rows) {
      await notifications.create(client, {
        userId: r.pm, type: "MEETING_SCHEDULED", entity: "meeting", entityId: meeting.id,
        text: `Meeting scheduled: ${title} (${date}) — a project you manage is on the agenda`,
        createdBy: actor.id,
      });
    }
    return meeting;
  });
}

async function loadMeeting(id) {
  const { rows } = await query(`SELECT * FROM meetings WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw notFound("Meeting not found");
  return rows[0];
}

function canDrive(actor, meeting) {
  return actor.role === "ADMIN" || meeting.created_by === actor.id;
}

async function listMeetings({ limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT m.*, s.code AS site_code,
            (SELECT count(*)::int FROM meeting_items mi WHERE mi.meeting_id = m.id AND mi.deleted_at IS NULL) AS item_count
       FROM meetings m LEFT JOIN sites s ON s.id = m.site_id
      WHERE m.deleted_at IS NULL
      ORDER BY m.date DESC, m.id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function getMeetingDetail(user, id) {
  const meeting = await loadMeeting(id);
  const [items, attendees] = await Promise.all([
    query(
      `SELECT mi.*, p.code, p.title AS project_title, p.stage, p.progress_pct, p.target_date,
              coalesce(p.rag_override, p.rag_computed) AS rag, p.rag_signals_json,
              pm.name AS pm_name,
              (SELECT json_agg(s.code) FROM project_sites ps JOIN sites s ON s.id = ps.site_id
                WHERE ps.project_id = p.id AND ps.deleted_at IS NULL) AS sites,
              (SELECT json_agg(json_build_object('id', r.id, 'title', r.title, 'severity', r.severity, 'status', r.status))
                 FROM roadblocks r WHERE r.project_id = p.id AND r.deleted_at IS NULL AND r.status <> 'RESOLVED') AS open_roadblocks,
              (SELECT json_agg(json_build_object('id', a.id, 'title', a.title, 'due_date', a.due_date,
                                                 'owner', u2.name,
                                                 'overdue', (a.due_date < (now() AT TIME ZONE 'utc')::date)))
                 FROM actions a LEFT JOIN users u2 ON u2.id = a.owner_user_id
                WHERE a.project_id = p.id AND a.deleted_at IS NULL AND a.status = 'OPEN') AS open_actions
         FROM meeting_items mi
         LEFT JOIN projects p ON p.id = mi.project_id AND p.deleted_at IS NULL
         LEFT JOIN users pm ON pm.id = p.project_manager_id
        WHERE mi.meeting_id = $1 AND mi.deleted_at IS NULL
        ORDER BY mi.order_index`,
      [id]
    ),
    query(
      `SELECT ma.user_id, ma.present, u.name, u.role
         FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id
        WHERE ma.meeting_id = $1 AND ma.deleted_at IS NULL ORDER BY u.name`,
      [id]
    ),
  ]);
  // hide confidential projects from contributors/viewers in agenda items
  const visibleItems = [];
  for (const it of items.rows) {
    if (it.project_id) {
      try {
        await loadProjectAccess(it.project_id, user);
      } catch {
        continue;
      }
    }
    visibleItems.push(it);
  }
  const captured = await query(
    `SELECT 'action' AS kind, a.id, a.title AS text, u.name AS owner, a.due_date, p.code AS project_code
       FROM actions a LEFT JOIN users u ON u.id = a.owner_user_id
       LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.meeting_id = $1 AND a.deleted_at IS NULL
     UNION ALL
     SELECT 'decision', d.id, d.text, d.decided_by, d.date, p2.code
       FROM decisions d LEFT JOIN projects p2 ON p2.id = d.project_id
      WHERE d.meeting_id = $1 AND d.deleted_at IS NULL
     ORDER BY id`,
    [id]
  );
  return {
    meeting,
    canDrive: canDrive(user, meeting),
    items: visibleItems,
    attendees: attendees.rows,
    captured: captured.rows,
  };
}

async function updateItems(actor, meetingId, itemOps) {
  const meeting = await loadMeeting(meetingId);
  if (!canDrive(actor, meeting)) throw forbidden("Only the organizer or Admin can edit the agenda");
  if (meeting.status === "CLOSED") throw badRequest("Meeting is closed");
  return withTransaction(async (client) => {
    for (const op of itemOps) {
      if (op.op === "add") {
        await client.query(
          `INSERT INTO meeting_items (meeting_id, project_id, order_index, notes, reason, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [meetingId, op.project_id || null, op.order_index || 999, op.notes || null, op.reason || "Added by organizer", actor.id]
        );
      } else if (op.op === "remove") {
        await client.query(
          `UPDATE meeting_items SET deleted_at = now() WHERE id = $1 AND meeting_id = $2`,
          [op.id, meetingId]
        );
      } else if (op.op === "reorder") {
        await client.query(
          `UPDATE meeting_items SET order_index = $3, updated_at = now() WHERE id = $1 AND meeting_id = $2`,
          [op.id, meetingId, op.order_index]
        );
      } else if (op.op === "note") {
        await client.query(
          `UPDATE meeting_items SET notes = $3, updated_at = now() WHERE id = $1 AND meeting_id = $2`,
          [op.id, meetingId, op.notes]
        );
      }
    }
    await audit.record(client, {
      entity: "meeting", entityId: meetingId, userId: actor.id,
      changes: [{ field: "agenda", old: null, new: `${itemOps.length} item operation(s)` }],
    });
  });
}

async function setStatus(actor, meetingId, status) {
  const meeting = await loadMeeting(meetingId);
  if (!canDrive(actor, meeting)) throw forbidden("Only the organizer or Admin can drive the meeting");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE meetings SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [meetingId, status]
    );
    await audit.record(client, {
      entity: "meeting", entityId: meetingId, userId: actor.id,
      changes: [{ field: "status", old: meeting.status, new: status }],
    });
    return rows[0];
  });
}

async function setAttendance(actor, meetingId, userId, present) {
  const meeting = await loadMeeting(meetingId);
  if (!canDrive(actor, meeting)) throw forbidden("Only the organizer or Admin can mark attendance");
  await query(
    `INSERT INTO meeting_attendees (meeting_id, user_id, present, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (meeting_id, user_id) DO UPDATE SET present = $3, updated_at = now(), deleted_at = NULL`,
    [meetingId, userId, present, actor.id]
  );
}

// Live capture: creates the REAL object attached to project AND meeting (plan §4.3)
async function capture(actor, meetingId, payload) {
  const meeting = await loadMeeting(meetingId);
  if (!canDrive(actor, meeting)) throw forbidden("Only the organizer or Admin can capture during the meeting");
  if (meeting.status === "CLOSED") throw badRequest("Meeting is closed");

  const { kind, project_id } = payload;
  const projectAccess = project_id ? await loadProjectAccess(project_id, actor) : null;

  if (kind === "action") {
    return actionsService.createAction(
      actor,
      { title: payload.title, owner_user_id: payload.owner_user_id, due_date: payload.due_date, meeting_id: meetingId, source: "MEETING" },
      projectAccess
    );
  }
  if (kind === "decision") {
    if (!projectAccess) throw badRequest("Decisions must be attached to a project");
    return projectsService.addDecision(actor, projectAccess, {
      text: payload.text, decidedBy: payload.decided_by, meetingId,
      date: meeting.date instanceof Date ? meeting.date.toISOString().slice(0, 10) : meeting.date,
    });
  }
  if (kind === "roadblock") {
    if (!projectAccess) throw badRequest("Roadblocks must be attached to a project");
    return roadblocksService.createRoadblock(actor, projectAccess, {
      title: payload.title, severity: payload.severity || "MAJOR",
      owner_user_id: payload.owner_user_id, due_date: payload.due_date,
    });
  }
  if (kind === "note") {
    const { rows } = await query(
      `SELECT id, notes FROM meeting_items
        WHERE meeting_id = $1 AND deleted_at IS NULL AND (project_id = $2 OR ($2::bigint IS NULL AND project_id IS NULL))
        ORDER BY order_index LIMIT 1`,
      [meetingId, project_id || null]
    );
    if (rows[0]) {
      const merged = rows[0].notes ? `${rows[0].notes}\n${payload.text}` : payload.text;
      await query(`UPDATE meeting_items SET notes = $2, updated_at = now() WHERE id = $1`, [rows[0].id, merged]);
      return { id: rows[0].id, notes: merged };
    }
    const ins = await query(
      `INSERT INTO meeting_items (meeting_id, project_id, order_index, notes, reason, created_by)
       VALUES ($1,$2,998,$3,'Note',$4) RETURNING *`,
      [meetingId, project_id || null, payload.text, actor.id]
    );
    return ins.rows[0];
  }
  throw badRequest("Unknown capture kind");
}

// Close: build minutes as structured JSON (plan §4.3) and store the snapshot
async function closeMeeting(actor, meetingId) {
  const meeting = await loadMeeting(meetingId);
  if (!canDrive(actor, meeting)) throw forbidden("Only the organizer or Admin can close the meeting");
  const detail = await getMeetingDetail(actor, meetingId);

  const minutes = {
    title: meeting.title,
    date: meeting.date instanceof Date ? meeting.date.toISOString().slice(0, 10) : meeting.date,
    type: meeting.type,
    site_id: meeting.site_id,
    closed_at: new Date().toISOString(),
    attendees: detail.attendees.map((a) => ({ name: a.name, present: a.present })),
    items: detail.items.map((it) => ({
      project_code: it.code || null,
      project_title: it.project_title || null,
      reason: it.reason,
      notes: it.notes,
      rag: it.rag || null,
      progress_pct: it.progress_pct ?? null,
    })),
    decisions: detail.captured.filter((c) => c.kind === "decision")
      .map((d) => ({ text: d.text, decided_by: d.owner, date: d.due_date, project: d.project_code })),
    actions: detail.captured.filter((c) => c.kind === "action")
      .map((a) => ({ title: a.text, owner: a.owner, due: a.due_date, project: a.project_code })),
    rag_snapshot: detail.items.filter((it) => it.code)
      .map((it) => ({ project: it.code, rag: it.rag, progress_pct: it.progress_pct })),
  };

  return withTransaction(async (client) => {
    // versioned snapshot: re-closing after correcting underlying objects creates v+1;
    // prior versions are never modified (plan §147)
    const v = await client.query(
      `SELECT coalesce(max(version), 0) + 1 AS next FROM meeting_minutes_versions WHERE meeting_id = $1`,
      [meetingId]
    );
    const version = v.rows[0].next;
    minutes.version = version;
    await client.query(
      `INSERT INTO meeting_minutes_versions (meeting_id, version, minutes_json, closed_by)
       VALUES ($1,$2,$3,$4)`,
      [meetingId, version, JSON.stringify(minutes), actor.id]
    );
    const { rows } = await client.query(
      `UPDATE meetings SET status = 'CLOSED', minutes_json = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [meetingId, JSON.stringify(minutes)]
    );
    await audit.record(client, {
      entity: "meeting", entityId: meetingId, userId: actor.id,
      changes: [{ field: "minutes_version", old: String(version - 1) || null, new: String(version) }],
    });
    return rows[0];
  });
}

async function getMinutesVersion(meetingId, version) {
  if (version) {
    const { rows } = await query(
      `SELECT minutes_json, version FROM meeting_minutes_versions
        WHERE meeting_id = $1 AND version = $2`,
      [meetingId, version]
    );
    return rows[0] || null;
  }
  const meeting = await loadMeeting(meetingId);
  return meeting.minutes_json ? { minutes_json: meeting.minutes_json, version: meeting.minutes_json.version } : null;
}

async function listMinutesVersions(meetingId) {
  const { rows } = await query(
    `SELECT v.version, v.created_at, u.name AS closed_by_name
       FROM meeting_minutes_versions v JOIN users u ON u.id = v.closed_by
      WHERE v.meeting_id = $1 ORDER BY v.version`,
    [meetingId]
  );
  return rows;
}

// ===== minutes rendering: ALL user text escaped — stored XSS prevention (plan §4.3) =====
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderMinutesHtml(minutes) {
  const ragChip = (r) =>
    r ? `<span class="rag rag-${esc(r)}">${esc(r)}</span>` : "";
  const rows = (arr, fn) => arr.map(fn).join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Minutes — ${esc(minutes.title)}</title>
<style>
  body{font-family:Calibri,"Segoe UI",sans-serif;color:#17293d;max-width:820px;margin:24px auto;padding:0 16px}
  h1{color:#1A3A5F;border-bottom:3px solid #E87722;padding-bottom:8px}
  h2{color:#1A3A5F;font-size:1.05rem;margin-top:26px}
  table{border-collapse:collapse;width:100%;font-size:.9rem}
  th{background:#1A3A5F;color:#fff;text-align:left;padding:6px 9px}
  td{border-bottom:1px solid #dde4ec;padding:6px 9px;vertical-align:top}
  .rag{display:inline-block;padding:1px 9px;border-radius:9px;color:#fff;font-weight:700;font-size:.75rem}
  .rag-G{background:#2E9E8F}.rag-A{background:#F2A900}.rag-R{background:#C8102E}
  .meta{color:#4a5d72;font-size:.9rem}
  .notes{white-space:pre-wrap}
  @media print{body{margin:8mm}h1{page-break-after:avoid}}
</style></head><body>
<h1>${esc(minutes.title)}</h1>
<p class="meta">${esc(minutes.date)} · ${esc(minutes.type)} · Endeavour Mining — Group IT · GMT</p>

<h2>Attendees</h2>
<p>${rows(minutes.attendees, (a) => `${esc(a.name)}${a.present ? "" : " (absent)"}`).length ? minutes.attendees.map((a) => `${esc(a.name)}${a.present ? "" : " <span class=meta>(absent)</span>"}`).join(", ") : "—"}</p>

<h2>Agenda items</h2>
<table><tr><th>Project</th><th>Why on agenda</th><th>RAG</th><th>Progress</th><th>Notes</th></tr>
${rows(minutes.items, (it) => `<tr>
  <td>${esc(it.project_code || "General")}<br><span class="meta">${esc(it.project_title || "")}</span></td>
  <td>${esc(it.reason || "")}</td>
  <td>${ragChip(it.rag)}</td>
  <td>${it.progress_pct != null ? esc(it.progress_pct) + "%" : ""}</td>
  <td class="notes">${esc(it.notes || "")}</td></tr>`)}
</table>

<h2>Decisions</h2>
${minutes.decisions.length ? `<table><tr><th>Decision</th><th>Decided by</th><th>Project</th></tr>
${rows(minutes.decisions, (d) => `<tr><td>${esc(d.text)}</td><td>${esc(d.decided_by || "")}</td><td>${esc(d.project || "")}</td></tr>`)}</table>` : `<p class="meta">No decisions recorded.</p>`}

<h2>Actions</h2>
${minutes.actions.length ? `<table><tr><th>Action</th><th>Owner</th><th>Due</th><th>Project</th></tr>
${rows(minutes.actions, (a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.owner || "")}</td><td>${esc(a.due ? String(a.due).slice(0, 10) : "")}</td><td>${esc(a.project || "")}</td></tr>`)}</table>` : `<p class="meta">No actions recorded.</p>`}

<h2>RAG snapshot at close</h2>
${minutes.rag_snapshot.length ? `<table><tr><th>Project</th><th>RAG</th><th>Progress</th></tr>
${rows(minutes.rag_snapshot, (r) => `<tr><td>${esc(r.project)}</td><td>${ragChip(r.rag)}</td><td>${esc(r.progress_pct)}%</td></tr>`)}</table>` : `<p class="meta">—</p>`}
</body></html>`;
}

module.exports = {
  createMeeting, listMeetings, getMeetingDetail, updateItems, setStatus,
  setAttendance, capture, closeMeeting, renderMinutesHtml, buildAgenda, loadMeeting,
  getMinutesVersion, listMinutesVersions,
};
