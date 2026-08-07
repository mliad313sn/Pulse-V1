"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const allocBody = z.object({
  user_id: z.number().int().positive(),
  workstream_id: z.number().int().positive().nullable().optional(),
  start_date: dateStr,
  end_date: dateStr,
  percent: z.number().int().min(1).max(100),
  role: z.string().max(120).nullable().optional(),
});

router.post("/projects/:projectId/allocations", withProjectAccess(), async (req, res, next) => {
  try {
    const allocation = await service.allocate(req.user, req.projectAccess, allocBody.parse(req.body));
    res.status(201).json({ allocation });
  } catch (err) { next(err); }
});

router.put("/allocations/:id", async (req, res, next) => {
  try {
    const parsed = allocBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ allocation: await service.updateAllocation(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

router.get("/reports/workload", async (req, res, next) => {
  try {
    res.json({ rows: await service.workload(req.user, { overloadedOnly: req.query.overloaded === "true" }) });
  } catch (err) { next(err); }
});

const timeBody = z.object({
  project_id: z.number().int().positive(),
  workstream_id: z.number().int().positive().nullable().optional(),
  task_id: z.number().int().positive().nullable().optional(),
  entry_date: dateStr,
  hours: z.number().gt(0).max(24),
  description: z.string().max(500).nullable().optional(),
});
router.post("/time-entries", async (req, res, next) => {
  try {
    const entry = await service.logTime(req.user, timeBody.parse(req.body));
    res.status(201).json({ entry });
  } catch (err) { next(err); }
});

router.get("/projects/:projectId/time-summary", withProjectAccess(), async (req, res, next) => {
  try {
    res.json(await service.timeSummary(req.projectAccess));
  } catch (err) { next(err); }
});

module.exports = router;
