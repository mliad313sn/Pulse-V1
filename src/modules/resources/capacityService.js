"use strict";
// SPM Phase 3 — capacity intelligence service: the skills catalogue, forward
// capacity forecasting, skill-gap analysis, and role-based resource requests
// with an approval step and automated matching.
//
// Visibility rules reused from the rest of the platform: a site-restricted
// account (enterprise_access = false) only ever sees people at its own site,
// and project-linked reads go through loadProjectAccess so a confidential
// project cannot be discovered through the resource surface.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const notifications = require("../notifications/service");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { loadProjectAccess } = require("../../middleware/authz");
const capacity = require("./capacity");

const isAdminOrLead = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD";

// ===== skills catalogue =====

async function listSkills() {
  const { rows } = await query(
    `SELECT s.id, s.name, s.category,
            (SELECT count(*)::int FROM user_skills us JOIN users u ON u.id = us.user_id
              WHERE us.skill_id = s.id AND u.deleted_at IS NULL AND u.active) AS people
       FROM skills s WHERE s.deleted_at IS NULL ORDER BY s.category NULLS LAST, s.name`);
  return rows;
}

async function createSkill(actor, input) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin curates the skills catalogue");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO skills (name, category, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [input.name.trim(), input.category || null, actor.id]);
    await audit.recordCreate(client, "skill", rows[0].id, actor.id);
    return rows[0];
  });
}

// A person's own skills are self-service; changing someone else's needs
// Admin/Division Lead authority.
async function setUserSkill(actor, userId, input) {
  if (userId !== actor.id && !isAdminOrLead(actor)) {
    throw forbidden("Only Admins and Division Leads maintain other people's skills");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO user_skills (user_id, skill_id, proficiency, years_experience, certified,
         certification_name, certification_expires, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, skill_id) DO UPDATE SET
         proficiency = EXCLUDED.proficiency, years_experience = EXCLUDED.years_experience,
         certified = EXCLUDED.certified, certification_name = EXCLUDED.certification_name,
         certification_expires = EXCLUDED.certification_expires, updated_at = now()
       RETURNING *`,
      [userId, input.skill_id, input.proficiency, input.years_experience ?? null,
       input.certified === true, input.certification_name || null,
       input.certification_expires || null, actor.id]);
    await audit.record(client, {
      entity: "user_skill", entityId: userId, userId: actor.id,
      changes: [{ field: `skill:${input.skill_id}`, old: null, new: `proficiency ${input.proficiency}` }],
    });
    return rows[0];
  });
}

async function userSkills(userId) {
  const { rows } = await query(
    `SELECT us.*, s.name AS skill_name, s.category
       FROM user_skills us JOIN skills s ON s.id = us.skill_id
      WHERE us.user_id = $1 AND s.deleted_at IS NULL ORDER BY s.name`, [userId]);
  return rows.map((r) => ({
    ...r,
    certification_expired: Boolean(r.certification_expires) &&
      new Date(r.certification_expires) < new Date(new Date().toISOString().slice(0, 10)),
  }));
}

// ===== capacity forecasting =====

function peopleScope(user, params) {
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1);
    return `u.site_id = $${params.length}`;
  }
  return "TRUE";
}

// Load every allocation that can touch the forecast window, in one query.
async function loadAllocations(userIds, from, to) {
  if (!userIds.length) return new Map();
  const { rows } = await query(
    `SELECT ra.id, ra.user_id, ra.start_date, ra.end_date, ra.percent, ra.role,
            ra.allocation_type, ra.commitment, p.code AS project_code, p.title AS project_title
       FROM resource_allocations ra
       LEFT JOIN projects p ON p.id = ra.project_id AND p.deleted_at IS NULL
      WHERE ra.deleted_at IS NULL AND ra.user_id = ANY($1::bigint[])
        AND ra.start_date <= $3::date AND ra.end_date >= $2::date
        AND (ra.project_id IS NULL OR (p.id IS NOT NULL AND p.stage <> 'CLOSED'
             AND p.operating_status NOT IN ('CANCELLED')))`,
    [userIds, from, to]);
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  return byUser;
}

// Forward capacity for everyone the caller may see.
async function capacityForecast(user, { from, periods = 6, grain = "month", overloadedOnly = false } = {}) {
  const start = from || new Date().toISOString().slice(0, 10);
  const bs = capacity.buckets(start, periods, grain);
  const windowStart = bs[0].start;
  const windowEnd = bs[bs.length - 1].end;

  const params = [];
  const scope = peopleScope(user, params);
  const { rows: people } = await query(
    `SELECT u.id, u.name, u.role, u.site_id, s.code AS site_code, d.code AS division_code
       FROM users u LEFT JOIN sites s ON s.id = u.site_id LEFT JOIN divisions d ON d.id = u.division_id
      WHERE u.deleted_at IS NULL AND u.active AND u.role <> 'VIEWER' AND ${scope}
      ORDER BY u.name`, params);

  const allocations = await loadAllocations(people.map((p) => p.id), windowStart, windowEnd);
  const rows = people.map((p) => ({
    user_id: p.id, name: p.name, role: p.role, site_code: p.site_code, division_code: p.division_code,
    periods: capacity.forecast(allocations.get(p.id) || [], { from: start, periods, grain }),
  }));
  const decorated = rows.map((r) => ({
    ...r,
    any_over_allocated: r.periods.some((x) => x.over_allocated),
    any_at_risk: r.periods.some((x) => x.at_risk),
  }));
  return {
    window: { from: windowStart, to: windowEnd, grain, periods: bs.map((b) => b.key) },
    rows: overloadedOnly ? decorated.filter((r) => r.any_over_allocated) : decorated,
  };
}

// ===== skill gap =====

// Where does demand for a skill exceed the people who actually have it?
async function skillGap(user) {
  const params = [];
  const scope = peopleScope(user, params);
  const { rows } = await query(
    `SELECT s.id AS skill_id, s.name AS skill_name,
            (SELECT count(*)::int FROM user_skills us JOIN users u ON u.id = us.user_id
              WHERE us.skill_id = s.id AND u.deleted_at IS NULL AND u.active AND ${scope}) AS people_with_skill,
            (SELECT count(*)::int FROM user_skills us JOIN users u ON u.id = us.user_id
              WHERE us.skill_id = s.id AND us.proficiency >= 4 AND u.deleted_at IS NULL AND u.active AND ${scope}) AS experts,
            (SELECT count(*)::int FROM resource_requests rr
              WHERE rr.skill_id = s.id AND rr.deleted_at IS NULL AND rr.status IN ('PENDING','APPROVED')) AS open_requests
       FROM skills s WHERE s.deleted_at IS NULL ORDER BY s.name`, params);
  return rows.map((r) => ({
    ...r,
    gap: r.open_requests - r.people_with_skill,
    severity: r.people_with_skill === 0 && r.open_requests > 0 ? "CRITICAL"
      : r.open_requests > r.people_with_skill ? "HIGH"
        : r.experts === 0 && r.people_with_skill > 0 ? "SINGLE_LEVEL" : "OK",
    explanation: r.people_with_skill === 0 && r.open_requests > 0
      ? `${r.open_requests} open request(s) and nobody recorded with this skill`
      : r.open_requests > r.people_with_skill
        ? `${r.open_requests} open request(s) against ${r.people_with_skill} person(s) with the skill`
        : r.experts === 0 && r.people_with_skill > 0
          ? `${r.people_with_skill} person(s) have it but nobody at proficiency 4+`
          : `${r.people_with_skill} person(s) available, ${r.open_requests} open request(s)`,
  }));
}

// ===== role-based resource requests =====

async function createRequest(actor, projectAccess, input) {
  if (projectAccess.access !== "FULL") throw forbidden("Full project rights required to request resources");
  if (input.end_date < input.start_date) throw badRequest("end_date cannot precede start_date");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO resource_requests (project_id, role, skill_id, min_proficiency, percent,
         start_date, end_date, site_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [projectAccess.project.id, input.role, input.skill_id || null, input.min_proficiency || null,
       input.percent, input.start_date, input.end_date, input.site_id || null,
       input.notes || null, actor.id]);
    await audit.recordCreate(client, "resource_request", rows[0].id, actor.id);
    const { rows: leads } = await client.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND active = true
        AND (role = 'ADMIN' OR (role = 'DIVISION_LEAD' AND division_id = $1))`,
      [projectAccess.project.lead_division_id]);
    for (const l of leads) {
      await notifications.create(client, {
        userId: l.id, type: "CHANGE_REQUEST", entity: "resource_request", entityId: rows[0].id,
        text: `Resource request awaiting approval: ${input.role} ${input.percent}% on ${projectAccess.project.code}`,
        createdBy: actor.id,
      });
    }
    return rows[0];
  });
}

async function listRequests(user, { projectId, status } = {}) {
  const params = [];
  const where = ["rr.deleted_at IS NULL"];
  if (projectId) { params.push(projectId); where.push(`rr.project_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`rr.status = $${params.length}`); }
  const { rows } = await query(
    `SELECT rr.*, p.code AS project_code, p.title AS project_title, s.name AS skill_name,
            si.code AS site_code, u.name AS fulfilled_user_name
       FROM resource_requests rr
       JOIN projects p ON p.id = rr.project_id
       LEFT JOIN skills s ON s.id = rr.skill_id
       LEFT JOIN sites si ON si.id = rr.site_id
       LEFT JOIN users u ON u.id = rr.fulfilled_user_id
      WHERE ${where.join(" AND ")} ORDER BY rr.created_at DESC LIMIT 200`, params);
  // concealment: drop requests on projects the caller cannot see
  const visible = [];
  for (const r of rows) {
    try { await loadProjectAccess(r.project_id, user); visible.push(r); } catch { /* concealed */ }
  }
  return visible;
}

async function loadRequest(user, id) {
  const { rows } = await query(`SELECT * FROM resource_requests WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows.length) throw notFound("Resource request not found");
  await loadProjectAccess(rows[0].project_id, user); // 404s if concealed
  return rows[0];
}

async function decideRequest(actor, id, decision, note, expectedUpdatedAt) {
  if (!isAdminOrLead(actor)) throw forbidden("Only Division Leads or Admin approve resource requests");
  if (!["APPROVED", "REJECTED"].includes(decision)) throw badRequest("Decision must be APPROVED or REJECTED");
  if (!note || note.trim().length < 5) throw badRequest("A decision note is required");
  const before = await loadRequest(actor, id);
  if (before.status !== "PENDING") throw badRequest(`Already decided: ${before.status}`);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE resource_requests SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, updated_at=now()
        WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)
        RETURNING *`,
      [id, expectedUpdatedAt, decision, actor.id, note]);
    if (!rows.length) throw conflict("This request changed since you loaded it — review and retry", { current: before });
    await audit.record(client, {
      entity: "resource_request", entityId: id, userId: actor.id,
      changes: [{ field: "status", old: "PENDING", new: decision }],
    });
    return rows[0];
  });
}

// Automated matching: who could fill this request, ranked and explained.
async function matchCandidates(user, requestId) {
  const req = await loadRequest(user, requestId);
  const params = [];
  const scope = peopleScope(user, params);
  params.push(req.skill_id || 0);
  const { rows: people } = await query(
    `SELECT u.id AS user_id, u.name, u.role, u.site_id, s.code AS site_code,
            us.proficiency, us.certified, us.certification_expires
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN user_skills us ON us.user_id = u.id AND us.skill_id = $${params.length}
      WHERE u.deleted_at IS NULL AND u.active AND u.role <> 'VIEWER' AND ${scope}`, params);

  const allocations = await loadAllocations(people.map((p) => p.user_id), req.start_date, req.end_date);
  const window = { key: "request", label: "Request window",
    start: String(req.start_date).slice(0, 10), end: String(req.end_date).slice(0, 10) };
  const withAvailability = people.map((p) => {
    const load = capacity.loadForPeriod(allocations.get(p.user_id) || [], window);
    return { ...p, available_percent: load.available_percent, used_percent: load.used_percent };
  });

  const { rows: skillRow } = req.skill_id
    ? await query(`SELECT name FROM skills WHERE id = $1`, [req.skill_id]) : { rows: [] };
  const ranked = capacity.rankCandidates(withAvailability, {
    percent: req.percent, skill_id: req.skill_id, min_proficiency: req.min_proficiency,
    site_id: req.site_id, skill_name: skillRow[0]?.name,
  });
  return { request: req, candidates: ranked.slice(0, 20) };
}

// Fulfilment: an APPROVED request becomes a real named allocation.
async function fulfilRequest(actor, id, userId) {
  if (!isAdminOrLead(actor)) throw forbidden("Only Division Leads or Admin assign people to a request");
  const req = await loadRequest(actor, id);
  if (req.status !== "APPROVED") throw badRequest(`Only APPROVED requests can be filled (currently ${req.status})`);
  return withTransaction(async (client) => {
    const { rows: alloc } = await client.query(
      `INSERT INTO resource_allocations (project_id, user_id, start_date, end_date, percent, role,
         allocation_type, commitment, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'PROJECT','COMMITTED',$7) RETURNING *`,
      [req.project_id, userId, req.start_date, req.end_date, req.percent, req.role, actor.id]);
    await audit.recordCreate(client, "resource_allocation", alloc[0].id, actor.id);
    const { rows } = await client.query(
      `UPDATE resource_requests SET status='FILLED', fulfilled_user_id=$2, allocation_id=$3, updated_at=now()
        WHERE id=$1 RETURNING *`, [id, userId, alloc[0].id]);
    await audit.record(client, {
      entity: "resource_request", entityId: id, userId: actor.id,
      changes: [{ field: "status", old: "APPROVED", new: "FILLED" }],
    });
    await notifications.create(client, {
      userId, type: "PM_ASSIGNED", entity: "resource_request", entityId: id,
      text: `You have been assigned as ${req.role} (${req.percent}%) from ${String(req.start_date).slice(0, 10)}`,
      createdBy: actor.id,
    });
    return { request: rows[0], allocation: alloc[0] };
  });
}

module.exports = {
  listSkills, createSkill, setUserSkill, userSkills,
  capacityForecast, skillGap,
  createRequest, listRequests, decideRequest, matchCandidates, fulfilRequest,
};
