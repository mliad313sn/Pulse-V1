"use strict";
const express = require("express");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/division-workload", async (req, res, next) => {
  try { res.json({ rows: await service.divisionWorkload(req.user, req.query.site) }); }
  catch (err) { next(err); }
});

router.get("/rag-trend", async (req, res, next) => {
  try {
    const weeks = Math.min(Number(req.query.weeks) || 12, 52);
    res.json({ rows: await service.ragTrend(req.user, req.query.site, weeks) });
  } catch (err) { next(err); }
});

router.get("/roadblock-aging", async (req, res, next) => {
  try { res.json({ rows: await service.roadblockAging(req.user, req.query.site) }); }
  catch (err) { next(err); }
});

router.get("/action-resolution", async (req, res, next) => {
  try { res.json({ rows: await service.actionResolution(req.user, req.query.site) }); }
  catch (err) { next(err); }
});

router.get("/site-breakdown", async (req, res, next) => {
  try { res.json({ rows: await service.siteBreakdown(req.user) }); }
  catch (err) { next(err); }
});

router.get("/site-lens", async (req, res, next) => {
  try {
    if (!req.query.site) return res.status(400).json({ error: "site query parameter required" });
    res.json(await service.siteLens(req.user, req.query.site));
  } catch (err) { next(err); }
});

module.exports = router;
