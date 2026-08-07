"use strict";
// SPM Phase 9 — Pulse Intelligence endpoints. All read-only: AI drafts,
// humans decide. Project visibility/confidentiality enforced by
// withProjectAccess; finance masking happens inside gatherFacts.
const express = require("express");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

// Is AI configured on this deployment? (UI hides the buttons when not)
router.get("/ai/status", (req, res) => {
  res.json({ enabled: service.aiEnabled(), model: service.MODEL });
});

// Draft a source-grounded executive summary for one project
router.post("/projects/:projectId/ai/summary", withProjectAccess(), async (req, res, next) => {
  try { res.json(await service.draftExecutiveSummary(req.user, req.projectAccess)); }
  catch (err) { next(err); }
});

module.exports = router;
