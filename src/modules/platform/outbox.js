"use strict";
// SPM Phase 10 — durable webhook outbox.
// emit(client, ...) runs inside the SAME transaction as the domain change:
// if the change commits, the delivery rows exist; if it rolls back, no ghost
// events. A worker then delivers with exponential backoff; after MAX_ATTEMPTS
// the row moves to DEAD (the DLQ) where Admins can inspect and redrive it.
const crypto = require("crypto");
const { query } = require("../../db/pool");

const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = (attempts) => Math.min(2 ** attempts, 60); // 2,4,8,16,32,60

// Test seam (same pattern as the intelligence adapter) — production uses global fetch.
let fetchOverride = null;
function setFetchForTests(fn) { fetchOverride = fn; }

// Enqueue one delivery per matching active subscription — transactionally.
async function emit(client, event, payload) {
  await client.query(
    `INSERT INTO webhook_deliveries (subscription_id, event, payload_json)
     SELECT s.id, $1, $2::jsonb FROM webhook_subscriptions s
      WHERE s.deleted_at IS NULL AND s.active = true
        AND (cardinality(s.events) = 0 OR $1 = ANY(s.events))`,
    [event, JSON.stringify({ event, occurred_at: new Date().toISOString(), data: payload })]);
}

function sign(secret, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// Deliver due rows. Uses FOR UPDATE SKIP LOCKED so multiple workers/instances
// never double-send the same delivery.
async function processPending({ limit = 20 } = {}) {
  const { rows: due } = await query(
    `SELECT d.id FROM webhook_deliveries d
      WHERE d.status IN ('PENDING','FAILED') AND d.next_attempt_at <= now()
      ORDER BY d.next_attempt_at LIMIT $1`, [limit]);
  const results = [];
  for (const { id } of due) {
    results.push(await deliverOne(id));
  }
  return results.filter(Boolean);
}

async function deliverOne(deliveryId) {
  const { withTransaction } = require("../../db/pool");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, s.url, s.secret, s.active, s.deleted_at AS sub_deleted
         FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id = d.subscription_id
        WHERE d.id = $1 AND d.status IN ('PENDING','FAILED') AND d.next_attempt_at <= now()
        FOR UPDATE OF d SKIP LOCKED`, [deliveryId]);
    if (!rows.length) return null;
    const d = rows[0];
    if (!d.active || d.sub_deleted) {
      await client.query(
        `UPDATE webhook_deliveries SET status='DEAD', last_error='Subscription inactive', updated_at=now() WHERE id=$1`,
        [d.id]);
      return { id: d.id, status: "DEAD" };
    }
    const body = JSON.stringify(d.payload_json);
    const doFetch = fetchOverride || fetch;
    try {
      const res = await doFetch(d.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pulse-event": d.event,
          "x-pulse-delivery": String(d.id),
          "x-pulse-signature": sign(d.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await client.query(
        `UPDATE webhook_deliveries SET status='DELIVERED', delivered_at=now(), updated_at=now(),
           attempts = attempts + 1, last_error = NULL WHERE id=$1`, [d.id]);
      return { id: d.id, status: "DELIVERED" };
    } catch (err) {
      const attempts = d.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await client.query(
        `UPDATE webhook_deliveries SET status=$2, attempts=$3, last_error=$4,
           next_attempt_at = now() + ($5 || ' minutes')::interval, updated_at=now() WHERE id=$1`,
        [d.id, dead ? "DEAD" : "FAILED", attempts, String(err.message || err).slice(0, 500),
         String(BACKOFF_MINUTES(attempts))]);
      return { id: d.id, status: dead ? "DEAD" : "FAILED", error: String(err.message || err) };
    }
  });
}

let workerTimer = null;
function startWorker(intervalMs = 30000) {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processPending().catch((err) => console.error("webhook worker:", err.message));
  }, intervalMs);
  workerTimer.unref();
}
function stopWorker() { if (workerTimer) { clearInterval(workerTimer); workerTimer = null; } }

module.exports = { emit, processPending, deliverOne, startWorker, stopWorker, setFetchForTests, sign, MAX_ATTEMPTS };
