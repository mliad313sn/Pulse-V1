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
  description: z.string().max(5000).nullable().optional(),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]),
  owner_user_id: z.number().int().positive().nullable().optional(),
  raised_by_division_id: z.number().int().positive().nullable().optional(),
  due_date: dateStr,
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "ESCALATED"]).optional(),
  resolution_note: z.string().max(2000).nullable().optional(),
  escalated_to: z.number().int().positive().nullable().optional(),
});

router.post("/projects/:projectId/roadblocks", withProjectAccess(), async (req, res, next) => {
  try {
    const roadblock = await service.createRoadblock(req.user, req.projectAccess, body.parse(req.body));
    res.status(201).json({ roadblock });
  } catch (err) { next(err); }
});

router.put("/roadblocks/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    const roadblock = await service.updateRoadblock(req.user, Number(req.params.id), patch, updated_at);
    res.json({ roadblock });
  } catch (err) { next(err); }
});

router.post("/roadblocks/:id/escalate", async (req, res, next) => {
  try {
    const roadblock = await service.escalateRoadblock(req.user, Number(req.params.id));
    res.json({ roadblock });
  } catch (err) { next(err); }
});

router.delete("/roadblocks/:id", async (req, res, next) => {
  try {
    await service.softDeleteRoadblock(req.user, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
