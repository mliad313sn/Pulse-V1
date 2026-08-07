"use strict";
// E24 — attachments: metadata + authorization here, bytes in the adapter.
// Upload needs write access to the project (PARTIAL+); download follows
// project visibility, so confidential/site concealment applies unchanged.
const crypto = require("crypto");
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, notFound, forbidden } = require("../../middleware/errors");
const { storage } = require("./storage");

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = new Map([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
  [".msg", "application/vnd.ms-outlook"],
]);

// Hostile names: strip any path, control chars, leading dots; keep it short.
function sanitizeFilename(name) {
  const base = String(name || "").split(/[\\/]/).pop()
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/^\.+/, "").trim().slice(0, 180);
  if (!base) throw badRequest("Invalid filename");
  return base;
}

const ENTITY_TABLES = {
  milestone: "milestones", roadblock: "roadblocks", decision: "decisions",
  deliverable: "deliverables", task: "tasks", capa: "capas",
};

async function create(actor, projectAccess, file, meta = {}) {
  if (actor.role === "VIEWER" || projectAccess.access === "READ") {
    throw forbidden("Write access to this project required");
  }
  const filename = sanitizeFilename(file.filename);
  const ext = (filename.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw badRequest(`File type ${ext || "(none)"} is not allowed`);
  }
  if (!file.buffer.length) throw badRequest("Empty file");
  if (file.buffer.length > MAX_BYTES) throw badRequest("File exceeds the 25 MB limit");

  const entityType = meta.entity_type || "project";
  let entityId = meta.entity_id ? Number(meta.entity_id) : null;
  if (entityType !== "project" && entityId) {
    const table = ENTITY_TABLES[entityType];
    if (table) {
      const { rows } = await query(
        `SELECT 1 FROM ${table} WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
        [entityId, projectAccess.project.id]);
      if (!rows.length) throw badRequest(`${entityType} does not belong to this project`);
    }
  } else if (entityType === "project") {
    entityId = null;
  }

  const storageKey = crypto.randomBytes(24).toString("hex");
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  // versioning: same filename on the same target increments version
  const { rows: prev } = await query(
    `SELECT coalesce(max(version), 0) AS v FROM attachments
      WHERE project_id = $1 AND entity_type = $2 AND entity_id IS NOT DISTINCT FROM $3
        AND lower(filename) = lower($4) AND deleted_at IS NULL`,
    [projectAccess.project.id, entityType, entityId, filename]);

  await storage().put(storageKey, file.buffer);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO attachments (project_id, entity_type, entity_id, filename, media_type,
         size_bytes, sha256, storage_key, version, description, classification, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [projectAccess.project.id, entityType, entityId, filename,
       ALLOWED.get(ext), file.buffer.length, sha256, storageKey,
       prev[0].v + 1, meta.description || null,
       meta.classification === "CONFIDENTIAL" ? "CONFIDENTIAL" : "GENERAL", actor.id]
    );
    await audit.recordCreate(client, "attachment", rows[0].id, actor.id);
    const { storage_key, ...pub } = rows[0];
    return pub;
  });
}

async function list(projectAccess, entityType, entityId) {
  const params = [projectAccess.project.id];
  let where = "a.project_id = $1 AND a.deleted_at IS NULL";
  if (entityType) { params.push(entityType); where += ` AND a.entity_type = $${params.length}`; }
  if (entityId) { params.push(Number(entityId)); where += ` AND a.entity_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT a.id, a.entity_type, a.entity_id, a.filename, a.media_type, a.size_bytes,
            a.sha256, a.version, a.description, a.classification, a.created_at,
            u.name AS uploaded_by
       FROM attachments a LEFT JOIN users u ON u.id = a.created_by
      WHERE ${where}
      ORDER BY a.created_at DESC`,
    params);
  return rows;
}

// Download resolves the project THEN applies normal visibility — a concealed
// project's attachments are a concealed 404, same as the project itself.
async function load(attachmentId) {
  const { rows } = await query(
    `SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL`, [attachmentId]);
  if (!rows.length) throw notFound("Attachment not found");
  return rows[0];
}

async function content(row) {
  return storage().get(row.storage_key);
}

async function softDelete(actor, projectAccess, attachmentId) {
  if (projectAccess.access !== "FULL") throw forbidden("Full project rights required to delete attachments");
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE attachments SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL RETURNING id`,
      [attachmentId, projectAccess.project.id]);
    if (!rows.length) throw notFound("Attachment not found");
    await audit.recordDelete(client, "attachment", attachmentId, actor.id);
  });
}

module.exports = { create, list, load, content, softDelete, MAX_BYTES };
