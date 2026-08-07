"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess, canCreateProject } = require("../../middleware/authz");
const { forbidden } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const projectBody = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  lead_division_id: z.number().int().positive(),
  project_manager_id: z.number().int().positive().nullable().optional(),
  sponsor: z.string().max(200).nullable().optional(),
  stage: z.enum(["IDEA", "INITIATION", "PLANNING", "EXECUTION", "DEPLOYMENT", "RUN", "CLOSED"]).optional(),
  operating_status: z.enum(["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]).optional(),
  hold_reason: z.string().max(500).nullable().optional(),
  cancel_reason: z.string().max(500).nullable().optional(),
  priority: z.enum(["P1", "P2", "P3"]).optional(),
  start_date: dateStr,
  target_date: dateStr,
  actual_end_date: dateStr,
  budget_note: z.string().max(2000).nullable().optional(),
  roadmap_pillar: z.enum(["Network", "BizPartnering", "Risk", "People", "Other"]).nullable().optional(),
  confidential: z.boolean().optional(),
  rag_override: z.enum(["G", "A", "R"]).nullable().optional(),
  rag_override_reason: z.string().max(1000).nullable().optional(),
  exec_commentary: z.string().max(5000).nullable().optional(),
  portfolio_id: z.number().int().positive().nullable().optional(),
  program_id: z.number().int().positive().nullable().optional(),
  governance: z.enum(["LITE", "STANDARD"]).optional(),
  divisions: z.array(z.object({
    division_id: z.number().int().positive(),
    role_in_project: z.enum(["LEAD", "ENGAGED", "CONSULTED"]),
  })).optional(),
  sites: z.array(z.number().int().positive()).optional(),
});

// Portfolio (cap 500, plan §6)
router.get("/", async (req, res, next) => {
  try {
    const projects = await service.listPortfolio(req.user, {
      division: req.query.division, site: req.query.site, stage: req.query.stage,
      rag: req.query.rag, priority: req.query.priority, pm: req.query.pm,
      portfolio: req.query.portfolio, program: req.query.program,
      q: req.query.q, includeClosed: req.query.includeClosed === "true",
    });
    res.json({ projects });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    if (!canCreateProject(req.user)) throw forbidden("Only Admin or Division Leads create projects");
    const body = projectBody.parse(req.body);
    const project = await service.createProject(req.user, body);
    res.status(201).json({ project });
  } catch (err) { next(err); }
});

router.get("/:projectId", withProjectAccess(), async (req, res, next) => {
  try {
    res.json(await service.getDetail(req.projectAccess, req.user));
  } catch (err) { next(err); }
});

router.put("/:projectId", withProjectAccess(), async (req, res, next) => {
  try {
    const body = projectBody.partial()
      .extend({ updated_at: z.string(), stage_note: z.string().max(500).optional() })
      .parse(req.body);
    const { updated_at, divisions, sites, ...patch } = body;
    const project = await service.updateProject(req.user, req.projectAccess, patch, updated_at);
    if (divisions || sites) {
      await service.setMembership(req.user, req.projectAccess, { divisions, sites });
    }
    res.json({ project });
  } catch (err) { next(err); }
});

router.delete("/:projectId", withProjectAccess(), async (req, res, next) => {
  try {
    await service.softDeleteProject(req.user, req.projectAccess.project.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const updateBody = z.object({
  mood: z.enum(["ON_TRACK", "WATCH", "AT_RISK"]),
  summary: z.string().min(1).max(400),
});
router.post("/:projectId/updates", withProjectAccess(), async (req, res, next) => {
  try {
    const body = updateBody.parse(req.body);
    const update = await service.postStatusUpdate(req.user, req.projectAccess, body);
    res.status(201).json({ update });
  } catch (err) { next(err); }
});

const decisionBody = z.object({
  text: z.string().min(1).max(2000),
  decidedBy: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  meetingId: z.number().int().positive().optional(),
});
router.post("/:projectId/decisions", withProjectAccess(), async (req, res, next) => {
  try {
    const body = decisionBody.parse(req.body);
    const decision = await service.addDecision(req.user, req.projectAccess, body);
    res.status(201).json({ decision });
  } catch (err) { next(err); }
});

module.exports = router;
