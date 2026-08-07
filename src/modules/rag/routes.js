"use strict";
const express = require("express");
const { requireAuth, requireRole, withProjectAccess } = require("../../middleware/authz");
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
module.exports.health = (() => {
  // SPM P5 — Health 2.0 lives on the project resource, so it is mounted with
  // the other /projects routes rather than under /rag.
  const r = express.Router();
  r.use(requireAuth);
  r.get("/projects/:projectId/health", withProjectAccess(), async (req, res, next) => {
    try {
      res.json(await require("./healthService").projectHealth(req.user, req.projectAccess));
    } catch (err) { next(err); }
  });
  return r;
})();
