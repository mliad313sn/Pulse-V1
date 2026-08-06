"use strict";
const express = require("express");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json(await service.listForUser(req.user.id, { limit, offset }));
  } catch (err) { next(err); }
});

router.post("/:id/read", async (req, res, next) => {
  try {
    await service.markRead(req.user.id, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/read-all", async (req, res, next) => {
  try {
    await service.markAllRead(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
