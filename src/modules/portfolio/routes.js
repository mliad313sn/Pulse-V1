"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

router.get("/pillars", async (req, res, next) => {
  try { res.json({ pillars: await service.listPillars() }); }
  catch (err) { next(err); }
});

router.post("/pillars", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(1000).nullable().optional(),
    }).parse(req.body);
    res.status(201).json({ pillar: await service.createPillar(req.user, body) });
  } catch (err) { next(err); }
});

const portfolioBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  objective: z.string().max(2000).nullable().optional(),
  pillar_id: z.number().int().positive().nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  horizon_start: dateStr,
  horizon_end: dateStr,
});

router.get("/portfolios", async (req, res, next) => {
  try { res.json({ portfolios: await service.listPortfolios(req.user) }); }
  catch (err) { next(err); }
});

router.post("/portfolios", async (req, res, next) => {
  try {
    res.status(201).json({ portfolio: await service.createPortfolio(req.user, portfolioBody.parse(req.body)) });
  } catch (err) { next(err); }
});

router.put("/portfolios/:id", async (req, res, next) => {
  try {
    const parsed = portfolioBody.partial().extend({ updated_at: z.string() }).parse(req.body);
    const { updated_at, ...patch } = parsed;
    res.json({ portfolio: await service.updatePortfolio(req.user, Number(req.params.id), patch, updated_at) });
  } catch (err) { next(err); }
});

const programBody = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().max(2000).nullable().optional(),
  portfolio_id: z.number().int().positive(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  horizon_start: dateStr,
  horizon_end: dateStr,
});

router.get("/programs", async (req, res, next) => {
  try {
    const pf = req.query.portfolio ? Number(req.query.portfolio) : null;
    res.json({ programs: await service.listPrograms(req.user, pf) });
  } catch (err) { next(err); }
});

router.post("/programs", async (req, res, next) => {
  try {
    res.status(201).json({ program: await service.createProgram(req.user, programBody.parse(req.body)) });
  } catch (err) { next(err); }
});

module.exports = router;
