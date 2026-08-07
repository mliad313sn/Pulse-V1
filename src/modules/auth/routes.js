"use strict";
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const service = require("./service");
const { issueToken } = require("../../middleware/csrf");
const { requireAuth, requireRole } = require("../../middleware/authz");

const router = express.Router();

// strict login limiter: 10/min/IP (plan §1); env override exists for the test harness
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts — try again in a minute" },
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await service.verifyCredentials(email, password);
    // rotate session id on login (fixation protection)
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    const csrfToken = issueToken(req.session);
    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        divisionId: user.division_id, siteId: user.site_id,
        mustChangePassword: user.must_change_password,
        isSteeringCommittee: user.is_steering_committee === true,
        enterpriseAccess: user.enterprise_access !== false,
      },
      csrfToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("pulse.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role,
      divisionId: req.user.division_id, siteId: req.user.site_id,
      mustChangePassword: req.user.must_change_password,
      isSteeringCommittee: req.user.is_steering_committee === true,
      enterpriseAccess: req.user.enterprise_access !== false,
    },
    csrfToken: req.session.csrfToken,
  });
});

const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10) });
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changeSchema.parse(req.body);
    await service.changePassword(req.user.id, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===== Admin user management =====
const userSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(10),
  role: z.enum(["ADMIN", "DIVISION_LEAD", "CONTRIBUTOR", "VIEWER"]),
  divisionId: z.number().int().positive().nullable().optional(),
  siteId: z.number().int().positive().nullable().optional(),
});

router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json({ users: await service.listUsers({ limit, offset }) });
  } catch (err) { next(err); }
});

router.post("/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const body = userSchema.parse(req.body);
    const user = await service.createUser(req.user, body);
    res.status(201).json({ user });
  } catch (err) { next(err); }
});

router.put("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const patch = userSchema.partial().omit({ password: true }).parse(req.body);
    const user = await service.updateUser(req.user, Number(req.params.id), {
      name: patch.name, email: patch.email, role: patch.role,
      division_id: patch.divisionId, site_id: patch.siteId,
      active: req.body.active,
      is_steering_committee: typeof req.body.isSteeringCommittee === "boolean" ? req.body.isSteeringCommittee : undefined,
      enterprise_access: typeof req.body.enterpriseAccess === "boolean" ? req.body.enterpriseAccess : undefined,
    });
    res.json({ user });
  } catch (err) { next(err); }
});

router.post("/users/:id/reset-password", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { newPassword } = z.object({ newPassword: z.string().min(10) }).parse(req.body);
    await service.resetPassword(req.user, Number(req.params.id), newPassword);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    await service.softDeleteUser(req.user, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
