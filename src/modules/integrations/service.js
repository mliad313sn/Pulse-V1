"use strict";
// SPM Phase 10 (remainder) — external identity mapping.
//
// The rule that keeps integrations sane: a link is anchored on the external
// system's IMMUTABLE id, and once created that anchor never changes. The
// human-facing key (PROJ-123) and the URL may drift and are updated freely;
// re-pointing a link at a different external record is refused, because that
// is how audit trails quietly become fiction.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const { loadProjectAccess } = require("../../middleware/authz");
const registry = require("./registry");

const LINKABLE = {
  project: { table: "projects", access: "project" },
  task: { table: "tasks", access: "viaProject" },
  risk: { table: "risks", access: "viaProject" },
  action: { table: "actions", access: "viaProject" },
};

// Resolve the entity and check the caller may actually write to it — an
// integration must not become a way to touch records you cannot see.
async function assertEntityWritable(actor, entity, entityId) {
  const def = LINKABLE[entity];
  if (!def) throw badRequest(`Cannot link entity "${entity}" — linkable: ${Object.keys(LINKABLE).join(", ")}`);
  const { rows } = await query(
    `SELECT * FROM ${def.table} WHERE id = $1 AND deleted_at IS NULL`, [entityId]);
  if (!rows.length) throw notFound(`${entity} not found`);
  const projectId = entity === "project" ? rows[0].id : rows[0].project_id;
  const projectAccess = await loadProjectAccess(projectId, actor); // 404s if concealed
  if (projectAccess.access !== "FULL") {
    throw forbidden("Full project rights are required to link records to an external system");
  }
  return rows[0];
}

async function link(actor, input) {
  registry.assertUsable(input.system); // 503 BLOCKED_EXTERNAL when unconfigured
  await assertEntityWritable(actor, input.entity, input.entity_id);
  if (!input.external_id || !String(input.external_id).trim()) {
    throw badRequest("external_id is required — it is the anchor the link is built on");
  }
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM external_links
        WHERE system = $1 AND entity = $2 AND entity_id = $3 AND deleted_at IS NULL`,
      [input.system, input.entity, input.entity_id]);
    if (existing.length) {
      if (String(existing[0].external_id) !== String(input.external_id)) {
        throw conflict(
          `This ${input.entity} is already linked to ${input.system} record ${existing[0].external_id}. ` +
          "Re-pointing a link at a different external record is not allowed — unlink first, deliberately.",
          { current: existing[0] });
      }
      // same anchor: refresh the mutable descriptors only
      const { rows } = await client.query(
        `UPDATE external_links SET external_key = $2, external_url = $3,
           last_synced_at = now(), sync_state = 'LINKED', last_error = NULL, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [existing[0].id, input.external_key || existing[0].external_key,
         input.external_url || existing[0].external_url]);
      return rows[0];
    }
    const { rows } = await client.query(
      `INSERT INTO external_links (system, external_id, external_key, external_url,
         entity, entity_id, last_synced_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7) RETURNING *`,
      [input.system, String(input.external_id), input.external_key || null,
       input.external_url || null, input.entity, input.entity_id, actor.id]);
    await audit.record(client, {
      entity: input.entity, entityId: input.entity_id, userId: actor.id,
      changes: [{ field: `external_link:${input.system}`, old: null, new: String(input.external_id) }],
    });
    return rows[0];
  });
}

async function unlink(actor, id) {
  const { rows } = await query(`SELECT * FROM external_links WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows.length) throw notFound("Link not found");
  const l = rows[0];
  await assertEntityWritable(actor, l.entity, l.entity_id);
  return withTransaction(async (client) => {
    await client.query(`UPDATE external_links SET deleted_at = now() WHERE id = $1`, [id]);
    await audit.record(client, {
      entity: l.entity, entityId: l.entity_id, userId: actor.id,
      changes: [{ field: `external_link:${l.system}`, old: String(l.external_id), new: null }],
    });
    return { ok: true };
  });
}

// Links for one entity — used by the UI to show "this task is Jira PROJ-123".
async function linksFor(actor, entity, entityId) {
  const def = LINKABLE[entity];
  if (!def) throw badRequest(`Unknown entity "${entity}"`);
  const { rows } = await query(
    `SELECT * FROM ${def.table} WHERE id = $1 AND deleted_at IS NULL`, [entityId]);
  if (!rows.length) throw notFound(`${entity} not found`);
  await loadProjectAccess(entity === "project" ? rows[0].id : rows[0].project_id, actor);
  const { rows: links } = await query(
    `SELECT * FROM external_links WHERE entity = $1 AND entity_id = $2 AND deleted_at IS NULL
      ORDER BY system`, [entity, entityId]);
  return links;
}

// Deployment-wide view for Admins: what is wired, and is anything broken?
async function overview() {
  const { rows } = await query(
    `SELECT system, sync_state, count(*)::int AS n FROM external_links
      WHERE deleted_at IS NULL GROUP BY system, sync_state`);
  const counts = new Map();
  for (const r of rows) {
    if (!counts.has(r.system)) counts.set(r.system, { linked: 0, error: 0, orphaned: 0 });
    const c = counts.get(r.system);
    if (r.sync_state === "LINKED") c.linked += r.n;
    else if (r.sync_state === "ERROR") c.error += r.n;
    else c.orphaned += r.n;
  }
  return registry.list().map((a) => ({ ...a, links: counts.get(a.key) || { linked: 0, error: 0, orphaned: 0 } }));
}

module.exports = { link, unlink, linksFor, overview, LINKABLE };
