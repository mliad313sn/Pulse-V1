"use strict";
// Plain-SQL migration runner: applies src/db/migrations/*.sql in filename order,
// tracked in schema_migrations. Idempotent — `npm run migrate` any number of times.
const fs = require("fs");
const path = require("path");
const { pool } = require("./pool");

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const { rows } = await pool.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED ${file}: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("migrations up to date");
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
module.exports = { migrate };
