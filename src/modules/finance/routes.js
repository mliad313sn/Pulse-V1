"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth, withProjectAccess } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const money = z.number().min(0).max(1e12);

const lineBody = z.object({
  category: z.enum(["Hardware", "Software", "Professional Services", "Telecom", "Travel",
    "Training", "Internal Resource", "Contingency", "Other"]),
  capex_opex: z.enum(["CAPEX", "OPEX"]).optional(),
  currency: z.string().length(3).optional(),
  approved: money.optional(),
  committed: money.optional(),
  actual: money.optional(),
  forecast: money.optional(),
  note: z.string().max(500).nullable().optional(),
});

router.get("/projects/:projectId/financials", withProjectAccess(), async (req, res, next) => {
  try { res.json(await service.financials(req.user, req.projectAccess)); }
  catch (err) { next(err); }
});

router.post("/projects/:projectId/budget-lines", withProjectAccess(), async (req, res, next) => {
  try {
    const line = await service.addLine(req.user, req.projectAccess, lineBody.parse(req.body));
    res.status(201).json({ line });
  } catch (err) { next(err); }
});

router.put("/budget-lines/:id", async (req, res, next) => {
  try {
    const parsed = lineBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ line: await service.updateLine(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

const benefitBody = z.object({
  title: z.string().min(1).max(300),
  owner_user_id: z.number().int().positive().nullable().optional(),
  baseline: z.number().nullable().optional(),
  target: z.number().nullable().optional(),
  unit: z.string().max(60).nullable().optional(),
  measure_method: z.string().max(300).nullable().optional(),
  target_date: dateStr,
  actual: z.number().nullable().optional(),
  status: z.enum(["DEFINED", "ON_TRACK", "AT_RISK", "ACHIEVED", "MISSED"]).optional(),
});

router.get("/projects/:projectId/benefits", withProjectAccess(), async (req, res, next) => {
  try { res.json({ benefits: await service.listBenefits(req.projectAccess) }); }
  catch (err) { next(err); }
});

router.post("/projects/:projectId/benefits", withProjectAccess(), async (req, res, next) => {
  try {
    const benefit = await service.addBenefit(req.user, req.projectAccess, benefitBody.parse(req.body));
    res.status(201).json({ benefit });
  } catch (err) { next(err); }
});

router.put("/benefits/:id", async (req, res, next) => {
  try {
    const parsed = benefitBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ benefit: await service.updateBenefit(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

// ===== SPM P4: cost plan + EVM =====
router.put("/projects/:projectId/cost-plan", withProjectAccess(), async (req, res, next) => {
  try {
    const { periods } = z.object({
      periods: z.array(z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        planned: z.number().min(0),
      })).max(120),
    }).parse(req.body);
    res.json({ periods: await service.setCostPlan(req.user, req.projectAccess, periods) });
  } catch (err) { next(err); }
});

router.get("/projects/:projectId/evm", withProjectAccess(), async (req, res, next) => {
  try { res.json(await service.evm(req.user, req.projectAccess, req.query.asOf)); }
  catch (err) { next(err); }
});

// ===== FX rates (Phase 0 multicurrency) =====
router.get("/fx-rates", async (req, res, next) => {
  try { res.json({ rates: await service.listFxRates() }); }
  catch (err) { next(err); }
});

router.put("/fx-rates/:currency", async (req, res, next) => {
  try {
    const { rate } = z.object({ rate: z.number().positive() }).parse(req.body);
    res.json({ rate: await service.setFxRate(req.user, String(req.params.currency).toUpperCase(), rate) });
  } catch (err) { next(err); }
});

module.exports = router;
