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
  commitment: z.enum(["COMMITTED", "TENTATIVE"]).optional(),
});

// Non-project time (BAU, leave) — capacity is only honest if it is booked too
const nonProjectBody = z.object({
  user_id: z.number().int().positive(),
  allocation_type: z.enum(["BAU", "LEAVE"]),
  start_date: dateStr,
  end_date: dateStr,
  percent: z.number().int().min(1).max(100),
  role: z.string().max(120).nullable().optional(),
});
router.post("/allocations/non-project", async (req, res, next) => {
  try {
    const allocation = await service.allocateNonProject(req.user, nonProjectBody.parse(req.body));
    res.status(201).json({ allocation });
  } catch (err) { next(err); }
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

// ===== SPM P3 — capacity intelligence =====
const cap = require("./capacityService");

router.get("/skills", async (req, res, next) => {
  try { res.json({ skills: await cap.listSkills() }); } catch (err) { next(err); }
});

router.post("/skills", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      category: z.string().max(80).nullable().optional(),
    }).parse(req.body);
    res.status(201).json({ skill: await cap.createSkill(req.user, body) });
  } catch (err) { next(err); }
});

router.get("/users/:userId/skills", async (req, res, next) => {
  try { res.json({ skills: await cap.userSkills(Number(req.params.userId)) }); } catch (err) { next(err); }
});

router.put("/users/:userId/skills", async (req, res, next) => {
  try {
    const body = z.object({
      skill_id: z.number().int().positive(),
      proficiency: z.number().int().min(1).max(5),
      years_experience: z.number().min(0).max(60).nullable().optional(),
      certified: z.boolean().optional(),
      certification_name: z.string().max(200).nullable().optional(),
      certification_expires: dateStr.nullable().optional(),
    }).parse(req.body);
    res.json({ skill: await cap.setUserSkill(req.user, Number(req.params.userId), body) });
  } catch (err) { next(err); }
});

router.get("/reports/capacity", async (req, res, next) => {
  try {
    res.json(await cap.capacityForecast(req.user, {
      from: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : undefined,
      periods: Math.min(Number(req.query.periods) || 6, 24),
      grain: req.query.grain === "week" ? "week" : "month",
      overloadedOnly: req.query.overloaded === "true",
    }));
  } catch (err) { next(err); }
});

router.get("/reports/skill-gap", async (req, res, next) => {
  try { res.json({ rows: await cap.skillGap(req.user) }); } catch (err) { next(err); }
});

const requestBody = z.object({
  role: z.string().trim().min(1).max(120),
  skill_id: z.number().int().positive().nullable().optional(),
  min_proficiency: z.number().int().min(1).max(5).nullable().optional(),
  percent: z.number().int().min(1).max(100),
  start_date: dateStr,
  end_date: dateStr,
  site_id: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
router.post("/projects/:projectId/resource-requests", withProjectAccess(), async (req, res, next) => {
  try {
    const request = await cap.createRequest(req.user, req.projectAccess, requestBody.parse(req.body));
    res.status(201).json({ request });
  } catch (err) { next(err); }
});

router.get("/resource-requests", async (req, res, next) => {
  try {
    res.json({ requests: await cap.listRequests(req.user, {
      projectId: Number(req.query.project_id) || undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    }) });
  } catch (err) { next(err); }
});

router.post("/resource-requests/:id/decision", async (req, res, next) => {
  try {
    const { decision, note, updated_at } = z.object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      note: z.string().min(5).max(2000),
      updated_at: z.string(),
    }).parse(req.body);
    res.json({ request: await cap.decideRequest(req.user, Number(req.params.id), decision, note, updated_at) });
  } catch (err) { next(err); }
});

router.get("/resource-requests/:id/candidates", async (req, res, next) => {
  try { res.json(await cap.matchCandidates(req.user, Number(req.params.id))); } catch (err) { next(err); }
});

router.post("/resource-requests/:id/fulfil", async (req, res, next) => {
  try {
    const { user_id } = z.object({ user_id: z.number().int().positive() }).parse(req.body);
    res.json(await cap.fulfilRequest(req.user, Number(req.params.id), user_id));
  } catch (err) { next(err); }
});

module.exports = router;
