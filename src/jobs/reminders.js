"use strict";
// E21 — reminder & escalation engine (plan §54). Runs daily; fully idempotent:
// the reminder_log unique key guarantees one notification per object × threshold
// × recipient regardless of reruns or duplicate scheduling.
//   T-14 upcoming · T-7 reminder · T-2 urgent · T0 due today · T+1 overdue
//   T+7 escalation (owner AND the project's PM)
const cron = require("node-cron");
const { query } = require("../db/pool");
const notifications = require("../modules/notifications/service");

const THRESHOLDS = [
  { key: "T-14", offset: -14, label: "due in 14 days" },
  { key: "T-7", offset: -7, label: "due in 7 days" },
  { key: "T-2", offset: -2, label: "due in 2 days" },
  { key: "T0", offset: 0, label: "due today" },
  { key: "T+1", offset: 1, label: "OVERDUE since yesterday" },
  { key: "T+7", offset: 7, label: "overdue for a week — escalated" },
];

// entity feeds: open actions and undone milestones on active projects
const FEEDS = [
  {
    entity: "action",
    sql: `SELECT a.id, a.title, a.due_date, a.owner_user_id AS owner, p.project_manager_id AS pm, p.code
            FROM actions a
            LEFT JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
           WHERE a.deleted_at IS NULL AND a.status = 'OPEN' AND a.due_date IS NOT NULL
             AND (a.project_id IS NULL OR (p.stage <> 'CLOSED' AND p.operating_status NOT IN ('ON_HOLD','CANCELLED')))
             AND a.due_date = (now() AT TIME ZONE 'utc')::date + $1::int`,
  },
  {
    entity: "milestone",
    sql: `SELECT m.id, m.title, m.due_date, m.owner_user_id AS owner, p.project_manager_id AS pm, p.code
            FROM milestones m
            JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
           WHERE m.deleted_at IS NULL AND m.status NOT IN ('DONE','CANCELLED') AND m.due_date IS NOT NULL
             AND p.stage <> 'CLOSED' AND p.operating_status NOT IN ('ON_HOLD','CANCELLED')
             AND m.due_date = (now() AT TIME ZONE 'utc')::date + $1::int`,
  },
];

async function remindOnce({ entity, entityId, threshold, userId, text }) {
  if (!userId) return 0;
  const { rows } = await query(
    `INSERT INTO reminder_log (entity, entity_id, threshold, user_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
    [entity, entityId, threshold, userId]
  );
  if (!rows.length) return 0; // already reminded — dedupe (plan §135)
  await notifications.create(null, {
    userId, type: "REMINDER", entity, entityId, text, createdBy: null,
  });
  return 1;
}

async function runReminders() {
  let sent = 0;
  for (const t of THRESHOLDS) {
    // due_date = today + offset*-1?  T-14 means due 14 days FROM now: today + 14.
    const dayShift = -t.offset; // T-14 -> +14 ; T+7 -> -7 (due 7 days ago)
    for (const feed of FEEDS) {
      const { rows } = await query(feed.sql, [dayShift]);
      for (const r of rows) {
        const text = `${feed.entity === "action" ? "Action" : "Milestone"} "${r.title}"${r.code ? ` [${r.code}]` : ""} is ${t.label}`;
        sent += await remindOnce({ entity: feed.entity, entityId: r.id, threshold: t.key, userId: r.owner, text });
        if (t.key === "T+7" && r.pm && r.pm !== r.owner) {
          sent += await remindOnce({ entity: feed.entity, entityId: r.id, threshold: t.key, userId: r.pm, text: `Escalation: ${text}` });
        }
      }
    }
  }
  if (sent) console.log(`[reminders] ${sent} reminder notification(s) sent`);
  return sent;
}

function start() {
  cron.schedule("0 5 * * *", () => runReminders().catch((e) => console.error("[reminders] FAILED:", e.message)), {
    timezone: "Etc/UTC",
  });
  console.log("[reminders] scheduled daily 05:00 GMT");
}

module.exports = { start, runReminders, THRESHOLDS };
