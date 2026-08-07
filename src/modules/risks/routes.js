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
  category: z.enum(["TECHNICAL", "SECURITY", "SCHEDULE", "FINANCIAL", "RESOURCE", "VENDOR", "OPERATIONAL", "OTHER"]).optional(),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  treatment: z.enum(["AVOID", "MITIGATE", "TRANSFER", "ACCEPT"]).nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  target_date: dateStr,
  residual_probability: z.number().int().min(1).max(5).nullable().optional(),
  residual_impact: z.number().int().min(1).max(5).nullable().optional(),
  status: z.enum(["OPEN", "MITIGATING", "CLOSED", "REALISED"]).optional(),
});

router.get("/projects/:projectId/risks", withProjectAccess(), async (req, res, next) => {
  try { res.json({ risks: await service.listForProject(req.projectAccess) }); }
  catch (err) { next(err); }
});

router.post("/projects/:projectId/risks", withProjectAccess(), async (req, res, next) => {
  try {
    const risk = await service.createRisk(req.user, req.projectAccess, body.parse(req.body));
    res.status(201).json({ risk });
  } catch (err) { next(err); }
});

router.put("/risks/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    const risk = await service.updateRisk(req.user, Number(req.params.id), patch, updated_at);
    res.json({ risk });
  } catch (err) { next(err); }
});

module.exports = router;
