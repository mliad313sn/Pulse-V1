"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const body = z.object({
  title: z.string().min(1).max(300),
  type: z.enum(["STANDARD", "SECURITY_GATE", "SITE_READINESS", "UAT", "GO_LIVE"]).optional(),
  owner_division_id: z.number().int().positive().nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  co_owner_user_id: z.number().int().positive().nullable().optional(),
  site_id: z.number().int().positive().nullable().optional(),
  due_date: dateStr,
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE", "SLIPPED"]).optional(),
  done_date: dateStr,
  order_index: z.number().int().optional(),
});

router.post("/projects/:projectId/milestones", withProjectAccess(), async (req, res, next) => {
  try {
    const milestone = await service.createMilestone(req.user, req.projectAccess, body.parse(req.body));
    res.status(201).json({ milestone });
  } catch (err) { next(err); }
});

router.put("/milestones/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    const milestone = await service.updateMilestone(req.user, Number(req.params.id), patch, updated_at);
    res.json({ milestone });
  } catch (err) { next(err); }
});

router.delete("/milestones/:id", async (req, res, next) => {
  try {
    await service.softDeleteMilestone(req.user, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put("/readiness/:id", async (req, res, next) => {
  try {
    const { checked } = z.object({ checked: z.boolean() }).parse(req.body);
    const item = await service.setReadiness(req.user, Number(req.params.id), checked);
    res.json({ item });
  } catch (err) { next(err); }
});

module.exports = router;
