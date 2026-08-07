"use strict";
// PULSE ↔ SDP, PHASE 1 — the nightly BAU import.
//
// Refreshes the materialised views over the SDP source, then copies the result
// into PULSE-local tables. The SPA never reads a foreign table: it reads
// bau_load, so the capacity screen still renders when SDP is unreachable —
// with a visible "as of" stamp so stale is never mistaken for current.
//
// Failure policy: the last good copy stays. A failed refresh raises a
// notification and leaves yesterday's numbers in place rather than blanking
// the screen.
const cron = require("node-cron");
const { pool, query, withTransaction } = require("../db/pool");
const notifications = require("../modules/notifications/service");

// Runs after zoho-sync has had time to land the night's tickets.
const SCHEDULE = process.env.BAU_IMPORT_CRON || "30 3 * * *";

async function sdpAvailable() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'sdp_fdw' AND table_name = 'request_records'`);
  if (!rows[0].n) return { ok: false, reason: "sdp_fdw.request_records is not present" };
  try {
    await query(`SELECT 1 FROM sdp_fdw.request_records LIMIT 1`);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `sdp_fdw is present but unreadable: ${err.message}` };
  }
}

async function refreshMart() {
  const views = ["mart.bau_helpdesk_load", "mart.bau_unattributed_mv", "mart.bau_tracker_load"];
  const refreshed = [];
  for (const v of views) {
    // CONCURRENTLY needs a populated MV; the first refresh after creation
    // cannot be concurrent, so fall back once and then stay concurrent.
    try {
      await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${v}`);
    } catch (err) {
      if (!/has not been populated/i.test(err.message)) throw err;
      await query(`REFRESH MATERIALIZED VIEW ${v}`);
    }
    refreshed.push(v);
  }
  return refreshed;
}

// Copy the mart into PULSE-local tables, inside one transaction so the local
// copy is never half-updated.
async function materialise() {
  return withTransaction(async (client) => {
    const helpdesk = await client.query(
      `INSERT INTO bau_load (user_id, period, source, tickets, hours, provenance, source_system, imported_at)
       SELECT m.user_id, m.period, 'HELPDESK', m.tickets, m.bau_hours, m.provenance, 'SDP', now()
         FROM mart.bau_helpdesk_load m
        WHERE m.user_id IS NOT NULL
       ON CONFLICT (user_id, period, source) DO UPDATE SET
         tickets = EXCLUDED.tickets, hours = EXCLUDED.hours,
         provenance = EXCLUDED.provenance, imported_at = now()
       RETURNING id`);

    const unattributed = await client.query(
      `INSERT INTO bau_unattributed (period, site_code, reason, tickets, source_system, imported_at)
       SELECT period, site_code, reason, tickets, 'SDP', now() FROM mart.bau_unattributed_mv
       ON CONFLICT (period, site_code, reason) DO UPDATE SET
         tickets = EXCLUDED.tickets, imported_at = now()
       RETURNING id`);

    return { helpdesk_rows: helpdesk.rowCount, unattributed_rows: unattributed.rowCount };
  });
}

// Anyone over their available hours this month gets flagged to their division
// lead — the point of the whole programme is that overload becomes visible
// before it becomes a missed deadline.
async function notifyOverload(actorId) {
  const period = new Date().toISOString().slice(0, 7);
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name, c.available_hours,
            coalesce(sum(b.hours), 0) AS bau_hours
       FROM users u
       JOIN person_capacity c ON c.user_id = u.id AND c.period = $1 AND c.deleted_at IS NULL
       LEFT JOIN bau_load b ON b.user_id = u.id AND b.period = $1
      WHERE u.deleted_at IS NULL AND u.active
      GROUP BY u.id, u.name, c.available_hours
     HAVING coalesce(sum(b.hours), 0) > c.available_hours`, [period]);

  if (!rows.length) return { notified: 0 };
  return withTransaction(async (client) => {
    const { rows: leads } = await client.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND active
        AND role IN ('ADMIN','DIVISION_LEAD')`);
    let sent = 0;
    for (const person of rows) {
      for (const lead of leads) {
        await notifications.create(client, {
          userId: lead.id, type: "CAPACITY_OVERLOAD", entity: "user", entityId: person.user_id,
          text: `${person.name} is over capacity in ${period}: ${Math.round(person.bau_hours)} h of BAU ` +
                `against ${Math.round(person.available_hours)} h available, before any project work`,
          createdBy: actorId || null,
        });
        sent++;
      }
    }
    return { notified: sent, people: rows.length };
  });
}

async function runOnce(actor) {
  const started = Date.now();
  const availability = await sdpAvailable();
  if (!availability.ok) {
    return {
      ok: false, code: "BLOCKED_EXTERNAL", reason: availability.reason,
      note: "The capacity ledger still renders from the last imported copy in bau_load.",
    };
  }
  try {
    const refreshed = await refreshMart();
    const counts = await materialise();
    const overload = await notifyOverload(actor?.id);
    const { rows: freshness } = await query(
      `SELECT max(imported_at) AS as_of, count(*)::int AS rows FROM bau_load`);
    return {
      ok: true, refreshed, ...counts, ...overload,
      as_of: freshness[0].as_of, local_rows: freshness[0].rows,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    // Last good copy stays. Tell the Admins rather than blanking the screen.
    console.error("[bauImport] failed:", err.message);
    try {
      await withTransaction(async (client) => {
        const { rows: admins } = await client.query(
          `SELECT id FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL AND active`);
        for (const a of admins) {
          await notifications.create(client, {
            userId: a.id, type: "SYNC_HALTED", entity: "user", entityId: a.id,
            text: `BAU import from ServiceDesk Plus failed: ${err.message}. The last imported figures are still shown.`,
            createdBy: null,
          });
        }
      });
    } catch { /* notification failure must not mask the original error */ }
    return { ok: false, error: err.message, note: "Last good copy retained." };
  }
}

let task = null;
function start() {
  if (task) return task;
  task = cron.schedule(SCHEDULE, () => {
    runOnce().then((r) => console.log("[bauImport]", JSON.stringify(r)))
      .catch((e) => console.error("[bauImport]", e.message));
  }, { timezone: "GMT" });
  console.log(`[bauImport] scheduled ${SCHEDULE} GMT`);
  return task;
}
function stop() { if (task) { task.stop(); task = null; } }

module.exports = { start, stop, runOnce, refreshMart, materialise, sdpAvailable, notifyOverload };
