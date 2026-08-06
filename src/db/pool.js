"use strict";
const { Pool, types } = require("pg");

// int8 (bigint) -> JS number. All our identity PKs are far below 2^53, and JSON
// clients send numbers; consistent types keep id comparisons sane.
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10));

const url =
  process.env.NODE_ENV === "test"
    ? process.env.DATABASE_URL_TEST
    : process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    process.env.NODE_ENV === "test"
      ? "DATABASE_URL_TEST is not set"
      : "DATABASE_URL is not set"
  );
}

const pool = new Pool({ connectionString: url, max: 10 });

// Parameterized queries ONLY — every call site passes params separately.
async function query(text, params) {
  return pool.query(text, params);
}

// All multi-table writes go through a transaction.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
