"use strict";
// Weekly RAG snapshot: Mondays 06:00 GMT — rag_history row for every non-CLOSED
// project (plan §6). Feeds the Reports RAG trend.
const cron = require("node-cron");
const { query } = require("../db/pool");

async function runSnapshot() {
  const { rows } = await query(
    `INSERT INTO rag_history (project_id, snapshot_date, rag, progress_pct)
     SELECT p.id, (now() AT TIME ZONE 'utc')::date, coalesce(p.rag_override, p.rag_computed), p.progress_pct
       FROM projects p
      WHERE p.deleted_at IS NULL AND p.stage <> 'CLOSED'
     ON CONFLICT (project_id, snapshot_date)
       DO UPDATE SET rag = EXCLUDED.rag, progress_pct = EXCLUDED.progress_pct
     RETURNING id`
  );
  console.log(`[snapshot] rag_history: ${rows.length} projects snapshotted`);
  return rows.length;
}

function start() {
  cron.schedule("0 6 * * 1", runSnapshot, { timezone: "Etc/UTC" });
  console.log("[snapshot] scheduled Mondays 06:00 GMT");
}

module.exports = { start, runSnapshot };
