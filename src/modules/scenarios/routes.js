"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/scenarios", async (req, res, next) => {
  try { res.json({ scenarios: await service.list() }); }
  catch (err) { next(err); }
});

router.post("/scenarios", async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().max(2000).nullable().optional(),
      moves: z.array(z.object({
        project_id: z.number().int().positive(),
        action: z.enum(["DEFER", "STOP", "BUDGET_DELTA"]),
        months: z.number().int().min(1).max(36).optional(),
        amount: z.number().optional(),
      })).max(50).optional(),
    }).parse(req.body);
    res.status(201).json({ scenario: await service.create(req.user, body) });
  } catch (err) { next(err); }
});

router.get("/scenarios/:id/evaluate", async (req, res, next) => {
  try { res.json(await service.evaluate(req.user, Number(req.params.id))); }
  catch (err) { next(err); }
});

router.post("/scenarios/optimize", async (req, res, next) => {
  try {
    const { budget } = z.object({ budget: z.number().positive() }).parse(req.body);
    res.json(await service.optimize(req.user, budget));
  } catch (err) { next(err); }
});

router.post("/scenarios/:id/decision", async (req, res, next) => {
  try {
    const { decision, note, updated_at } = z.object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      note: z.string().min(5).max(2000),
      updated_at: z.string(),
    }).parse(req.body);
    res.json({ scenario: await service.decide(req.user, Number(req.params.id), decision, note, updated_at) });
  } catch (err) { next(err); }
});

router.post("/scenarios/:id/promote", async (req, res, next) => {
  try { res.json(await service.promote(req.user, Number(req.params.id))); }
  catch (err) { next(err); }
});

module.exports = router;
