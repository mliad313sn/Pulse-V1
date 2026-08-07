"use strict";
// PULSE ↔ SDP — connect the read-only link to the ServiceDesk Plus database.
//
// Run once per deployment, after migrations:
//   SDP_HOST=... SDP_PORT=5432 SDP_DB=sdp_dashboard \
//   SDP_RO_USER=pulse_reader SDP_RO_PASSWORD=... node scripts/setup_sdp_fdw.js
//
// What it does: replaces the local staging tables in schema `sdp_fdw` with
// FOREIGN tables pointing at the real database. Every mart view, the import
// job, the API and the UI keep working unchanged — connecting the real source
// is configuration, not a code change.
//
// Credentials come from the environment and are never written into a migration.
//
// ON THE SDP SIDE, run this first (as a superuser there):
//
//   CREATE ROLE pulse_reader LOGIN PASSWORD '...';
//   GRANT USAGE ON SCHEMA public TO pulse_reader;
//   GRANT SELECT ON
//     request_records, request_worklogs, change_records, cab_approvals,
//     survey_results, md_meetings, md_issues, md_actions, md_meeting_projects,
//     insp_inspections, insp_findings, insp_actions,
//     tracker_years, tracker_pillars, tracker_activities,
//     tracker_targets_v2, tracker_inputs_v2,
//     users, sites, rr_site_aliases, site_module_codes, sync_metadata
//   TO pulse_reader;
//
// SELECT only. No INSERT, UPDATE, DELETE or CREATE — this programme is
// one-way, SDP → PULSE, and the grant is what enforces it.

const { pool } = require("../src/db/pool");

// Deliberately NOT "everything". Only the tables this programme reads; the
// remaining SDP tables hold requester names and ticket bodies we have no
// business copying.
const ALLOW_LIST = [
  "request_records", "request_worklogs", "change_records", "cab_approvals",
  "survey_results",
  "md_meetings", "md_issues", "md_actions", "md_meeting_projects",
  "insp_inspections", "insp_findings", "insp_actions",
  "tracker_years", "tracker_pillars", "tracker_activities",
  "tracker_targets_v2", "tracker_inputs_v2",
  "users", "sites", "rr_site_aliases", "site_module_codes", "sync_metadata",
];

// FROZEN legacy per ADR-001 — never imported, so nothing can accidentally read
// them.
const FORBIDDEN = ["tracker_config", "tracker_targets", "tracker_inputs"];

async function main() {
  const cfg = {
    host: process.env.SDP_HOST,
    port: process.env.SDP_PORT || "5432",
    dbname: process.env.SDP_DB || "sdp_dashboard",
    user: process.env.SDP_RO_USER,
    password: process.env.SDP_RO_PASSWORD,
  };
  const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => `SDP_${k.toUpperCase()}`);
  if (missing.length) {
    console.error("BLOCKED_EXTERNAL — cannot connect to ServiceDesk Plus.");
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("");
    console.error("PULSE keeps working: the capacity ledger renders from the last imported");
    console.error("copy in bau_load, and every SDP-backed endpoint returns 503 BLOCKED_EXTERNAL");
    console.error("rather than a fabricated number.");
    process.exit(2);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS postgres_fdw");

    await client.query(`DROP SERVER IF EXISTS sdp_srv CASCADE`);
    await client.query(
      `CREATE SERVER sdp_srv FOREIGN DATA WRAPPER postgres_fdw
         OPTIONS (host $1, port $2, dbname $3)`
        .replace("$1", `'${cfg.host}'`).replace("$2", `'${cfg.port}'`).replace("$3", `'${cfg.dbname}'`));
    await client.query(
      `CREATE USER MAPPING FOR CURRENT_USER SERVER sdp_srv
         OPTIONS (user $1, password $2)`
        .replace("$1", `'${cfg.user.replace(/'/g, "''")}'`)
        .replace("$2", `'${cfg.password.replace(/'/g, "''")}'`));

    // Drop the local staging tables — the mart views depend on them, so they
    // are dropped with CASCADE and the views are recreated from the migration
    // definitions afterwards.
    const { rows: local } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'sdp_fdw' AND table_type = 'BASE TABLE'`);
    for (const t of local) {
      await client.query(`DROP TABLE IF EXISTS sdp_fdw.${t.table_name} CASCADE`);
    }

    await client.query(
      `IMPORT FOREIGN SCHEMA public LIMIT TO (${ALLOW_LIST.join(", ")})
         FROM SERVER sdp_srv INTO sdp_fdw`);

    // Prove the forbidden legacy tables did not come across.
    const { rows: leaked } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'sdp_fdw' AND table_name = ANY($1::text[])`, [FORBIDDEN]);
    if (leaked.length) {
      throw new Error(`Frozen legacy tables were imported: ${leaked.map((r) => r.table_name).join(", ")}`);
    }

    // Prove the link is genuinely read-only before trusting it.
    let writable = false;
    try {
      await client.query(`SAVEPOINT rocheck`);
      await client.query(`INSERT INTO sdp_fdw.request_records (request_id) VALUES (-999999)`);
      writable = true;
      await client.query(`ROLLBACK TO SAVEPOINT rocheck`);
    } catch {
      await client.query(`ROLLBACK TO SAVEPOINT rocheck`);
    }
    if (writable) {
      throw new Error(
        "The SDP role can WRITE. This programme is strictly one-way — " +
        "revoke INSERT/UPDATE/DELETE from the reader role before continuing.");
    }

    await client.query("COMMIT");

    const { rows: count } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.foreign_tables WHERE foreign_table_schema = 'sdp_fdw'`);
    console.log(`Connected. ${count[0].n} foreign table(s) mounted at sdp_fdw from ${cfg.host}/${cfg.dbname}.`);
    console.log("Write check: the reader role cannot write. One-way link confirmed.");
    console.log("");
    console.log("Next: re-run the migrations to rebuild the mart views over the foreign tables,");
    console.log("then POST /api/v1/emid/import/bau to load the first copy.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Setup failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
