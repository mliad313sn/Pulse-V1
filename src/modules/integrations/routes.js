"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const registry = require("./registry");
const { requireAuth, requireRole } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

// What can this deployment actually talk to? Honest per-adapter state.
router.get("/integrations", async (req, res, next) => {
  try {
    if (req.user.role === "ADMIN") return res.json({ integrations: await service.overview() });
    res.json({ integrations: registry.list() });
  } catch (err) { next(err); }
});

// A connectivity check that refuses to lie: BLOCKED_EXTERNAL without credentials.
router.post("/integrations/:key/test", requireRole("ADMIN"), (req, res, next) => {
  try {
    const adapter = registry.assertUsable(req.params.key); // throws 503 when unconfigured
    res.json({
      adapter: adapter.key,
      state: registry.status(adapter).state,
      note: adapter.remote
        ? "Credentials are present. A live round-trip runs against the real system on first use."
        : "Built-in adapter — no external system involved.",
    });
  } catch (err) { next(err); }
});

const linkBody = z.object({
  system: z.string().min(1).max(40),
  external_id: z.string().min(1).max(200),
  external_key: z.string().max(200).nullable().optional(),
  external_url: z.string().url().max(2000).nullable().optional(),
  entity: z.enum(["project", "task", "risk", "action"]),
  entity_id: z.number().int().positive(),
});
router.post("/integrations/links", async (req, res, next) => {
  try { res.status(201).json({ link: await service.link(req.user, linkBody.parse(req.body)) }); }
  catch (err) { next(err); }
});

router.delete("/integrations/links/:id", async (req, res, next) => {
  try { res.json(await service.unlink(req.user, Number(req.params.id))); }
  catch (err) { next(err); }
});

router.get("/integrations/links/:entity/:entityId", async (req, res, next) => {
  try {
    res.json({ links: await service.linksFor(req.user, req.params.entity, Number(req.params.entityId)) });
  } catch (err) { next(err); }
});

module.exports = router;
