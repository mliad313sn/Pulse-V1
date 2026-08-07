"use strict";
// PULSE ↔ SDP, PHASE 4 — the governance loops.
//
// These are CONTROLS, not reports: reproducible on demand, and their output is
// evidence. All four are read-only against SDP. PULSE never writes there.
const pool = require("../../db/pool");
const audit = require("../../middleware/audit");
const { forbidden } = require("../../middleware/errors");

async function sdpHas(table) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'sdp_fdw' AND table_name = $1`, [table]);
  return rows[0].n > 0;
}
const blocked = (what) => ({
  ok: false, code: "BLOCKED_EXTERNAL",
  reason: `sdp_fdw.${what} is not present — connect the SDP source to run this control`,
});

// ===== Control 1: a go-live without a change record =====
//
// Every GO_LIVE or SECURITY_GATE milestone due soon should have a matching SDP
// change record. Only 148 changes exist for all of 2026 against a full
// portfolio, so the first run is expected to be long. That is the finding.
async function goLiveWithoutChange(user, { horizonDays = 14 } = {}) {
  if (!(await sdpHas("change_records"))) return blocked("change_records");

  const { rows: milestones } = await pool.query(
    `SELECT m.id, m.title, m.type, m.due_date, p.id AS project_id, p.code, p.title AS project_title,
            p.confidential,
            (SELECT array_agg(s.code) FROM project_sites ps
               JOIN sites s ON s.id = ps.site_id
              WHERE ps.project_id = p.id AND ps.deleted_at IS NULL) AS sites
       FROM milestones m
       JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
      WHERE m.deleted_at IS NULL AND m.status <> 'DONE'
        AND m.type IN ('GO_LIVE','SECURITY_GATE')
        AND m.due_date IS NOT NULL
        AND m.due_date BETWEEN (now() AT TIME ZONE 'utc')::date
                           AND (now() AT TIME ZONE 'utc')::date + $1::int
      ORDER BY m.due_date`, [horizonDays]);

  // Concealment holds even in a control: a viewer never learns a confidential
  // project exists. Hidden rows are counted, never named.
  const { loadProjectAccess } = require("../../middleware/authz");
  const findings = [];
  let concealed = 0;

  for (const m of milestones) {
    try { await loadProjectAccess(m.project_id, user); }
    catch { concealed++; continue; }

    // A plausible match: a change scheduled within a week of the milestone at
    // one of the project's sites. Deliberately generous — this control flags
    // absence, and a false "matched" is worse than a false flag.
    const { rows: matches } = await pool.query(
      `SELECT c.change_id, c.display_id, c.title, c.status, c.scheduled_start
         FROM sdp_fdw.change_records c
         LEFT JOIN emid.site_alias sa ON sa.system = 'SDP_TICKET_LABEL' AND sa.alias = c.site
        WHERE c.scheduled_start IS NOT NULL
          AND c.scheduled_start::date BETWEEN $1::date - 7 AND $1::date + 7
          AND ($2::text[] IS NULL OR sa.code = ANY($2::text[]) OR c.site IS NULL)`,
      [m.due_date, m.sites]);

    findings.push({
      milestone_id: m.id, milestone: m.title, type: m.type,
      due_date: String(m.due_date).slice(0, 10),
      project_id: m.project_id, project_code: m.code, project_title: m.project_title,
      sites: m.sites || [],
      matched: matches.length > 0,
      candidates: matches.slice(0, 3).map((c) => ({
        change: c.display_id || c.change_id, title: c.title, status: c.status,
        scheduled: c.scheduled_start ? String(c.scheduled_start).slice(0, 10) : null,
      })),
      finding: matches.length
        ? null
        : `${m.type} "${m.title}" on ${m.code} is due ${String(m.due_date).slice(0, 10)} with no change record in ServiceDesk Plus within ±7 days.`,
    });
  }

  const unmatched = findings.filter((f) => !f.matched);
  return {
    ok: true, horizon_days: horizonDays,
    checked: findings.length, concealed_from_you: concealed,
    findings: unmatched, matched: findings.length - unmatched.length,
    control: "GO_LIVE_WITHOUT_CHANGE_RECORD",
    run_at: new Date().toISOString(),
    explanation: `${unmatched.length} of ${findings.length} imminent go-live/security milestones have no matching change record.` +
      (concealed ? ` ${concealed} further milestone(s) are on projects you cannot see.` : ""),
  };
}

// ===== Control 2: the tracker's heaviest activity, computed =====
//
// P2-ITPROJECTINITIATIVES carries weight 0.165 — the single heaviest item in
// the heaviest pillar — and is typed in by hand each month. PULSE knows the
// real number. We compute it and show the delta; we do NOT write to SDP.
async function trackerProjectInitiatives(user, { year } = {}) {
  const y = year || new Date().getUTCFullYear();
  const { rows: computed } = await pool.query(
    `SELECT s.code AS site_code,
            to_char(m.first_day, 'YYYY-MM') AS period,
            count(DISTINCT p.id)::int AS pulse_projects
       FROM emid.calendar_month m
       CROSS JOIN sites s
       LEFT JOIN project_sites ps ON ps.site_id = s.id AND ps.deleted_at IS NULL
       LEFT JOIN projects p ON p.id = ps.project_id AND p.deleted_at IS NULL
            AND p.stage NOT IN ('IDEA','CLOSED')
            AND p.operating_status NOT IN ('CANCELLED')
            AND coalesce(p.start_date, m.first_day) <= m.last_day
            AND coalesce(p.actual_end_date, p.target_date, m.last_day) >= m.first_day
      WHERE m.year = $1 AND s.deleted_at IS NULL
      GROUP BY 1, 2 ORDER BY 1, 2`, [y]);

  let reported = [];
  const haveTracker = await sdpHas("tracker_inputs_v2");
  if (haveTracker) {
    const { rows } = await pool.query(
      `SELECT sa.code AS site_code, to_char(make_date(t.year, t.month, 1), 'YYYY-MM') AS period,
              sum(t.actual) AS reported
         FROM sdp_fdw.tracker_inputs_v2 t
         JOIN emid.site_alias sa ON sa.system = 'TRACKER' AND sa.alias = t.site_code
        WHERE t.year = $1 AND t.activity_code = 'P2-ITPROJECTINITIATIVES'
        GROUP BY 1,2`, [y]);
    reported = rows;
  }
  const reportedBy = new Map(reported.map((r) => [`${r.site_code}|${r.period}`, Number(r.reported)]));

  const rows = computed.map((c) => {
    const rep = reportedBy.get(`${c.site_code}|${c.period}`);
    return {
      ...c,
      tracker_reported: rep ?? null,
      delta: rep == null ? null : c.pulse_projects - rep,
      status: rep == null ? (c.pulse_projects > 0 ? "NOT_REPORTED" : "NONE")
        : c.pulse_projects === rep ? "MATCH" : "DIFFERS",
    };
  }).filter((r) => r.pulse_projects > 0 || r.tracker_reported);

  // Sites with active projects that reported nothing all year.
  const silent = [...new Set(rows.filter((r) => r.status === "NOT_REPORTED").map((r) => r.site_code))];

  return {
    ok: true, year: y, activity: "P2-ITPROJECTINITIATIVES", weight: 0.165,
    tracker_connected: haveTracker,
    rows, silent_sites: silent,
    control: "TRACKER_INITIATIVES_RECONCILIATION",
    run_at: new Date().toISOString(),
    note: "Computed from PULSE for the tracker owner to accept. PULSE never writes into the SDP database.",
    explanation: haveTracker
      ? `${rows.filter((r) => r.status === "DIFFERS").length} site-month(s) differ from what the tracker reports; ` +
        `${silent.length} site(s) have active projects but reported nothing.`
      : `Computed from PULSE only — the tracker source is not connected, so no comparison was possible.`,
  };
}

// ===== Control 3: inspection findings become risks =====
async function importInspectionFindings(actor, { dryRun = false } = {}) {
  if (actor.role !== "ADMIN" && actor.role !== "DIVISION_LEAD") {
    throw forbidden("Only Admins and Division Leads import inspection findings");
  }
  if (!(await sdpHas("insp_actions"))) return blocked("insp_actions");

  const { rows: actions } = await pool.query(
    `SELECT a.*, i.overall_risk, i.inspection_date, i.site_code AS inspection_site
       FROM sdp_fdw.insp_actions a
       LEFT JOIN sdp_fdw.insp_inspections i ON i.inspection_id = a.inspection_id
      WHERE lower(coalesce(a.status,'')) NOT IN ('closed','done','completed')`);

  const result = { ok: true, dryRun, risks: 0, skipped: 0, no_project: 0, items: [] };

  await pool.withTransaction(async (client) => {
    for (const a of actions) {
      const siteCode = a.site_code || a.inspection_site;
      const { rows: project } = await client.query(
        `SELECT p.id, p.code FROM projects p
           JOIN project_sites ps ON ps.project_id = p.id AND ps.deleted_at IS NULL
           JOIN sites s ON s.id = ps.site_id
           JOIN emid.site_alias sa ON sa.code = s.code AND sa.system = 'INSPECTION' AND sa.alias = $1
          WHERE p.deleted_at IS NULL AND p.stage NOT IN ('CLOSED')
            AND p.operating_status NOT IN ('CANCELLED')
          ORDER BY p.priority, p.id LIMIT 1`, [siteCode]);
      if (!project.length) { result.no_project++; continue; }

      const ref = `insp_actions:${a.action_id}`;
      const { rows: seen } = await client.query(
        `SELECT id FROM risks WHERE project_id = $1 AND description LIKE $2 AND deleted_at IS NULL`,
        [project[0].id, `%${ref}%`]);
      if (seen.length) { result.skipped++; continue; }

      result.items.push({ ref, site: siteCode, project: project[0].code, finding: a.finding });
      if (dryRun) { result.risks++; continue; }

      // High-risk inspections carry a higher impact; everything else is a
      // standard control gap. Probability stays moderate — the finding is
      // evidence that it already happened once.
      const impact = String(a.overall_risk || "").toLowerCase() === "high" ? 4 : 3;
      const { rows: created } = await client.query(
        `INSERT INTO risks (project_id, title, description, category, probability, impact, created_by)
         VALUES ($1,$2,$3,$4,3,$5,$6) RETURNING id`,
        [project[0].id,
         String(a.finding || a.action || "Inspection finding").slice(0, 300),
         `${a.action || ""}\n\nRaised by IT inspection of ${siteCode}` +
         `${a.inspection_date ? ` on ${String(a.inspection_date).slice(0, 10)}` : ""}` +
         `${a.owner ? `, owner ${a.owner}` : ""}. Source: ${ref}. Overall inspection risk: ${a.overall_risk || "not stated"}.`,
         /security|access|badge|password|firewall/i.test(String(a.finding || "")) ? "SECURITY" : "OPERATIONAL",
         impact, actor.id]);
      await audit.recordCreate(client, "risk", created[0].id, actor.id);
      result.risks++;
    }
  });

  result.explanation =
    `${result.risks} inspection finding(s) raised as risks (${result.skipped} already present, ` +
    `${result.no_project} had no active project at their site to attach to).`;
  return result;
}

// ===== Control 4: one action list =====
async function importActions(actor, { dryRun = false } = {}) {
  if (actor.role !== "ADMIN" && actor.role !== "DIVISION_LEAD") {
    throw forbidden("Only Admins and Division Leads import external actions");
  }
  const haveMd = await sdpHas("md_actions");
  const haveInsp = await sdpHas("insp_actions");
  if (!haveMd && !haveInsp) return blocked("md_actions / insp_actions");

  const result = { ok: true, dryRun, meeting_actions: 0, inspection_actions: 0, skipped: 0, unowned: 0 };

  await pool.withTransaction(async (client) => {
    const resolveOwner = async (name) => {
      if (!name) return null;
      const norm = String(name).trim().replace(/\s+/g, " ").toUpperCase();
      const { rows } = await client.query(
        `SELECT p.user_id FROM emid.person_alias a
           JOIN emid.person p ON p.person_id = a.person_id AND p.deleted_at IS NULL
          WHERE a.alias_norm = $1 AND a.person_id IS NOT NULL AND p.user_id IS NOT NULL LIMIT 1`, [norm]);
      return rows[0]?.user_id || null;
    };
    const { rows: fallback } = await client.query(
      `SELECT id FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL AND active ORDER BY id LIMIT 1`);
    const fallbackOwner = fallback[0]?.id;

    const sets = [];
    if (haveMd) {
      const { rows } = await pool.query(
        `SELECT action_id AS id, action AS title, owner, due_date, status, site_code
           FROM sdp_fdw.md_actions
          WHERE lower(coalesce(status,'')) NOT IN ('closed','done','completed')`);
      sets.push({ rows, source: "DEPT_MEETING", prefix: "md_actions" });
    }
    if (haveInsp) {
      const { rows } = await pool.query(
        `SELECT action_id AS id, action AS title, owner, due_date, status, site_code
           FROM sdp_fdw.insp_actions
          WHERE lower(coalesce(status,'')) NOT IN ('closed','done','completed')`);
      sets.push({ rows, source: "INSPECTION", prefix: "insp_actions" });
    }

    for (const set of sets) {
      for (const a of set.rows) {
        const ref = `${set.prefix}:${a.id}`;
        const { rows: seen } = await client.query(
          `SELECT id FROM actions WHERE title LIKE $1 AND deleted_at IS NULL LIMIT 1`, [`%[${ref}]%`]);
        if (seen.length) { result.skipped++; continue; }

        const owner = await resolveOwner(a.owner);
        if (!owner) result.unowned++;
        if (dryRun) {
          if (set.source === "INSPECTION") result.inspection_actions++; else result.meeting_actions++;
          continue;
        }
        const { rows: created } = await client.query(
          `INSERT INTO actions (title, owner_user_id, due_date, source, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [`${String(a.title || "Action").slice(0, 260)} [${ref}]`,
           owner || fallbackOwner, a.due_date || null, set.source, actor.id]);
        await audit.recordCreate(client, "action", created[0].id, actor.id);
        if (set.source === "INSPECTION") result.inspection_actions++; else result.meeting_actions++;
      }
    }
  });

  result.imported = result.meeting_actions + result.inspection_actions;
  result.explanation =
    `${result.imported} action(s) imported into My Actions ` +
    `(${result.meeting_actions} from department meetings, ${result.inspection_actions} from inspections, ` +
    `${result.skipped} already present). ${result.unowned} could not be matched to a person and went to an Admin.`;
  return result;
}

// ===== Control 5: ticket-based benefit measurement =====
//
// A project claiming "fewer printer incidents at Houndé" can be measured: count
// the matching tickets before and after, over an agreed window. Four years of
// history is available.
async function measureTicketBenefit(user, { siteCode, category, beforeFrom, beforeTo, afterFrom, afterTo }) {
  if (!(await sdpHas("request_records"))) return blocked("request_records");
  const { rows } = await pool.query(
    `WITH windows AS (
       SELECT 'BEFORE' AS window, $3::date AS from_date, $4::date AS to_date
       UNION ALL SELECT 'AFTER', $5::date, $6::date)
     SELECT w.window, w.from_date, w.to_date, count(r.request_id)::int AS tickets
       FROM windows w
       LEFT JOIN sdp_fdw.request_records r
         ON r.created_time::date BETWEEN w.from_date AND w.to_date
        AND ($2::text IS NULL OR r.category = $2)
        AND ($1::text IS NULL OR EXISTS (
              SELECT 1 FROM emid.site_alias sa
               WHERE sa.system = 'SDP_TECH_GROUP' AND sa.alias = r.tech_group AND sa.code = $1))
      GROUP BY 1,2,3`,
    [siteCode || null, category || null, beforeFrom, beforeTo, afterFrom, afterTo]);

  const before = rows.find((r) => r.window === "BEFORE");
  const after = rows.find((r) => r.window === "AFTER");
  const b = before?.tickets ?? 0, a = after?.tickets ?? 0;
  // Normalise per day, because the two windows are rarely the same length.
  const days = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const bRate = b / days(beforeFrom, beforeTo);
  const aRate = a / days(afterFrom, afterTo);
  const change = bRate ? Number((((aRate - bRate) / bRate) * 100).toFixed(1)) : null;

  return {
    ok: true, site_code: siteCode || "all", category: category || "all",
    before: { ...before, per_day: Number(bRate.toFixed(2)) },
    after: { ...after, per_day: Number(aRate.toFixed(2)) },
    change_pct: change,
    control: "TICKET_BASED_BENEFIT",
    explanation: change == null
      ? "No tickets in the baseline window — a rate change cannot be computed."
      : `${bRate.toFixed(2)} tickets/day before, ${aRate.toFixed(2)} after — ` +
        `${change < 0 ? `${Math.abs(change)}% reduction` : `${change}% increase`}. ` +
        "Ticket counts are unarguable; attributing the change to this project is a human judgement.",
  };
}

module.exports = {
  goLiveWithoutChange, trackerProjectInitiatives, importInspectionFindings,
  importActions, measureTicketBenefit,
};
