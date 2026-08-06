"use strict";
const express = require("express");
const { requireAuth, requireRole } = require("../../middleware/authz");
const { recompute } = require("./service");
const { query } = require("../../db/pool");

const router = express.Router();
router.use(requireAuth);

// Admin utility: force-recompute all projects (e.g. after a data import)
router.post("/recompute-all", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM projects WHERE deleted_at IS NULL`);
    for (const r of rows) await recompute(r.id, req.user.id);
    res.json({ recomputed: rows.length });
  } catch (err) { next(err); }
});

module.exports = router;
