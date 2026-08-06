"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { q } = z.object({ q: z.string().min(1).max(200) }).parse(req.query);
    res.json(await service.search(req.user, q));
  } catch (err) { next(err); }
});

module.exports = router;
