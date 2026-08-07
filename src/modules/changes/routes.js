"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/projects/:projectId/baselines", withProjectAccess(), async (req, res, next) => {
  try { res.json(await service.listBaselines(req.projectAccess)); }
  catch (err) { next(err); }
});

router.post("/projects/:projectId/baselines", withProjectAccess(), async (req, res, next) => {
  try {
    const { label } = z.object({ label: z.string().trim().min(1).max(200).optional() }).parse(req.body);
    res.status(201).json({ baseline: await service.captureBaseline(req.user, req.projectAccess, label) });
  } catch (err) { next(err); }
});

const crBody = z.object({
  type: z.enum(["SCOPE", "SCHEDULE", "BUDGET", "BENEFIT", "RESOURCE", "CANCELLATION"]),
  title: z.string().trim().min(1).max(300),
  rationale: z.string().min(10).max(5000),
  impact_analysis: z.string().max(5000).nullable().optional(),
  affected_milestones: z.string().max(2000).nullable().optional(),
  cost_impact: z.number().nullable().optional(),
  schedule_impact_days: z.number().int().nullable().optional(),
  risk_impact: z.string().max(2000).nullable().optional(),
});

router.get("/projects/:projectId/change-requests", withProjectAccess(), async (req, res, next) => {
  try { res.json({ changeRequests: await service.listChangeRequests(req.projectAccess) }); }
  catch (err) { next(err); }
});

router.post("/projects/:projectId/change-requests", withProjectAccess(), async (req, res, next) => {
  try {
    const cr = await service.createChangeRequest(req.user, req.projectAccess, crBody.parse(req.body));
    res.status(201).json({ changeRequest: cr });
  } catch (err) { next(err); }
});

router.post("/projects/:projectId/change-requests/:id/decision", withProjectAccess(), async (req, res, next) => {
  try {
    const { decision, note, updated_at } = z.object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      note: z.string().min(5).max(2000),
      updated_at: z.string(),
    }).parse(req.body);
    res.json(await service.decideChangeRequest(
      req.user, req.projectAccess, Number(req.params.id), decision, note, updated_at));
  } catch (err) { next(err); }
});

module.exports = router;
