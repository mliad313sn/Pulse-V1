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
  owner_user_id: z.number().int().positive(),
  due_date: dateStr,
  status: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
  done_date: dateStr,
  source: z.enum(["MEETING", "PROJECT", "ROADBLOCK"]).optional(),
  meeting_id: z.number().int().positive().nullable().optional(),
  roadblock_id: z.number().int().positive().nullable().optional(),
});

router.post("/projects/:projectId/actions", withProjectAccess(), async (req, res, next) => {
  try {
    const action = await service.createAction(req.user, body.parse(req.body), req.projectAccess);
    res.status(201).json({ action });
  } catch (err) { next(err); }
});

// general action (no project)
router.post("/actions", async (req, res, next) => {
  try {
    const action = await service.createAction(req.user, body.parse(req.body), null);
    res.status(201).json({ action });
  } catch (err) { next(err); }
});

router.put("/actions/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    const action = await service.updateAction(req.user, Number(req.params.id), patch, updated_at);
    res.json({ action });
  } catch (err) { next(err); }
});

router.delete("/actions/:id", async (req, res, next) => {
  try {
    await service.softDeleteAction(req.user, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// My Actions (plan §4.5)
router.get("/my-work", async (req, res, next) => {
  try {
    res.json(await service.myWork(req.user));
  } catch (err) { next(err); }
});

module.exports = router;
