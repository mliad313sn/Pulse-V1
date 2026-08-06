"use strict";
const { query } = require("../../db/pool");

// Global search (plan §4): projects (code/title ILIKE) + roadblock titles,
// respecting confidentiality.
async function search(user, q) {
  const like = `%${q}%`;
  const params = [like];
  let confidentiality = "TRUE";
  if (user.role === "CONTRIBUTOR" || user.role === "VIEWER") {
    params.push(user.id);
    confidentiality = `(p.confidential = false OR p.project_manager_id = $${params.length})`;
  }
  const [projects, roadblocks] = await Promise.all([
    query(
      `SELECT p.id, p.code, p.title, p.stage, coalesce(p.rag_override, p.rag_computed) AS rag
         FROM projects p
        WHERE p.deleted_at IS NULL AND (p.title ILIKE $1 OR p.code ILIKE $1) AND ${confidentiality}
        ORDER BY p.code LIMIT 20`,
      params
    ),
    query(
      `SELECT r.id, r.title, r.severity, r.status, p.id AS project_id, p.code AS project_code
         FROM roadblocks r JOIN projects p ON p.id = r.project_id
        WHERE r.deleted_at IS NULL AND p.deleted_at IS NULL AND r.title ILIKE $1 AND ${confidentiality}
        ORDER BY r.created_at DESC LIMIT 20`,
      params
    ),
  ]);
  return { projects: projects.rows, roadblocks: roadblocks.rows };
}

module.exports = { search };
