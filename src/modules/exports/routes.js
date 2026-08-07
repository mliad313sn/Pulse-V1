"use strict";
const express = require("express");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Filters only — project IDs are never accepted (server resolves scope, §85)
function filtersFrom(req) {
  return {
    division: req.query.division, site: req.query.site, stage: req.query.stage,
    rag: req.query.rag, priority: req.query.priority, pm: req.query.pm,
    portfolio: req.query.portfolio, program: req.query.program,
    q: req.query.q, includeClosed: req.query.includeClosed === "true",
  };
}

function send(res, format, out) {
  res.setHeader("Content-Type", MIME[format]);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("X-Export-Rows", String(out.rows));
  res.send(out.buffer);
}

router.get("/portfolio.xlsx", async (req, res, next) => {
  try { send(res, "xlsx", await service.portfolioXlsx(req.user, filtersFrom(req))); }
  catch (err) { next(err); }
});

router.get("/portfolio.pdf", async (req, res, next) => {
  try { send(res, "pdf", await service.portfolioPdf(req.user, filtersFrom(req))); }
  catch (err) { next(err); }
});

router.get("/portfolio.pptx", async (req, res, next) => {
  try { send(res, "pptx", await service.portfolioPptx(req.user, filtersFrom(req))); }
  catch (err) { next(err); }
});

module.exports = router;
