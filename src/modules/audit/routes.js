"use strict";
const express = require("express");
const { query } = require("../../db/pool");
const { requireAuth, requireRole } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth, requireRole("ADMIN"));

// Admin-only, paginated audit trail (plan §2)
router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const params = [];
    let where = "TRUE";
    if (req.query.entity) {
      params.push(req.query.entity);
      where = `a.entity = $${params.length}`;
      if (req.query.entityId) {
        params.push(Number(req.query.entityId));
        where += ` AND a.entity_id = $${params.length}`;
      }
    }
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT a.*, u.name AS user_name FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where}
        ORDER BY a.timestamp DESC, a.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const count = await query(`SELECT count(*)::int AS n FROM audit_log a WHERE ${where}`, params.slice(0, -2));
    res.json({ entries: rows, total: count.rows[0].n });
  } catch (err) { next(err); }
});

module.exports = router;
