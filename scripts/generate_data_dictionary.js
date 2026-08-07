"use strict";
// Generates docs/DATA_DICTIONARY.md from the LIVE schema, so the document can
// never drift from the database. Run after adding a migration:
//   DATABASE_URL=postgres://… node scripts/generate_data_dictionary.js
const fs = require("fs");
const path = require("path");
const { pool, query } = require("../src/db/pool");

async function main() {
  const { rows: tables } = await query(`
    SELECT c.relname AS table_name, obj_description(c.oid) AS comment
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`);

  const { rows: columns } = await query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`);

  const { rows: constraints } = await query(`
    SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def, con.contype
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY rel.relname, con.contype`);

  const colsBy = new Map();
  for (const c of columns) {
    if (!colsBy.has(c.table_name)) colsBy.set(c.table_name, []);
    colsBy.get(c.table_name).push(c);
  }
  const consBy = new Map();
  for (const c of constraints) {
    if (!consBy.has(c.table_name)) consBy.set(c.table_name, []);
    consBy.get(c.table_name).push(c);
  }

  const out = [
    "# Pulse — data dictionary",
    "",
    "**Generated from the live schema** by `scripts/generate_data_dictionary.js`.",
    "Do not edit by hand — regenerate after adding a migration so it cannot drift.",
    "",
    `Tables: ${tables.length}. Every table carries \`created_at\`/\`updated_at\`; most carry`,
    "`deleted_at` (soft delete — history is never destroyed) and `created_by`.",
    "",
  ];

  for (const t of tables) {
    if (t.table_name === "schema_migrations" || t.table_name === "session") continue;
    out.push(`## ${t.table_name}`, "");
    if (t.comment) out.push(`> ${t.comment}`, "");
    out.push("| Column | Type | Null | Default |", "|---|---|---|---|");
    for (const c of colsBy.get(t.table_name) || []) {
      const def = (c.column_default || "").replace(/nextval\('[^']+'::regclass\)/, "identity").slice(0, 60);
      out.push(`| \`${c.column_name}\` | ${c.data_type} | ${c.is_nullable === "YES" ? "yes" : "no"} | ${def ? `\`${def}\`` : ""} |`);
    }
    const all = consBy.get(t.table_name) || [];
    const checks = all.filter((c) => c.contype === "c");
    const fks = all.filter((c) => c.contype === "f");
    const uniques = all.filter((c) => c.contype === "u");
    if (checks.length) {
      out.push("", "**Rules enforced by the database:**");
      for (const c of checks) out.push(`- \`${c.def}\``);
    }
    if (uniques.length) {
      out.push("", "**Uniqueness:**");
      for (const c of uniques) out.push(`- \`${c.def}\``);
    }
    if (fks.length) {
      out.push("", "**References:**");
      for (const c of fks) out.push(`- \`${c.def}\``);
    }
    out.push("");
  }

  const target = path.join(__dirname, "..", "docs", "DATA_DICTIONARY.md");
  fs.writeFileSync(target, out.join("\n"));
  console.log(`Wrote ${target} — ${tables.length} tables.`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
