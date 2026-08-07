"use strict";
const { pool } = require("../../db/pool");

async function create(db, { userId, type, entity, entityId, text, createdBy }) {
  const { rows } = await (db || pool).query(
    `INSERT INTO notifications (user_id, type, entity, entity_id, text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [userId, type, entity, entityId, text, createdBy || null]
  );
  // channel dispatch is best-effort AFTER the in-app row and never inside the
  // business transaction (a Teams outage must not roll back a gate approval)
  setImmediate(() => {
    const channels = require("./channels");
    channels
      .dispatch({ notificationId: rows[0].id, recipient: `user:${userId}`, subject: type.replace(/_/g, " "), text })
      .catch(() => {});
  });
  return rows[0].id;
}

async function listForUser(userId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, type, entity, entity_id, text, read_at, created_at
       FROM notifications
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const unread = await pool.query(
    `SELECT count(*)::int AS n FROM notifications
      WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL`,
    [userId]
  );
  return { notifications: rows, unreadCount: unread.rows[0].n };
}

async function markRead(userId, id) {
  await pool.query(
    `UPDATE notifications SET read_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [id, userId]
  );
}

async function markAllRead(userId) {
  await pool.query(
    `UPDATE notifications SET read_at = now(), updated_at = now()
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
}

module.exports = { create, listForUser, markRead, markAllRead };
