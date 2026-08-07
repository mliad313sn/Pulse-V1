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
const crypto = require("crypto");

// Phase 0: an op is "the same" only for the SAME user + method + path + body.
// A colliding op_id from another user is a fresh operation, not a duplicate;
// the same user reusing an op_id for a DIFFERENT request is a hard 409.
function bodyHash(req) {
  return crypto.createHash("sha256")
    .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
    .digest("hex");
}

// mounted BEFORE the API routers (after session + body parsing)
async function syncIdempotency(req, res, next) {
  const opId = req.get("X-Client-Op-Id");
  if (!opId || !MUTATING.has(req.method)) return next();
  try {
    const userId = req.session?.userId || null;
    const hash = bodyHash(req);
    const { rows } = await query(
      `SELECT status_code, method, path, body_hash FROM sync_ops
        WHERE op_id = $1 AND user_id IS NOT DISTINCT FROM $2`,
      [opId, userId]
    );
    if (rows.length) {
      const prev = rows[0];
      // legacy rows have no hash — fall back to method+path match
      const same = prev.body_hash ? prev.body_hash === hash
        : (prev.method === req.method && prev.path === req.originalUrl.slice(0, 500));
      if (!same) {
        return res.status(409).json({
          error: "This operation id was already used for a different request — the client must issue a new id",
          op_id: opId,
        });
      }
      return res.status(200).json({ duplicate: true, op_id: opId, original_status: prev.status_code });
    }
    res.on("finish", () => {
      if (res.statusCode < 400) {
        query(
          `INSERT INTO sync_ops (op_id, user_id, method, path, status_code, body_hash)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (op_id, user_id) DO NOTHING`,
          [opId, userId, req.method, req.originalUrl.slice(0, 500), res.statusCode, hash]
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
