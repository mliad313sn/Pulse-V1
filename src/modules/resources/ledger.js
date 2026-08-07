"use strict";
// PULSE ↔ SDP, PHASE 1 — the capacity ledger.
//
//   available hours
//     − helpdesk load      (imported from SDP, MEASURED or MODELLED)
//     − routine BAU load   (tracker activities)
//     − project commitment (PULSE resource_allocations)
//     = headroom
//
// Three long-standing defects are fixed here:
//   D1  there was no denominator at all — workload() divided by a hard-coded 100
//   D2  `HAVING sum(percent) > 0` hid everyone with no project allocation,
//       which is precisely the ticket-saturated site agents this exists to find
//   D3  the answer was point-in-time, so "can Sabodala absorb this in October?"
//       could not be asked
//
// Every figure carries its provenance, and every overloaded person carries a
// sentence explaining the arithmetic rather than just a red cell.
const { query } = require("../../db/pool");

const MONTHS_BACK = 12;
const MONTHS_FORWARD = 12;

const periodOf = (d) => d.toISOString().slice(0, 7);

function monthGrid(from, months) {
  const start = new Date(`${from}-01T00:00:00Z`);
  const out = [];
  for (let i = 0; i < months; i++) {
    out.push(periodOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  }
  return out;
}

function defaultWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_BACK, 1));
  return { from: periodOf(start), months: MONTHS_BACK + MONTHS_FORWARD + 1 };
}

// Only people the caller may see: a site-restricted account never learns about
// other sites' staffing through the capacity screen.
function peopleScope(user, params) {
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1);
    return `u.site_id = $${params.length}`;
  }
  return "TRUE";
}

// The heart of it. Returns one row per person per month, always — including
// people with no project work, no capacity row, or no tickets (defect D2).
async function capacityLedger(user, { from, months, siteCode, overloadedOnly = false } = {}) {
  const win = from ? { from, months: months || 6 } : defaultWindow();
  const periods = monthGrid(win.from, win.months);
  const firstDay = `${periods[0]}-01`;
  const lastPeriod = periods[periods.length - 1];

  const params = [];
  const scope = peopleScope(user, params);
  let siteClause = "TRUE";
  if (siteCode) { params.push(siteCode); siteClause = `s.code = $${params.length}`; }

  const { rows: people } = await query(
    `SELECT u.id AS user_id, u.name, u.role, u.site_id, s.code AS site_code,
            d.code AS division_code,
            p.person_id, p.employment
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN divisions d ON d.id = u.division_id
       LEFT JOIN emid.person p ON p.user_id = u.id AND p.deleted_at IS NULL
      WHERE u.deleted_at IS NULL AND u.active AND u.role <> 'VIEWER'
        AND ${scope} AND ${siteClause}
      ORDER BY u.name`, params);

  if (!people.length) {
    return { window: { from: periods[0], to: lastPeriod, periods }, rows: [], totals: emptyTotals() };
  }
  const userIds = people.map((p) => p.user_id);

  const [capRows, bauRows, allocRows] = await Promise.all([
    query(`SELECT user_id, period, fte, standard_hours, leave_hours, training_hours, available_hours
             FROM person_capacity
            WHERE deleted_at IS NULL AND user_id = ANY($1::bigint[]) AND period = ANY($2::text[])`,
    [userIds, periods]),
    query(`SELECT user_id, period, source, tickets, hours, provenance, imported_at
             FROM bau_load
            WHERE user_id = ANY($1::bigint[]) AND period = ANY($2::text[])`, [userIds, periods]),
    // Project commitment expanded onto the month grid: a booking that overlaps
    // a month at all contributes, weighted by the share of the month it covers.
    query(
      `SELECT ra.user_id, m.period, ra.percent, ra.commitment, ra.allocation_type,
              p.code AS project_code, p.title AS project_title,
              GREATEST(ra.start_date, m.first_day) AS ov_start,
              LEAST(ra.end_date, m.last_day)       AS ov_end,
              (m.last_day - m.first_day + 1)       AS month_days
         FROM resource_allocations ra
         LEFT JOIN projects p ON p.id = ra.project_id AND p.deleted_at IS NULL
         JOIN emid.calendar_month m
           ON m.period = ANY($2::text[])
          AND daterange(ra.start_date, ra.end_date, '[]') && daterange(m.first_day, m.last_day, '[]')
        WHERE ra.deleted_at IS NULL AND ra.user_id = ANY($1::bigint[])
          AND (ra.project_id IS NULL OR (p.id IS NOT NULL AND p.stage <> 'CLOSED'
               AND p.operating_status NOT IN ('CANCELLED')))`,
      [userIds, periods]),
  ]);

  const capBy = index(capRows.rows, (r) => `${r.user_id}|${r.period}`);
  const bauBy = group(bauRows.rows, (r) => `${r.user_id}|${r.period}`);
  const allocBy = group(allocRows.rows, (r) => `${r.user_id}|${r.period}`);

  let latestImport = null;
  for (const b of bauRows.rows) {
    if (!latestImport || new Date(b.imported_at) > new Date(latestImport)) latestImport = b.imported_at;
  }

  const rows = people.map((person) => {
    const cells = periods.map((period) => {
      const key = `${person.user_id}|${period}`;
      const cap = capBy.get(key);
      const bau = bauBy.get(key) || [];
      const allocs = allocBy.get(key) || [];

      const helpdesk = bau.filter((b) => b.source === "HELPDESK");
      const routine = bau.filter((b) => b.source !== "HELPDESK");
      const helpdeskHours = sum(helpdesk, "hours");
      const helpdeskTickets = helpdesk.reduce((s, b) => s + Number(b.tickets || 0), 0);
      const bauHours = sum(routine, "hours");

      // Committed project work in hours: percent × the share of the month the
      // booking actually covers × that person's available hours.
      const availableHours = cap ? Number(cap.available_hours) : null;
      let projectHours = 0, tentativeHours = 0;
      const breakdown = [];
      for (const a of allocs) {
        if (a.allocation_type === "LEAVE") continue;
        const days = Math.max(0, dayDiff(a.ov_start, a.ov_end) + 1);
        const share = a.month_days ? days / Number(a.month_days) : 0;
        const hours = availableHours == null ? null
          : Number(((Number(a.percent) / 100) * share * availableHours).toFixed(2));
        if (a.commitment === "TENTATIVE") tentativeHours += hours || 0;
        else projectHours += hours || 0;
        breakdown.push({
          project: a.project_code || a.allocation_type,
          title: a.project_title || a.allocation_type,
          percent: Number(a.percent),
          hours,
          tentative: a.commitment === "TENTATIVE",
        });
      }

      const provenance = helpdesk.length
        ? (helpdesk.every((h) => h.provenance === "MEASURED") ? "MEASURED"
          : helpdesk.some((h) => h.provenance === "MEASURED") ? "MIXED" : "MODELLED")
        : "NONE";

      const used = helpdeskHours + bauHours + projectHours;
      const headroom = availableHours == null ? null : Number((availableHours - used).toFixed(2));
      const utilisation = availableHours ? Number(((used / availableHours) * 100).toFixed(1)) : null;

      // Status is COMPUTED, never typed. No manual green/amber/red anywhere.
      const status = availableHours == null ? "NO_CAPACITY_DATA"
        : headroom < 0 ? "RED"
          : utilisation >= 90 ? "AMBER" : "GREEN";

      // How much should anyone trust this cell?
      const confidence = availableHours == null ? "LOW"
        : provenance === "MODELLED" || provenance === "NONE" ? "LOW"
          : provenance === "MIXED" ? "MEDIUM" : "HIGH";

      return {
        period,
        available_hours: availableHours,
        helpdesk_hours: round(helpdeskHours),
        helpdesk_tickets: helpdeskTickets,
        bau_hours: round(bauHours),
        project_hours: round(projectHours),
        tentative_hours: round(tentativeHours),
        used_hours: round(used),
        headroom_hours: headroom,
        utilisation_pct: utilisation,
        status,
        provenance,
        data_confidence: confidence,
        breakdown,
        explanation: explain({
          availableHours, helpdeskHours, helpdeskTickets, bauHours, projectHours,
          tentativeHours, headroom, provenance, breakdown,
        }),
      };
    });

    return {
      user_id: person.user_id, name: person.name, role: person.role,
      site_code: person.site_code, division_code: person.division_code,
      person_id: person.person_id, employment: person.employment || "STAFF",
      periods: cells,
      any_overloaded: cells.some((c) => c.status === "RED"),
      any_at_risk: cells.some((c) => c.status === "AMBER"),
      missing_capacity_months: cells.filter((c) => c.available_hours == null).map((c) => c.period),
    };
  });

  const visible = overloadedOnly ? rows.filter((r) => r.any_overloaded) : rows;
  return {
    window: { from: periods[0], to: lastPeriod, periods },
    rows: visible,
    totals: totalsFor(rows, periods),
    as_of: latestImport,
    note: latestImport
      ? `Helpdesk load imported from ServiceDesk Plus at ${new Date(latestImport).toISOString()}`
      : "No helpdesk load has been imported yet — project commitment only",
  };
}

// The PMO explanation format: the arithmetic in one sentence.
function explain({ availableHours, helpdeskHours, helpdeskTickets, bauHours, projectHours,
  tentativeHours, headroom, provenance, breakdown }) {
  if (availableHours == null) {
    return "No capacity recorded for this person this month — hours cannot be computed. Set FTE and standard hours to include them.";
  }
  const parts = [`${round(availableHours)} h available`];
  if (helpdeskHours > 0) {
    parts.push(`helpdesk ${round(helpdeskHours)} h${helpdeskTickets ? ` (${helpdeskTickets} tickets` : " ("}${
      provenance === "MODELLED" ? ", modelled" : provenance === "MEASURED" ? ", measured" : ""})`);
  }
  if (bauHours > 0) parts.push(`BAU ${round(bauHours)} h`);
  if (projectHours > 0) {
    const detail = breakdown.filter((b) => !b.tentative)
      .map((b) => `${b.project} ${b.percent}%`).join(", ");
    parts.push(`projects ${round(projectHours)} h${detail ? ` (${detail})` : ""}`);
  }
  let s = `${parts.join(" · ")} → headroom ${round(headroom)} h`;
  if (tentativeHours > 0) {
    s += ` · ${round(tentativeHours)} h of tentative work would take it to ${round(headroom - tentativeHours)} h`;
  }
  return s;
}

function totalsFor(rows, periods) {
  const byPeriod = periods.map((period) => {
    let available = 0, helpdesk = 0, bau = 0, project = 0, people = 0, overloaded = 0, noData = 0;
    for (const r of rows) {
      const c = r.periods.find((x) => x.period === period);
      if (!c) continue;
      people++;
      if (c.available_hours == null) { noData++; continue; }
      available += c.available_hours;
      helpdesk += c.helpdesk_hours;
      bau += c.bau_hours;
      project += c.project_hours;
      if (c.status === "RED") overloaded++;
    }
    const used = helpdesk + bau + project;
    return {
      period, people, overloaded, no_capacity_data: noData,
      available_hours: round(available), helpdesk_hours: round(helpdesk),
      bau_hours: round(bau), project_hours: round(project),
      headroom_hours: round(available - used),
      utilisation_pct: available ? Number(((used / available) * 100).toFixed(1)) : null,
    };
  });
  return { by_period: byPeriod };
}

const emptyTotals = () => ({ by_period: [] });
const round = (n) => (n == null ? null : Math.round(n * 10) / 10);
const sum = (rows, field) => rows.reduce((s, r) => s + Number(r[field] || 0), 0);
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
function index(rows, keyFn) { const m = new Map(); for (const r of rows) m.set(keyFn(r), r); return m; }
function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

// Unattributed load — must be visible so a site cannot game its headroom.
async function unattributed({ from, months } = {}) {
  const win = from ? { from, months: months || 6 } : defaultWindow();
  const periods = monthGrid(win.from, win.months);
  const { rows } = await query(
    `SELECT period, site_code, reason, sum(tickets)::int AS tickets, max(imported_at) AS imported_at
       FROM bau_unattributed WHERE period = ANY($1::text[])
      GROUP BY 1,2,3 ORDER BY tickets DESC`, [periods]);
  const total = rows.reduce((s, r) => s + r.tickets, 0);
  const { rows: att } = await query(
    `SELECT coalesce(sum(tickets),0)::int AS n FROM bau_load
      WHERE source = 'HELPDESK' AND period = ANY($1::text[])`, [periods]);
  const attributed = att[0].n;
  const denom = attributed + total;
  return {
    rows, total_unattributed: total, total_attributed: attributed,
    unattributed_pct: denom ? Number(((total / denom) * 100).toFixed(1)) : 0,
    gate1_pass: denom ? (total / denom) < 0.05 : true,
    explanation: denom
      ? `${total} of ${denom} tickets (${((total / denom) * 100).toFixed(1)}%) could not be attributed to a person. Gate 1 requires under 5%.`
      : "No helpdesk load imported yet.",
  };
}

module.exports = { capacityLedger, unattributed, monthGrid, explain };
