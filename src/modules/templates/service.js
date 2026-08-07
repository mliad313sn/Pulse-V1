"use strict";
// SPM P1 — templates/blueprints + custom-field definitions (Admin/DL config).
// Applying a template stamps milestones (dated from project start), workstreams
// and deliverables in one transaction. Custom values validate against the defs
// server-side — the UI cannot invent or bypass fields.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, notFound, forbidden } = require("../../middleware/errors");

const canManage = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD";

async function listTemplates() {
  const { rows } = await query(
    `SELECT * FROM project_templates WHERE deleted_at IS NULL ORDER BY name`);
  return rows;
}

async function createTemplate(actor, input) {
  if (!canManage(actor)) throw forbidden("Only Admin or Division Leads manage templates");
  for (const m of input.milestones || []) {
    if (!m.title || typeof m.offset_days !== "number") {
      throw badRequest("Each template milestone needs a title and offset_days");
    }
  }
  return withTransaction(async (client) => {
    const dup = await client.query(
      `SELECT 1 FROM project_templates WHERE lower(name) = lower($1) AND deleted_at IS NULL`, [input.name]);
    if (dup.rows.length) throw badRequest("A template with this name already exists");
    const { rows } = await client.query(
      `INSERT INTO project_templates (name, description, governance, milestones_json, workstreams_json, deliverables_json, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.name, input.description || null, input.governance === "LITE" ? "LITE" : "STANDARD",
       JSON.stringify(input.milestones || []), JSON.stringify(input.workstreams || []),
       JSON.stringify(input.deliverables || []), actor.id]);
    await audit.recordCreate(client, "project_template", rows[0].id, actor.id);
    return rows[0];
  });
}

// Instantiate template content onto a freshly created project.
async function applyTemplate(client, templateId, project, actorId) {
  const { rows } = await client.query(
    `SELECT * FROM project_templates WHERE id = $1 AND deleted_at IS NULL`, [templateId]);
  const tpl = rows[0];
  if (!tpl) throw badRequest("Unknown project template");
  const start = project.start_date ? new Date(project.start_date) : new Date();
  const { READINESS_TEMPLATE } = require("../milestones/service");
  for (const m of tpl.milestones_json) {
    const due = new Date(start);
    due.setUTCDate(due.getUTCDate() + Number(m.offset_days || 0));
    const { rows: ins } = await client.query(
      `INSERT INTO milestones (project_id, title, type, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, type`,
      [project.id, m.title, m.type || "STANDARD", due.toISOString().slice(0, 10), actorId]);
    if (ins[0].type === "SITE_READINESS") {
      for (const label of READINESS_TEMPLATE) {
        await client.query(
          `INSERT INTO readiness_items (milestone_id, label, created_by) VALUES ($1,$2,$3)`,
          [ins[0].id, label, actorId]);
      }
    }
  }
  for (const w of tpl.workstreams_json) {
    await client.query(
      `INSERT INTO workstreams (project_id, title, created_by) VALUES ($1,$2,$3)`,
      [project.id, w.title, actorId]);
  }
  for (const d of tpl.deliverables_json) {
    await client.query(
      `INSERT INTO deliverables (project_id, title, created_by) VALUES ($1,$2,$3)`,
      [project.id, d.title, actorId]);
  }
  await client.query(`UPDATE projects SET template_id = $2 WHERE id = $1`, [project.id, templateId]);
  return tpl;
}

// ===== custom fields =====
async function listFieldDefs() {
  const { rows } = await query(
    `SELECT * FROM custom_field_defs WHERE deleted_at IS NULL ORDER BY id`);
  return rows;
}

async function createFieldDef(actor, input) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin defines custom fields");
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) {
    throw badRequest("Field key must be snake_case (a-z, 0-9, _)");
  }
  if (input.type === "select" && !(Array.isArray(input.options) && input.options.length)) {
    throw badRequest("A select field needs options");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO custom_field_defs (entity, key, label, type, options_json, required, created_by)
       VALUES ('project',$1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.key, input.label, input.type,
       input.options ? JSON.stringify(input.options) : null, input.required === true, actor.id]);
    await audit.recordCreate(client, "custom_field_def", rows[0].id, actor.id);
    return rows[0];
  }).catch((e) => {
    if (String(e.message).includes("duplicate key")) throw badRequest(`Field key '${input.key}' already exists`);
    throw e;
  });
}

// Server-side validation of a custom value payload against the defs.
async function validateCustomValues(values, { requireRequired = false } = {}) {
  if (values == null) return {};
  if (typeof values !== "object" || Array.isArray(values)) throw badRequest("custom must be an object");
  const defs = await listFieldDefs();
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const def = byKey.get(k);
    if (!def) throw badRequest(`Unknown custom field '${k}'`);
    if (v == null || v === "") continue;
    if (def.type === "number" && typeof v !== "number") throw badRequest(`Field '${k}' must be a number`);
    if (def.type === "text" && typeof v !== "string") throw badRequest(`Field '${k}' must be text`);
    if (def.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest(`Field '${k}' must be YYYY-MM-DD`);
    if (def.type === "select" && !def.options_json.includes(v)) {
      throw badRequest(`Field '${k}' must be one of: ${def.options_json.join(", ")}`);
    }
    out[k] = v;
  }
  if (requireRequired) {
    for (const def of defs) {
      if (def.required && (out[def.key] == null || out[def.key] === "")) {
        throw badRequest(`Custom field '${def.label}' is required`);
      }
    }
  }
  return out;
}

module.exports = { listTemplates, createTemplate, applyTemplate, listFieldDefs, createFieldDef, validateCustomValues };
