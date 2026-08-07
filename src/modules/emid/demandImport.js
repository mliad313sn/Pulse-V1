"use strict";
// PULSE ↔ SDP, PHASE 2 — the demand funnel.
//
// Business demand captured in department meetings currently dies in a table:
// 21 business projects and 141 issues (65 open) with no owner, no score and no
// route into the portfolio. This imports them into the PULSE demand funnel.
//
// Three rules:
//   * Everything lands as DRAFT. Nothing is ever auto-approved — the scoring
//     and the decision are the whole point of a funnel.
//   * Scoring inputs stay EMPTY. An imported guess would look like a judgement
//     that nobody made.
//   * Idempotent on (source, source_ref), so re-running never duplicates.
const pool = require("../../db/pool");
const audit = require("../../middleware/audit");
const { forbidden } = require("../../middleware/errors");

// Meeting phase → the PULSE stage the work would enter at.
const PHASE_TO_STAGE = {
  scoping: "IDEA",
  design: "INITIATION",
  build: "PLANNING",
  deploy: "EXECUTION",
};

async function sdpAvailable() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'sdp_fdw' AND table_name = 'md_meeting_projects'`);
  return rows[0].n > 0;
}

// Resolve a free-text name to a PULSE user through the identity spine.
// Unresolved is normal and fine — the demand still lands, flagged for an owner.
async function resolvePerson(client, name) {
  if (!name || !String(name).trim()) return null;
  const norm = String(name).trim().replace(/\s+/g, " ").toUpperCase();
  const { rows } = await client.query(
    `SELECT p.user_id FROM emid.person_alias a
       JOIN emid.person p ON p.person_id = a.person_id AND p.deleted_at IS NULL
      WHERE a.alias_norm = $1 AND a.person_id IS NOT NULL AND p.user_id IS NOT NULL
      LIMIT 1`, [norm]);
  return rows[0]?.user_id || null;
}

async function resolveSite(client, siteCode) {
  if (!siteCode) return null;
  const { rows } = await client.query(
    `SELECT s.id FROM emid.site_alias sa
       JOIN public.sites s ON s.code = sa.code AND s.deleted_at IS NULL
      WHERE sa.system = 'MEETINGS' AND sa.alias = $1 LIMIT 1`, [siteCode]);
  return rows[0]?.id || null;
}

async function resolveDivision(client) {
  const { rows } = await client.query(
    `SELECT id FROM divisions WHERE code = 'BAP' AND deleted_at IS NULL LIMIT 1`);
  return rows[0]?.id || null;
}

async function importMeetingDemand(actor, { dryRun = false } = {}) {
  if (actor.role !== "ADMIN" && actor.role !== "DIVISION_LEAD") {
    throw forbidden("Only Admins and Division Leads import business demand");
  }
  if (!(await sdpAvailable())) {
    return {
      ok: false, code: "BLOCKED_EXTERNAL",
      reason: "sdp_fdw.md_meeting_projects is not present — connect the SDP source to import department-meeting demand",
      imported: 0, skipped: 0,
    };
  }

  const { rows: projects } = await pool.query(
    `SELECT mp.*, m.site_code AS meeting_site, m.meeting_date
       FROM sdp_fdw.md_meeting_projects mp
       LEFT JOIN sdp_fdw.md_meetings m ON m.meeting_id = mp.meeting_id
      ORDER BY mp.meeting_id, mp.ord`);

  const { rows: issues } = await pool.query(
    `SELECT i.*, m.site_code AS meeting_site
       FROM sdp_fdw.md_issues i
       LEFT JOIN sdp_fdw.md_meetings m ON m.meeting_id = i.meeting_id
      WHERE lower(coalesce(i.status,'')) NOT IN ('closed','resolved','done')`);

  const result = { ok: true, dryRun, projects: 0, issues: 0, skipped: 0, unowned: 0, items: [] };

  await pool.withTransaction(async (client) => {
    const divisionId = await resolveDivision(client);

    for (const p of projects) {
      const ref = `md_meeting_projects:${p.meeting_id}:${p.ord}`;
      const { rows: seen } = await client.query(
        `SELECT id FROM demands WHERE source = 'DEPT_MEETING' AND source_ref = $1 AND deleted_at IS NULL`, [ref]);
      if (seen.length) { result.skipped++; continue; }

      const requesterId = await resolvePerson(client, p.it_lead);
      if (!requesterId) result.unowned++;
      const siteId = await resolveSite(client, p.meeting_site || p.site_code);

      const problem = [
        p.description,
        p.business_sponsor ? `Business sponsor: ${p.business_sponsor}.` : null,
        p.it_involvement ? `IT involvement: ${p.it_involvement}.` : null,
        p.phase ? `Phase at capture: ${p.phase} (suggested entry stage ${PHASE_TO_STAGE[String(p.phase).toLowerCase()] || "IDEA"}).` : null,
        p.target_end ? `Business target end: ${String(p.target_end).slice(0, 10)}.` : null,
        `Captured in the ${p.meeting_site || "department"} meeting${p.meeting_date ? ` of ${String(p.meeting_date).slice(0, 10)}` : ""}.`,
      ].filter(Boolean).join(" ");

      result.items.push({ type: "project", ref, title: p.project_name, owner_resolved: Boolean(requesterId) });
      if (dryRun) { result.projects++; continue; }

      // Scoring inputs are deliberately left NULL — a human scores it.
      const { rows: created } = await client.query(
        `INSERT INTO demands (title, problem, requester_id, division_id, site_id,
           status, source, source_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,'DRAFT','DEPT_MEETING',$6,$7) RETURNING id`,
        [String(p.project_name || "Untitled business project").slice(0, 300),
         problem, requesterId, divisionId, siteId, ref, actor.id]);
      await audit.recordCreate(client, "demand", created[0].id, actor.id);
      result.projects++;
    }

    for (const i of issues) {
      const ref = `md_issues:${i.issue_id}`;
      const { rows: seen } = await client.query(
        `SELECT id FROM demands WHERE source = 'DEPT_MEETING' AND source_ref = $1 AND deleted_at IS NULL`, [ref]);
      if (seen.length) { result.skipped++; continue; }

      const requesterId = await resolvePerson(client, i.raised_by);
      if (!requesterId) result.unowned++;
      const siteId = await resolveSite(client, i.meeting_site || i.site_code);

      result.items.push({ type: "issue", ref, title: i.title, owner_resolved: Boolean(requesterId) });
      if (dryRun) { result.issues++; continue; }

      const { rows: created } = await client.query(
        `INSERT INTO demands (title, problem, requester_id, division_id, site_id,
           status, source, source_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,'DRAFT','DEPT_MEETING',$6,$7) RETURNING id`,
        [String(i.title || "Untitled issue").slice(0, 300),
         [i.description, i.raised_by ? `Raised by ${i.raised_by}` : null,
          i.raised_date ? `on ${String(i.raised_date).slice(0, 10)}` : null,
          "Imported from a department meeting issue log — still open at import."]
           .filter(Boolean).join(" "),
         requesterId, divisionId, siteId, ref, actor.id]);
      await audit.recordCreate(client, "demand", created[0].id, actor.id);
      result.issues++;
    }

    if (!dryRun) {
      await audit.record(client, {
        entity: "demand", entityId: 0, userId: actor.id,
        changes: [{ field: "import", old: null,
          new: `${result.projects} business project(s) and ${result.issues} open issue(s) from department meetings` }],
      });
    }
  });

  result.imported = result.projects + result.issues;
  result.explanation =
    `${result.imported} item(s) imported as DRAFT demands (${result.skipped} already present). ` +
    (result.unowned ? `${result.unowned} could not be matched to a PULSE user and need an owner assigned. ` : "") +
    "Nothing was scored or approved — that is deliberate.";
  return result;
}

module.exports = { importMeetingDemand, sdpAvailable, PHASE_TO_STAGE };
