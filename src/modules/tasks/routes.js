"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const wsBody = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  lead_user_id: z.number().int().positive().nullable().optional(),
  start_date: dateStr,
  end_date: dateStr,
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
});

const taskBody = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  workstream_id: z.number().int().positive().nullable().optional(),
  milestone_id: z.number().int().positive().nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  planned_start: dateStr,
  planned_finish: dateStr,
  actual_start: dateStr,
  actual_finish: dateStr,
  estimated_hours: z.number().min(0).max(10000).nullable().optional(),
  actual_hours: z.number().min(0).max(10000).nullable().optional(),
  priority: z.enum(["P1", "P2", "P3"]).optional(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
});

router.get("/projects/:projectId/plan", withProjectAccess(), async (req, res, next) => {
  try { res.json(await service.getPlan(req.projectAccess)); } catch (err) { next(err); }
});

router.post("/projects/:projectId/workstreams", withProjectAccess(), async (req, res, next) => {
  try {
    const workstream = await service.createWorkstream(req.user, req.projectAccess, wsBody.parse(req.body));
    res.status(201).json({ workstream });
  } catch (err) { next(err); }
});

router.put("/workstreams/:id", async (req, res, next) => {
  try {
    const parsed = wsBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ workstream: await service.updateWorkstream(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

router.post("/projects/:projectId/tasks", withProjectAccess(), async (req, res, next) => {
  try {
    const task = await service.createTask(req.user, req.projectAccess, taskBody.parse(req.body));
    res.status(201).json({ task });
  } catch (err) { next(err); }
});

router.put("/tasks/:id", async (req, res, next) => {
  try {
    const parsed = taskBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ task: await service.updateTask(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

const depBody = z.object({
  predecessor_task_id: z.number().int().positive(),
  successor_task_id: z.number().int().positive(),
  dep_type: z.enum(["FS", "SS", "FF", "SF"]).optional(),
  lag_days: z.number().int().min(-365).max(365).optional(),
});
router.post("/projects/:projectId/dependencies", withProjectAccess(), async (req, res, next) => {
  try {
    const dependency = await service.addDependency(req.user, req.projectAccess, depBody.parse(req.body));
    res.status(201).json({ dependency });
  } catch (err) { next(err); }
});

router.delete("/projects/:projectId/dependencies/:depId", withProjectAccess(), async (req, res, next) => {
  try {
    await service.removeDependency(req.user, req.projectAccess, Number(req.params.depId));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
