"use strict";
// E20 — notification channel adapter boundary (plan §53).
// In-app rows are always written by notifications/service.js. Additional channels
// go through this dispatcher, selected by environment:
//   NOTIFY_CHANNEL_MODE=sink   (default; local/dev/test — captures deliveries in DB)
//   NOTIFY_CHANNEL_MODE=live   (production — email via SMTP relay, Teams via webhook)
// Production contract (documented in docs/execution/EXTERNAL_DEPENDENCIES.md):
//   SMTP_URL       e.g. smtp://user:pass@relay.endeavourmining.com:587  (BLOCKED_EXTERNAL)
//   TEAMS_WEBHOOK_URL  incoming-webhook URL of the Teams channel        (BLOCKED_EXTERNAL)
// Delivery attempts (sent, captured, or failed) are recorded in notification_deliveries
// so failures are observable and auditable. Dispatch is best-effort and never blocks
// the business transaction that raised the notification.
const { query } = require("../../db/pool");

async function recordDelivery({ notificationId, channel, recipient, payload, status, error }) {
  await query(
    `INSERT INTO notification_deliveries (notification_id, channel, recipient, payload, status, error)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [notificationId || null, channel, recipient, JSON.stringify(payload || {}), status, error || null]
  );
}

// Local sink adapter — the dev/test substitute required by the external-deps policy.
const sinkAdapter = {
  name: "SINK",
  async send({ recipient, subject, text }) {
    return { status: "CAPTURED", payload: { subject, text } };
  },
};

// Teams incoming-webhook adapter (real transport; fetch is built into Node >=18).
function teamsAdapter(webhookUrl, fetchImpl = fetch) {
  return {
    name: "TEAMS",
    async send({ subject, text }) {
      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `**${subject}**\n${text}` }),
      });
      if (!res.ok) throw new Error(`Teams webhook returned ${res.status}`);
      return { status: "SENT", payload: { subject } };
    },
  };
}

// SMTP adapter — configuration contract only; sending requires a mail relay
// (BLOCKED_EXTERNAL). Fails loudly if selected without configuration.
function emailAdapter(smtpUrl) {
  return {
    name: "EMAIL",
    async send() {
      throw new Error(
        smtpUrl
          ? "SMTP transport not bundled in this build — install a relay-side sender or enable the platform mailer (see EXTERNAL_DEPENDENCIES.md)"
          : "SMTP_URL is not configured"
      );
    },
  };
}

function activeAdapters(env = process.env, fetchImpl) {
  if ((env.NOTIFY_CHANNEL_MODE || "sink") !== "live") return [sinkAdapter];
  const adapters = [];
  if (env.TEAMS_WEBHOOK_URL) adapters.push(teamsAdapter(env.TEAMS_WEBHOOK_URL, fetchImpl));
  if (env.SMTP_URL) adapters.push(emailAdapter(env.SMTP_URL));
  return adapters.length ? adapters : [sinkAdapter];
}

// Fire-and-forget dispatch: called after the in-app notification is committed.
async function dispatch({ notificationId, recipient, subject, text }, env, fetchImpl) {
  for (const adapter of activeAdapters(env, fetchImpl)) {
    try {
      const result = await adapter.send({ recipient, subject, text });
      await recordDelivery({
        notificationId, channel: adapter.name, recipient,
        payload: result.payload, status: result.status,
      });
    } catch (err) {
      await recordDelivery({
        notificationId, channel: adapter.name, recipient,
        payload: { subject }, status: "FAILED", error: err.message,
      }).catch(() => {});
    }
  }
}

module.exports = { dispatch, activeAdapters, teamsAdapter, sinkAdapter, emailAdapter };
