"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const body = z.object({
  title: z.string().trim().min(1).max(300),
  problem: z.string().max(4000).nullable().optional(),
  outcome_hypothesis: z.string().max(4000).nullable().optional(),
  division_id: z.number().int().positive().nullable().optional(),
  site_id: z.number().int().positive().nullable().optional(),
  estimated_cost: z.number().min(0).nullable().optional(),
  estimated_effort_weeks: z.number().min(0).nullable().optional(),
  business_value: z.number().int().min(1).max(10).nullable().optional(),
  time_criticality: z.number().int().min(1).max(10).nullable().optional(),
  risk_reduction: z.number().int().min(1).max(10).nullable().optional(),
  reach: z.number().int().min(0).nullable().optional(),
  impact: z.number().min(0).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  cost_of_delay_week: z.number().min(0).nullable().optional(),
  mandatory: z.boolean().optional(),
  mandatory_reason: z.string().max(1000).nullable().optional(),
});

router.get("/demands", async (req, res, next) => {
  try { res.json({ demands: await service.list(req.query.status) }); }
  catch (err) { next(err); }
});

router.get("/demands/ranked", async (req, res, next) => {
  try { res.json({ model: req.query.model || "wsjf", demands: await service.ranked(req.query.model || "wsjf") }); }
  catch (err) { next(err); }
});

router.post("/demands", async (req, res, next) => {
  try { res.status(201).json({ demand: await service.create(req.user, body.parse(req.body)) }); }
  catch (err) { next(err); }
});

router.put("/demands/:id", async (req, res, next) => {
  try {
    const parsed = body.partial().extend({
      updated_at: z.string(),
      status: z.enum(["SUBMITTED"]).optional(), // draft -> submitted only
    }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ demand: await service.update(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

router.post("/demands/:id/decision", async (req, res, next) => {
  try {
    const { decision, note, updated_at } = z.object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      note: z.string().min(5).max(2000),
      updated_at: z.string(),
    }).parse(req.body);
    res.json({ demand: await service.decide(req.user, Number(req.params.id), decision, note, updated_at) });
  } catch (err) { next(err); }
});

router.post("/demands/:id/convert", async (req, res, next) => {
  try {
    const input = z.object({
      title: z.string().trim().min(1).max(300).optional(),
      lead_division_id: z.number().int().positive().optional(),
      governance: z.enum(["LITE", "STANDARD"]).optional(),
      project_manager_id: z.number().int().positive().nullable().optional(),
    }).parse(req.body || {});
    res.status(201).json(await service.convert(req.user, Number(req.params.id), input));
  } catch (err) { next(err); }
});

module.exports = router;
