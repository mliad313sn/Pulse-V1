"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/objectives", async (req, res, next) => {
  try { res.json({ objectives: await service.board(req.query.period) }); }
  catch (err) { next(err); }
});

router.post("/objectives", async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().max(2000).nullable().optional(),
      pillar_id: z.number().int().positive().nullable().optional(),
      owner_user_id: z.number().int().positive().nullable().optional(),
      period: z.string().trim().min(4).max(20),
    }).parse(req.body);
    res.status(201).json({ objective: await service.createObjective(req.user, body) });
  } catch (err) { next(err); }
});

const krBody = z.object({
  title: z.string().trim().min(1).max(300),
  baseline: z.number(),
  target: z.number(),
  current: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
});

router.post("/objectives/:id/key-results", async (req, res, next) => {
  try {
    res.status(201).json({ keyResult: await service.addKeyResult(req.user, Number(req.params.id), krBody.parse(req.body)) });
  } catch (err) { next(err); }
});

router.put("/key-results/:id", async (req, res, next) => {
  try {
    const parsed = krBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ keyResult: await service.updateKeyResult(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

router.post("/projects/:projectId/objectives/:objectiveId", withProjectAccess(), async (req, res, next) => {
  try {
    await service.linkProject(req.user, req.projectAccess, Number(req.params.objectiveId), false);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/projects/:projectId/objectives/:objectiveId", withProjectAccess(), async (req, res, next) => {
  try {
    await service.linkProject(req.user, req.projectAccess, Number(req.params.objectiveId), true);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
