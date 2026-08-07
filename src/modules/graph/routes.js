"use strict";
const express = require("express");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/projects/:projectId/graph", withProjectAccess(), async (req, res, next) => {
  try { res.json(await service.projectGraph(req.user, req.projectAccess)); }
  catch (err) { next(err); }
});

module.exports = router;
