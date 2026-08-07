"use strict";
// E30/RA-16 — scheduled report dispatch. Every Monday 06:00 GMT each active
// user receives a portfolio digest computed WITH THEIR OWN authorization
// scope (confidentiality + site isolation via listPortfolio), so no recipient
// ever sees counts they couldn't see on the dashboard. Dispatch is idempotent
// per (report, ISO-week, recipient) and every send is logged.
const cron = require("node-cron");
const { query } = require("../db/pool");
const projects = require("../modules/projects/service");
const notifications = require("../modules/notifications/service");

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function runWeeklyDigest(now = new Date()) {
  const period = isoWeek(now);
  const { rows: users } = await query(
    `SELECT id, name, email, role, division_id, site_id, enterprise_access, finance_access
       FROM users WHERE deleted_at IS NULL AND active = true`);
  let sent = 0;
  for (const user of users) {
    // per-recipient scope — the same predicate as the portfolio wall
    const rows = await projects.listPortfolio(user, {});
    const eff = (p) => p.rag_override || p.rag_computed;
    const g = rows.filter((p) => eff(p) === "G").length;
    const a = rows.filter((p) => eff(p) === "A").length;
    const r = rows.filter((p) => eff(p) === "R").length;
    const summary = `Weekly portfolio digest ${period}: ${rows.length} projects — ${g} green / ${a} amber / ${r} red`;
    const { rows: ins } = await query(
      `INSERT INTO report_dispatch_log (report_key, period, user_id, summary)
       VALUES ('PORTFOLIO_WEEKLY', $1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
      [period, user.id, summary]);
    if (!ins.length) continue; // already dispatched this period
    await notifications.create(null, {
      userId: user.id, type: "REPORT", entity: "report", entityId: ins[0].id,
      text: summary, createdBy: null,
    });
    sent++;
  }
  if (sent) console.log(`[reports] weekly digest dispatched to ${sent} recipient(s) for ${period}`);
  return sent;
}

function start() {
  cron.schedule("0 6 * * 1", () => {
    runWeeklyDigest().catch((err) => console.error("[reports] dispatch failed:", err.message));
  }, { timezone: "Etc/GMT" });
  console.log("[reports] weekly digest scheduled Mondays 06:00 GMT");
}

module.exports = { start, runWeeklyDigest, isoWeek };
