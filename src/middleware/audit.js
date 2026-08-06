"use strict";
// Audit trail on ALL writes (plan §2). Services call these inside their transactions.
// Secrets are never logged: sensitive fields are filtered defensively here.

const SECRET_FIELDS = new Set(["password_hash", "password", "sess", "session", "csrfToken"]);

function scrub(field, value) {
  if (value === null || value === undefined) return null;
  if (SECRET_FIELDS.has(field)) return "[redacted]";
  const s = String(value);
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

// changes: array of {field, old, new} — pass [{field: '*', old: null, new: 'created'}] style
// entries for lifecycle events (created / soft-deleted).
async function record(client, { entity, entityId, userId, changes }) {
  for (const c of changes) {
    if (SECRET_FIELDS.has(c.field)) continue; // never write secret fields at all
    await client.query(
      `INSERT INTO audit_log (entity, entity_id, field, old_value, new_value, user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [entity, entityId, c.field, scrub(c.field, c.old), scrub(c.field, c.new), userId || null]
    );
  }
}

async function recordCreate(client, entity, entityId, userId) {
  await record(client, { entity, entityId, userId, changes: [{ field: "_lifecycle", old: null, new: "created" }] });
}

async function recordDelete(client, entity, entityId, userId) {
  await record(client, { entity, entityId, userId, changes: [{ field: "_lifecycle", old: "active", new: "soft-deleted" }] });
}

// diff(before, after, fields) -> changes array for fields that actually changed
function diff(before, after, fields) {
  const changes = [];
  for (const f of fields) {
    if (after[f] === undefined) continue;
    const oldV = before[f] instanceof Date ? before[f].toISOString() : before[f];
    const newV = after[f] instanceof Date ? after[f].toISOString() : after[f];
    if (String(oldV ?? "") !== String(newV ?? "")) changes.push({ field: f, old: oldV, new: newV });
  }
  return changes;
}

module.exports = { record, recordCreate, recordDelete, diff };
