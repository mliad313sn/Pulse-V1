"use strict";
// Pulse-V1 sync server side:
//  - idempotency middleware: an offline op replayed with the same X-Client-Op-Id
//    applies exactly once (duplicates get 200 {duplicate:true})
//  - halt alert: when the client queue hits a hard error it notifies every Admin
const express = require("express");
const { z } = require("zod");
const { query } = require("../../db/pool");
const { requireAuth } = require("../../middleware/authz");
const notifications = require("../notifications/service");

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// mounted BEFORE the API routers
async function syncIdempotency(req, res, next) {
  const opId = req.get("X-Client-Op-Id");
  if (!opId || !MUTATING.has(req.method)) return next();
  try {
    const { rows } = await query(`SELECT op_id, status_code FROM sync_ops WHERE op_id = $1`, [opId]);
    if (rows.length) {
      return res.status(200).json({ duplicate: true, op_id: opId, original_status: rows[0].status_code });
    }
    res.on("finish", () => {
      if (res.statusCode < 400) {
        query(
          `INSERT INTO sync_ops (op_id, user_id, method, path, status_code)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (op_id) DO NOTHING`,
          [opId, req.session?.userId || null, req.method, req.originalUrl.slice(0, 500), res.statusCode]
        ).catch((e) => console.error("[sync] ledger write failed:", e.message));
      }
    });
    next();
  } catch (err) {
    next(err);
  }
}

const router = express.Router();
router.use(requireAuth);

// client reports a halted queue -> alert administrators (no automated resolution)
const alertBody = z.object({
  op_summary: z.string().max(300),
  status: z.number().int(),
  error: z.string().max(500),
  queued_remaining: z.number().int().min(0),
});
router.post("/halt-alert", async (req, res, next) => {
  try {
    const b = alertBody.parse(req.body);
    const admins = await query(`SELECT id FROM users WHERE role = 'ADMIN' AND active AND deleted_at IS NULL`);
    for (const a of admins.rows) {
      await notifications.create(null, {
        userId: a.id, type: "SYNC_HALTED", entity: "sync", entityId: req.user.id,
        text: `SYNC HALTED for ${req.user.name}: ${b.op_summary} failed (${b.status} ${b.error}); ${b.queued_remaining} op(s) frozen — manual review needed`,
        createdBy: req.user.id,
      });
    }
    res.json({ ok: true, alerted: admins.rows.length });
  } catch (err) { next(err); }
});

module.exports = { router, syncIdempotency };
