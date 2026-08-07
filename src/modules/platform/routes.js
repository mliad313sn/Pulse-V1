"use strict";
// SPM Phase 10 — webhook subscription management (Admin) + delivery ledger
// with DLQ redrive, and the OpenAPI document.
const express = require("express");
const { z } = require("zod");
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { requireAuth, requireRole } = require("../../middleware/authz");
const { notFound } = require("../../middleware/errors");
const outbox = require("./outbox");
const openapi = require("./openapi");

const router = express.Router();
router.use(requireAuth);

// Generated from the live router tree — see openapi.js
router.get("/openapi.json", (req, res) => res.json(openapi.document(req.app)));

// The event catalogue integrators subscribe against
router.get("/events/catalogue", (req, res) => res.json({ events: require("./events").CATALOGUE }));

router.get("/webhooks", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.url, s.events, s.active, s.description, s.created_at,
              (SELECT count(*)::int FROM webhook_deliveries d WHERE d.subscription_id = s.id AND d.status = 'DEAD') AS dead_count
         FROM webhook_subscriptions s WHERE s.deleted_at IS NULL ORDER BY s.id`);
    res.json({ subscriptions: rows }); // secret never echoed back
  } catch (err) { next(err); }
});

const subBody = z.object({
  url: z.string().url().max(2000),
  secret: z.string().min(16).max(200),
  events: z.array(z.string().max(100)).max(50).optional(),
  description: z.string().max(500).nullable().optional(),
});
router.post("/webhooks", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const b = subBody.parse(req.body);
    const sub = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO webhook_subscriptions (url, secret, events, description, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, url, events, active, description, created_at`,
        [b.url, b.secret, b.events || [], b.description || null, req.user.id]);
      await audit.recordCreate(client, "webhook_subscription", rows[0].id, req.user.id);
      return rows[0];
    });
    res.status(201).json({ subscription: sub });
  } catch (err) { next(err); }
});

router.delete("/webhooks/:id", requireRole("ADMIN"), async (req, res, next) => {
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE webhook_subscriptions SET deleted_at = now(), active = false, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [Number(req.params.id)]);
      if (!rows.length) throw notFound("Subscription not found");
      await audit.record(client, {
        entity: "webhook_subscription", entityId: rows[0].id, userId: req.user.id,
        changes: [{ field: "deleted", old: "false", new: "true" }],
      });
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get("/webhooks/:id/deliveries", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, event, status, attempts, next_attempt_at, last_error, delivered_at, created_at
         FROM webhook_deliveries WHERE subscription_id = $1 ORDER BY id DESC LIMIT 100`,
      [Number(req.params.id)]);
    res.json({ deliveries: rows });
  } catch (err) { next(err); }
});

// DLQ redrive: put a DEAD/FAILED delivery back in the queue for one more cycle
router.post("/webhooks/deliveries/:id/redrive", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE webhook_deliveries SET status='PENDING', next_attempt_at=now(), attempts=0,
         last_error=NULL, updated_at=now()
        WHERE id = $1 AND status IN ('DEAD','FAILED') RETURNING id, status`,
      [Number(req.params.id)]);
    if (!rows.length) throw notFound("No redrivable delivery with that id");
    res.json({ delivery: rows[0] });
  } catch (err) { next(err); }
});

// Manual queue flush (Admin) — also used by ops runbooks
router.post("/webhooks/process", requireRole("ADMIN"), async (req, res, next) => {
  try { res.json({ processed: await outbox.processPending() }); }
  catch (err) { next(err); }
});

module.exports = router;
