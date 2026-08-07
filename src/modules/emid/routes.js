"use strict";
// PULSE ↔ SDP — identity register, capacity ledger and the import controls.
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const ledger = require("../resources/ledger");
const capacity = require("./capacityService");
const { requireAuth, requireRole } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

// ===== identity register =====
router.get("/emid/people", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json({ people: await service.listPeople({
      includeInactive: req.query.all === "true",
      siteCode: typeof req.query.site === "string" ? req.query.site : undefined,
      employment: typeof req.query.employment === "string" ? req.query.employment : undefined,
    }) });
  } catch (err) { next(err); }
});

router.post("/emid/people", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const body = z.object({
      display_name: z.string().trim().min(1).max(200),
      site_code: z.string().max(20).nullable().optional(),
      division_code: z.string().max(20).nullable().optional(),
      employment: z.enum(["STAFF", "CONTRACTOR", "SERVICE_ACCOUNT", "VENDOR"]).optional(),
      user_id: z.number().int().positive().nullable().optional(),
      upn: z.string().max(200).nullable().optional(),
      entra_oid: z.string().uuid().nullable().optional(),
    }).parse(req.body);
    res.status(201).json({ person: await service.createPerson(req.user, body) });
  } catch (err) { next(err); }
});

// ===== alias review queue =====
router.get("/emid/aliases/pending", requireRole("ADMIN"), async (req, res, next) => {
  try { res.json({ pending: await service.pendingAliases({ limit: Math.min(Number(req.query.limit) || 200, 500) }) }); }
  catch (err) { next(err); }
});

router.post("/emid/aliases/confirm", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { system, alias, person_id } = z.object({
      system: z.string().min(1).max(40),
      alias: z.string().min(1).max(300),
      person_id: z.number().int().positive(),
    }).parse(req.body);
    res.json({ alias: await service.confirmAlias(req.user, system, alias, person_id) });
  } catch (err) { next(err); }
});

router.post("/emid/aliases/reject", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { system, alias, note } = z.object({
      system: z.string().min(1).max(40),
      alias: z.string().min(1).max(300),
      note: z.string().max(500).optional(),
    }).parse(req.body);
    res.json({ alias: await service.rejectAlias(req.user, system, alias, note) });
  } catch (err) { next(err); }
});

router.post("/emid/aliases/resolve", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { system, aliases, auto_create } = z.object({
      system: z.enum(["SDP_TECHNICIAN", "SDP_USER", "PULSE_USER", "TRACKER", "MEETINGS", "INSPECTION"]),
      aliases: z.array(z.string().max(300)).max(5000),
      auto_create: z.boolean().optional(),
    }).parse(req.body);
    res.json(await service.resolveAliases(req.user, system, aliases, { autoCreate: auto_create === true }));
  } catch (err) { next(err); }
});

router.post("/emid/aliases/seed-known-pairs", requireRole("ADMIN"), async (req, res, next) => {
  try { res.json(await service.seedKnownPairs(req.user)); } catch (err) { next(err); }
});

// ===== gate measurements =====
router.get("/emid/coverage", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const r = await service.attributionCoverage({
      from: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : "2026-01-01",
    });
    if (r.available === false) return res.status(503).json(r);
    res.json(r);
  } catch (err) { next(err); }
});

router.get("/emid/unmapped-sites", requireRole("ADMIN"), async (req, res, next) => {
  try { res.json(await service.unmappedSiteLabels({})); } catch (err) { next(err); }
});

// ===== capacity ledger =====
// Readable by anyone who can see people; site-restricted accounts see only
// their own site, exactly as everywhere else in PULSE.
router.get("/reports/capacity-ledger", async (req, res, next) => {
  try {
    res.json(await ledger.capacityLedger(req.user, {
      from: /^\d{4}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : undefined,
      months: Math.min(Number(req.query.months) || 6, 25),
      siteCode: typeof req.query.site === "string" && req.query.site ? req.query.site : undefined,
      overloadedOnly: req.query.overloaded === "true",
    }));
  } catch (err) { next(err); }
});

router.get("/reports/unattributed-load", async (req, res, next) => {
  try {
    res.json(await ledger.unattributed({
      from: /^\d{4}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : undefined,
      months: Math.min(Number(req.query.months) || 6, 25),
    }));
  } catch (err) { next(err); }
});

// ===== person capacity (the HR facts) =====
router.get("/person-capacity", async (req, res, next) => {
  try {
    res.json({ rows: await capacity.listCapacity(req.user, {
      period: typeof req.query.period === "string" ? req.query.period : undefined,
    }) });
  } catch (err) { next(err); }
});

const capacityBody = z.object({
  user_id: z.number().int().positive(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  fte: z.number().min(0.01).max(1.5).optional(),
  standard_hours: z.number().min(1).max(400).optional(),
  leave_hours: z.number().min(0).max(400).optional(),
  training_hours: z.number().min(0).max(400).optional(),
  note: z.string().max(500).nullable().optional(),
});
router.put("/person-capacity", async (req, res, next) => {
  try { res.json({ capacity: await capacity.setCapacity(req.user, capacityBody.parse(req.body)) }); }
  catch (err) { next(err); }
});

// Bulk seed: give everyone a default month so nobody is invisible (test 10.3).
router.post("/person-capacity/seed", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { periods, standard_hours } = z.object({
      periods: z.array(z.string().regex(/^\d{4}-\d{2}$/)).min(1).max(36),
      standard_hours: z.number().min(1).max(400).optional(),
    }).parse(req.body);
    res.json(await capacity.seedDefaults(req.user, periods, standard_hours));
  } catch (err) { next(err); }
});

// ===== effort standards =====
router.get("/effort-standards", async (req, res, next) => {
  try { res.json({ standards: await capacity.listEffortStandards() }); } catch (err) { next(err); }
});

router.post("/effort-standards", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const body = z.object({
      request_type: z.string().min(1).max(100),
      category: z.string().min(1).max(120),
      minutes: z.number().int().min(5).max(480),
      valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rationale: z.string().min(20).max(1000),
    }).parse(req.body);
    res.status(201).json({ standard: await capacity.setEffortStandard(req.user, body) });
  } catch (err) { next(err); }
});

// ===== imports =====
router.post("/emid/import/bau", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const r = await require("../../jobs/bauImport").runOnce(req.user);
    res.status(r.ok === false && r.code === "BLOCKED_EXTERNAL" ? 503 : 200).json(r);
  } catch (err) { next(err); }
});

router.post("/emid/import/demand", async (req, res, next) => {
  try {
    const { dry_run } = z.object({ dry_run: z.boolean().optional() }).parse(req.body || {});
    const r = await require("./demandImport").importMeetingDemand(req.user, { dryRun: dry_run === true });
    res.status(r.code === "BLOCKED_EXTERNAL" ? 503 : 200).json(r);
  } catch (err) { next(err); }
});

router.post("/emid/import/inspection-findings", async (req, res, next) => {
  try {
    const { dry_run } = z.object({ dry_run: z.boolean().optional() }).parse(req.body || {});
    const r = await require("./controls").importInspectionFindings(req.user, { dryRun: dry_run === true });
    res.status(r.code === "BLOCKED_EXTERNAL" ? 503 : 200).json(r);
  } catch (err) { next(err); }
});

router.post("/emid/import/actions", async (req, res, next) => {
  try {
    const { dry_run } = z.object({ dry_run: z.boolean().optional() }).parse(req.body || {});
    const r = await require("./controls").importActions(req.user, { dryRun: dry_run === true });
    res.status(r.code === "BLOCKED_EXTERNAL" ? 503 : 200).json(r);
  } catch (err) { next(err); }
});

// ===== governance controls =====
router.get("/controls/go-live-without-change", async (req, res, next) => {
  try {
    const r = await require("./controls").goLiveWithoutChange(req.user, {
      horizonDays: Math.min(Number(req.query.horizon) || 14, 180),
    });
    res.status(r.code === "BLOCKED_EXTERNAL" ? 503 : 200).json(r);
  } catch (err) { next(err); }
});

router.get("/controls/tracker-initiatives", async (req, res, next) => {
  try {
    res.json(await require("./controls").trackerProjectInitiatives(req.user, {
      year: Number(req.query.year) || undefined,
    }));
  } catch (err) { next(err); }
});

router.get("/controls/ticket-benefit", async (req, res, next) => {
  try {
    const q = z.object({
      site: z.string().max(20).optional(),
      category: z.string().max(120).optional(),
      before_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      before_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      after_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      after_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.query);
    const r = await require("./controls").measureTicketBenefit(req.user, {
      siteCode: q.site, category: q.category,
      beforeFrom: q.before_from, beforeTo: q.before_to,
      afterFrom: q.after_from, afterTo: q.after_to,
    });
    res.status(r.code === "BLOCKED_EXTERNAL" ? 503 : 200).json(r);
  } catch (err) { next(err); }
});

module.exports = router;
