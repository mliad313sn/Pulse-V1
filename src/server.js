"use strict";
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const PgSession = require("connect-pg-simple")(session);

const { pool, query } = require("./db/pool");
const { csrfProtection } = require("./middleware/csrf");
const { errorHandler, notFound } = require("./middleware/errors");
const { requireAuth } = require("./middleware/authz");

function createApp(options = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
    })
  );
  app.use(express.json({ limit: "1mb" }));

  // Sessions in PostgreSQL — survive app restarts (plan §1)
  app.use(
    session({
      store: new PgSession({ pool, tableName: "session" }),
      name: "pulse.sid",
      secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.SECURE_COOKIES === "true",
        maxAge: 8 * 60 * 60 * 1000, // 8h working session
      },
    })
  );

  // Global API rate limit (login has its own stricter limiter in auth routes)
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: options.apiLimit ?? Number(process.env.API_RATE_LIMIT || 600),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests — slow down" },
  });
  app.use("/api/", apiLimiter);

  app.use(csrfProtection);

  // Pulse-V1 offline-sync idempotency (X-Client-Op-Id dedupe) — before all routers
  app.use("/api/", require("./modules/sync/routes").syncIdempotency);

  // ===== API v1 =====
  app.use("/api/v1/auth", require("./modules/auth/routes"));
  app.use("/api/v1/projects", require("./modules/projects/routes"));
  app.use("/api/v1", require("./modules/milestones/routes"));
  app.use("/api/v1", require("./modules/roadblocks/routes"));
  app.use("/api/v1", require("./modules/actions/routes"));
  app.use("/api/v1/meetings", require("./modules/meetings/routes"));
  app.use("/api/v1/notifications", require("./modules/notifications/routes"));
  app.use("/api/v1/search", require("./modules/search/routes"));
  app.use("/api/v1/reports", require("./modules/reports/routes"));
  app.use("/api/v1/audit", require("./modules/audit/routes"));
  app.use("/api/v1/rag", require("./modules/rag/routes"));
  app.use("/api/v1", require("./modules/deliverables/routes"));
  app.use("/api/v1", require("./modules/risks/routes"));
  app.use("/api/v1", require("./modules/capa/routes"));
  app.use("/api/v1", require("./modules/tasks/routes"));
  app.use("/api/v1", require("./modules/resources/routes"));
  app.use("/api/v1", require("./modules/finance/routes"));
  app.use("/api/v1", require("./modules/portfolio/routes"));
  app.use("/api/v1/exports", require("./modules/exports/routes"));
  app.use("/api/v1/sync", require("./modules/sync/routes").router);

  // Reference data for pickers (any authenticated user)
  app.get("/api/v1/meta", requireAuth, async (req, res, next) => {
    try {
      const [divisions, sites, users] = await Promise.all([
        query(`SELECT id, code, name FROM divisions WHERE deleted_at IS NULL ORDER BY code`),
        query(`SELECT id, code, name FROM sites WHERE deleted_at IS NULL ORDER BY code`),
        query(`SELECT id, name, role, division_id, site_id FROM users
                WHERE deleted_at IS NULL AND active = true ORDER BY name`),
      ]);
      res.json({ divisions: divisions.rows, sites: sites.rows, users: users.rows });
    } catch (err) { next(err); }
  });

  app.get("/healthz", async (req, res) => {
    try {
      await query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  // ===== static frontend =====
  app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1h", index: "index.html" }));

  app.use("/api", (req, res, next) => next(notFound("Unknown API route")));
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const { migrate } = require("./db/migrate");
  const port = Number(process.env.PORT || 3000);
  migrate()
    .then(() => {
      const app = createApp();
      app.listen(port, () => console.log(`PULSE listening on :${port} (GMT)`));
      if (process.env.DISABLE_JOBS !== "true") {
        require("./jobs/snapshot").start();
        require("./jobs/backup").start();
        require("./jobs/reminders").start();
      }
    })
    .catch((err) => {
      console.error("Startup failed:", err);
      process.exit(1);
    });
}

module.exports = { createApp };
