"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const body = z.object({
  issue: z.string().min(1).max(2000),
  source_type: z.enum(["ROADBLOCK", "RISK", "AUDIT", "INCIDENT", "REVIEW", "MANUAL"]).optional(),
  roadblock_id: z.number().int().positive().nullable().optional(),
  risk_id: z.number().int().positive().nullable().optional(),
  root_cause: z.string().max(2000).nullable().optional(),
  immediate_correction: z.string().max(2000).nullable().optional(),
  corrective_action: z.string().max(2000).nullable().optional(),
  preventive_action: z.string().max(2000).nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  verifier_user_id: z.number().int().positive().nullable().optional(),
  due_date: dateStr,
  status: z.enum(["OPEN", "ANALYSIS", "ACTION_PLANNED", "IMPLEMENTATION", "VERIFICATION", "CLOSED"]).optional(),
  evidence: z.string().max(2000).nullable().optional(),
  verification_date: dateStr,
  effectiveness: z.enum(["EFFECTIVE", "PARTIALLY_EFFECTIVE", "NOT_EFFECTIVE"]).nullable().optional(),
});

router.get("/projects/:projectId/capas", withProjectAccess(), async (req, res, next) => {
  try { res.json({ capas: await service.listForProject(req.projectAccess) }); }
  catch (err) { next(err); }
});

router.post("/projects/:projectId/capas", withProjectAccess(), async (req, res, next) => {
  try {
    const capa = await service.createCapa(req.user, req.projectAccess, body.parse(req.body));
    res.status(201).json({ capa });
  } catch (err) { next(err); }
});

router.put("/capas/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    const capa = await service.updateCapa(req.user, Number(req.params.id), patch, updated_at);
    res.json({ capa });
  } catch (err) { next(err); }
});

module.exports = router;
