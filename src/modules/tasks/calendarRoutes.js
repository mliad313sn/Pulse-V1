"use strict";
// SPM Phase 2 — working calendars: Admin-curated reference data (a calendar
// silently changing under live plans would move everyone's dates), readable by
// anyone who needs to understand a schedule.
const express = require("express");
const { z } = require("zod");
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { requireAuth, requireRole } = require("../../middleware/authz");
const { notFound, badRequest } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get("/calendars", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, (SELECT count(*)::int FROM calendar_exceptions e WHERE e.calendar_id = c.id) AS exception_count,
              (SELECT count(*)::int FROM projects p WHERE p.calendar_id = c.id AND p.deleted_at IS NULL) AS projects_using
         FROM calendars c WHERE c.deleted_at IS NULL ORDER BY c.is_default DESC, c.name`);
    res.json({ calendars: rows });
  } catch (err) { next(err); }
});

router.get("/calendars/:id/exceptions", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, exception_date, working, note FROM calendar_exceptions
        WHERE calendar_id = $1 ORDER BY exception_date`, [Number(req.params.id)]);
    res.json({ exceptions: rows });
  } catch (err) { next(err); }
});

router.post("/calendars", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const b = z.object({
      name: z.string().trim().min(1).max(120),
      working_days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
      hours_per_day: z.number().min(1).max(24).optional(),
      description: z.string().max(500).nullable().optional(),
    }).parse(req.body);
    const calendar = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO calendars (name, working_days, hours_per_day, description, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [b.name, b.working_days || [1, 2, 3, 4, 5], b.hours_per_day || 8,
         b.description || null, req.user.id]);
      await audit.recordCreate(client, "calendar", rows[0].id, req.user.id);
      return rows[0];
    });
    res.status(201).json({ calendar });
  } catch (err) { next(err); }
});

router.post("/calendars/:id/exceptions", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const b = z.object({
      exception_date: dateStr,
      working: z.boolean().optional(),
      note: z.string().max(300).nullable().optional(),
    }).parse(req.body);
    const id = Number(req.params.id);
    const exception = await withTransaction(async (client) => {
      const { rows: cal } = await client.query(
        `SELECT id FROM calendars WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!cal.length) throw notFound("Calendar not found");
      const { rows } = await client.query(
        `INSERT INTO calendar_exceptions (calendar_id, exception_date, working, note, created_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (calendar_id, exception_date)
           DO UPDATE SET working = EXCLUDED.working, note = EXCLUDED.note
         RETURNING *`,
        [id, b.exception_date, b.working === true, b.note || null, req.user.id]);
      await audit.record(client, {
        entity: "calendar", entityId: id, userId: req.user.id,
        changes: [{ field: "exception", old: null,
          new: `${b.exception_date} ${b.working ? "worked" : "non-working"}` }],
      });
      return rows[0];
    });
    res.status(201).json({ exception });
  } catch (err) { next(err); }
});

router.delete("/calendars/:id/exceptions/:date", requireRole("ADMIN"), async (req, res, next) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) throw badRequest("Date must be YYYY-MM-DD");
    const { rowCount } = await query(
      `DELETE FROM calendar_exceptions WHERE calendar_id = $1 AND exception_date = $2`,
      [Number(req.params.id), req.params.date]);
    if (!rowCount) throw notFound("Exception not found");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
