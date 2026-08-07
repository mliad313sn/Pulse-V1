"use strict";
// PULSE ↔ SDP, PHASE 1 — the HR facts behind capacity, and the effort standards.
//
// person_capacity holds hours, not opinions: FTE, contracted hours, leave and
// training. Column names are deliberately HR-shaped so a 4MyPeople feed can
// populate them later without a schema change.
//
// effort_standard is a MANAGEMENT decision with a named owner and a written
// rationale. It is never derived from ticket data — lead time is not effort,
// and a model built from it produces indefensible utilisation figures.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, forbidden, notFound } = require("../../middleware/errors");

const isAdminOrLead = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD";

async function listCapacity(user, { period } = {}) {
  const params = [];
  let scope = "TRUE";
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1);
    scope = `u.site_id = $${params.length}`;
  }
  let periodClause = "TRUE";
  if (period) { params.push(period); periodClause = `c.period = $${params.length}`; }
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name, s.code AS site_code, c.id, c.period, c.fte,
            c.standard_hours, c.leave_hours, c.training_hours, c.available_hours,
            c.note, c.updated_at
       FROM users u
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN person_capacity c
         ON c.user_id = u.id AND c.deleted_at IS NULL AND ${periodClause}
      WHERE u.deleted_at IS NULL AND u.active AND u.role <> 'VIEWER' AND ${scope}
      ORDER BY u.name, c.period`, params);
  return rows;
}

// A person's own capacity is theirs to correct; changing someone else's needs
// Admin or Division Lead authority.
async function setCapacity(actor, input) {
  if (input.user_id !== actor.id && !isAdminOrLead(actor)) {
    throw forbidden("Only Admins and Division Leads set another person's capacity");
  }
  const leave = input.leave_hours ?? 0;
  const training = input.training_hours ?? 0;
  const fte = input.fte ?? 1;
  const standard = input.standard_hours ?? 173;
  if (leave + training > fte * standard) {
    throw badRequest(
      `Leave (${leave} h) plus training (${training} h) exceeds this person's ${fte * standard} contracted hours — ` +
      "check the figures, because available hours would be negative");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO person_capacity (user_id, period, fte, standard_hours, leave_hours, training_hours, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, period) DO UPDATE SET
         fte = EXCLUDED.fte, standard_hours = EXCLUDED.standard_hours,
         leave_hours = EXCLUDED.leave_hours, training_hours = EXCLUDED.training_hours,
         note = EXCLUDED.note, deleted_at = NULL, updated_at = now()
       RETURNING *`,
      [input.user_id, input.period, fte, standard, leave, training, input.note || null, actor.id]);
    await audit.record(client, {
      entity: "person_capacity", entityId: rows[0].id, userId: actor.id,
      changes: [{ field: `${input.period}`, old: null,
        new: `${rows[0].available_hours} h available (fte ${fte}, leave ${leave} h, training ${training} h)` }],
    });
    return rows[0];
  });
}

// Give every active person a row for the requested months. Without this, people
// are invisible in the ledger — which is exactly the defect this programme
// exists to fix, so the default must be "present with standard hours".
async function seedDefaults(actor, periods, standardHours) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin seeds capacity defaults");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO person_capacity (user_id, period, standard_hours, note, created_by)
       SELECT u.id, p.period, $2, 'Seeded default — confirm FTE and leave with HR', $3
         FROM users u CROSS JOIN unnest($1::text[]) AS p(period)
        WHERE u.deleted_at IS NULL AND u.active AND u.role <> 'VIEWER'
       ON CONFLICT (user_id, period) DO NOTHING
       RETURNING id`,
      [periods, standardHours || 173, actor.id]);
    await audit.record(client, {
      entity: "person_capacity", entityId: 0, userId: actor.id,
      changes: [{ field: "seed", old: null, new: `${rows.length} capacity row(s) across ${periods.length} period(s)` }],
    });
    return { created: rows.length, periods };
  });
}

async function listEffortStandards() {
  const { rows } = await query(
    `SELECT e.*, u.name AS set_by_name FROM effort_standard e
       LEFT JOIN users u ON u.id = e.set_by
      ORDER BY e.request_type, e.category, e.valid_from DESC`);
  return rows.map((r) => ({
    ...r,
    current: r.valid_to === null,
    placeholder: /Placeholder pending/.test(r.rationale || ""),
  }));
}

// A new standard closes the previous one rather than overwriting it, so the
// hours used for any past month remain reproducible.
async function setEffortStandard(actor, input) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin sets effort standards");
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE effort_standard SET valid_to = $3
        WHERE request_type = $1 AND category = $2 AND valid_to IS NULL AND valid_from < $3::date`,
      [input.request_type, input.category, input.valid_from]);
    const { rows } = await client.query(
      `INSERT INTO effort_standard (request_type, category, minutes, valid_from, rationale, set_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.request_type, input.category, input.minutes, input.valid_from,
       input.rationale, actor.id]);
    await audit.record(client, {
      entity: "effort_standard", entityId: rows[0].id, userId: actor.id,
      changes: [{ field: `${input.request_type}/${input.category}`, old: null,
        new: `${input.minutes} minutes from ${input.valid_from}` }],
    });
    return rows[0];
  });
}

module.exports = { listCapacity, setCapacity, seedDefaults, listEffortStandards, setEffortStandard };
