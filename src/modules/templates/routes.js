"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/project-templates", async (req, res, next) => {
  try { res.json({ templates: await service.listTemplates() }); }
  catch (err) { next(err); }
});

router.post("/project-templates", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(1000).nullable().optional(),
      governance: z.enum(["LITE", "STANDARD"]).optional(),
      milestones: z.array(z.object({
        title: z.string().min(1).max(300),
        type: z.enum(["STANDARD", "SECURITY_GATE", "SITE_READINESS", "UAT", "GO_LIVE"]).optional(),
        offset_days: z.number().int().min(0).max(3650),
      })).optional(),
      workstreams: z.array(z.object({ title: z.string().min(1).max(300) })).optional(),
      deliverables: z.array(z.object({ title: z.string().min(1).max(300) })).optional(),
    }).parse(req.body);
    res.status(201).json({ template: await service.createTemplate(req.user, body) });
  } catch (err) { next(err); }
});

router.get("/custom-fields", async (req, res, next) => {
  try { res.json({ fields: await service.listFieldDefs() }); }
  catch (err) { next(err); }
});

router.post("/custom-fields", async (req, res, next) => {
  try {
    const body = z.object({
      key: z.string().min(2).max(40),
      label: z.string().trim().min(1).max(120),
      type: z.enum(["text", "number", "date", "select"]),
      options: z.array(z.string().min(1)).max(50).optional(),
      required: z.boolean().optional(),
    }).parse(req.body);
    res.status(201).json({ field: await service.createFieldDef(req.user, body) });
  } catch (err) { next(err); }
});

module.exports = router;
