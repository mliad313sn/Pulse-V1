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
  description: z.string().max(2000).nullable().optional(),
  due_date: dateStr,
  status: z.enum(["PENDING", "IN_PROGRESS", "DELIVERED"]).optional(),
});

router.get("/projects/:projectId/deliverables", withProjectAccess(), async (req, res, next) => {
  try {
    res.json({ deliverables: await service.listForProject(req.projectAccess) });
  } catch (err) { next(err); }
});

router.post("/projects/:projectId/deliverables", withProjectAccess(), async (req, res, next) => {
  try {
    const deliverable = await service.createDeliverable(req.user, req.projectAccess, body.parse(req.body));
    res.status(201).json({ deliverable });
  } catch (err) { next(err); }
});

router.put("/deliverables/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    const deliverable = await service.updateDeliverable(req.user, Number(req.params.id), patch, updated_at);
    res.json({ deliverable });
  } catch (err) { next(err); }
});

const raciBody = z.object({
  assignments: z.array(z.object({
    user_id: z.number().int().positive(),
    raci_role: z.enum(["R", "A", "C", "I"]),
  })).max(50),
});
router.put("/deliverables/:id/raci", async (req, res, next) => {
  try {
    await service.setRaci(req.user, Number(req.params.id), raciBody.parse(req.body).assignments);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// OpsPm360 War Room dashboard
router.get("/warroom", async (req, res, next) => {
  try {
    res.json(await service.warRoom(req.user));
  } catch (err) { next(err); }
});

module.exports = router;
