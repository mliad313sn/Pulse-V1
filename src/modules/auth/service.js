"use strict";
// Isolated auth module (plan §1): local email+password V1, Entra-swappable.
// The single interface the rest of the app relies on is authenticate(req) -> user|null
// (implemented via session lookup in middleware/authz.js requireAuth).
const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, forbidden, unauthorized } = require("../../middleware/errors");

const BCRYPT_COST = 12;
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 10;

async function findByEmail(email) {
  const { rows } = await query(
    `SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email]
  );
  return rows[0] || null;
}

// Returns the user on success; throws 401 (bad credentials) or 403 (locked/inactive).
async function verifyCredentials(email, password) {
  const user = await findByEmail(email);
  // Constant-shape behavior whether or not the user exists.
  if (!user || !user.active) {
    await bcrypt.compare(password, "$2a$12$invalidsaltinvalidsaltinvalidsaltinvalid12345678901234");
    throw unauthorized("Invalid email or password");
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw forbidden(`Account locked — try again after ${new Date(user.locked_until).toISOString()}`);
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const failed = user.failed_logins + 1;
    if (failed >= MAX_FAILED) {
      await query(
        `UPDATE users SET failed_logins = 0,
                locked_until = now() + interval '${LOCKOUT_MINUTES} minutes', updated_at = now()
          WHERE id = $1`,
        [user.id]
      );
      throw forbidden(`Account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED} failed attempts`);
    }
    await query(`UPDATE users SET failed_logins = $2, updated_at = now() WHERE id = $1`, [user.id, failed]);
    throw unauthorized("Invalid email or password");
  }
  if (user.failed_logins > 0 || user.locked_until) {
    await query(`UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1`, [user.id]);
  }
  return user;
}

async function changePassword(userId, currentPassword, newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const { rows } = await query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
  const user = rows[0];
  if (!user) throw unauthorized();
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw unauthorized("Current password is incorrect");
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1`,
      [userId, hash]
    );
    await audit.record(client, {
      entity: "user", entityId: userId, userId,
      changes: [{ field: "password_changed", old: null, new: "yes" }],
    });
  });
}

// ===== Admin user management =====
async function createUser(actor, { name, email, password, role, divisionId, siteId }) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const existing = await findByEmail(email);
  if (existing) throw badRequest("A user with this email already exists");
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, division_id, site_id, must_change_password, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING id, name, email, role, division_id, site_id, active, must_change_password`,
      [name, email, hash, role, divisionId || null, siteId || null, actor.id]
    );
    await audit.recordCreate(client, "user", rows[0].id, actor.id);
    return rows[0];
  });
}

async function updateUser(actor, id, patch) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const before = rows[0];
  if (!before) throw badRequest("User not found");
  const fields = ["name", "email", "role", "division_id", "site_id", "active",
    "is_steering_committee", "enterprise_access"];
  const after = { ...before };
  for (const f of fields) if (patch[f] !== undefined) after[f] = patch[f];
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE users SET name=$2, email=$3, role=$4, division_id=$5, site_id=$6, active=$7,
              is_steering_committee=$8, enterprise_access=$9, updated_at=now()
        WHERE id = $1 RETURNING id, name, email, role, division_id, site_id, active,
              must_change_password, is_steering_committee, enterprise_access`,
      [id, after.name, after.email, after.role, after.division_id, after.site_id, after.active,
       after.is_steering_committee, after.enterprise_access]
    );
    await audit.record(client, {
      entity: "user", entityId: id, userId: actor.id,
      changes: audit.diff(before, after, fields),
    });
    return res.rows[0];
  });
}

async function resetPassword(actor, id, newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0,
              locked_until = NULL, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, hash]
    );
    await audit.record(client, {
      entity: "user", entityId: id, userId: actor.id,
      changes: [{ field: "password_reset", old: null, new: "yes" }],
    });
  });
}

async function softDeleteUser(actor, id) {
  await withTransaction(async (client) => {
    await client.query(`UPDATE users SET deleted_at = now(), active = false, updated_at = now() WHERE id = $1`, [id]);
    await audit.recordDelete(client, "user", id, actor.id);
  });
}

async function listUsers({ limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.division_id, d.code AS division_code,
            u.site_id, s.code AS site_code, u.active, u.must_change_password, u.locked_until,
            u.is_steering_committee, u.enterprise_access
       FROM users u
       LEFT JOIN divisions d ON d.id = u.division_id
       LEFT JOIN sites s ON s.id = u.site_id
      WHERE u.deleted_at IS NULL
      ORDER BY u.name
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

module.exports = {
  verifyCredentials,
  changePassword,
  createUser,
  updateUser,
  resetPassword,
  softDeleteUser,
  listUsers,
  findByEmail,
  BCRYPT_COST,
};
