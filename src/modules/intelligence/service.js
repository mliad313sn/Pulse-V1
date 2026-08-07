"use strict";
// SPM Phase 9 — Pulse Intelligence: source-grounded AI drafting.
// The adapter calls the Anthropic API through the official SDK. The model is
// given ONLY facts the requesting user is authorized to see: confidentiality
// is enforced upstream by loadProjectAccess, and money facts are included
// only when the caller carries the finance flag. Every fact carries a
// [type:id] citation tag and the model is instructed to ground every claim
// in one. AI drafts and explains — it has NO write path and never approves
// gates, budgets, baselines, CAPAs or portfolio decisions.
const { query } = require("../../db/pool");
const { ApiError } = require("../../middleware/errors");

const MODEL = "claude-opus-5";

// Test seam: inject a fake fetch so tests exercise the full adapter without
// the network. Production code never sets this.
let fetchOverride = null;
function setFetchForTests(fn) { fetchOverride = fn; }

function aiEnabled() { return Boolean(process.env.ANTHROPIC_API_KEY); }

function client() {
  if (!aiEnabled()) {
    throw new ApiError(503,
      "AI drafting is not configured on this deployment — set ANTHROPIC_API_KEY to enable it",
      { code: "BLOCKED_EXTERNAL" });
  }
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  });
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null);

// Everything the model will see, as citable facts. This is the single
// authorization choke point for AI input: only add facts the caller could
// read through the normal API.
async function gatherFacts(user, projectAccess) {
  const p = projectAccess.project;
  const finance = user.role === "ADMIN" || user.finance_access === true;
  const facts = [];
  const fact = (cite, text) => facts.push({ cite, text });

  fact(`project:${p.id}`,
    `Project ${p.code} "${p.title}" — stage ${p.stage}, status ${p.operating_status}, ` +
    `health ${(p.rag_override || p.rag_computed) || "n/a"}, progress ${p.progress_pct ?? 0}%, ` +
    `start ${iso(p.start_date) || "?"}, target ${iso(p.target_date) || "?"}.`);
  if (p.rag_override && p.rag_override_reason) {
    fact(`project:${p.id}`, `Health was manually overridden to ${p.rag_override}: ${p.rag_override_reason}`);
  }

  const [ms, risks, roadblocks, actions, status] = await Promise.all([
    query(`SELECT id, title, type, status, due_date FROM milestones
            WHERE project_id = $1 AND deleted_at IS NULL ORDER BY due_date NULLS LAST LIMIT 15`, [p.id]),
    query(`SELECT id, title, score, status FROM risks
            WHERE project_id = $1 AND deleted_at IS NULL AND status <> 'CLOSED'
            ORDER BY score DESC LIMIT 10`, [p.id]),
    query(`SELECT id, title, severity, status FROM roadblocks
            WHERE project_id = $1 AND deleted_at IS NULL AND status <> 'RESOLVED'
            ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END LIMIT 10`, [p.id]),
    query(`SELECT count(*)::int AS open,
                  count(*) FILTER (WHERE due_date < (now() AT TIME ZONE 'utc')::date)::int AS overdue
             FROM actions WHERE project_id = $1 AND deleted_at IS NULL AND status = 'OPEN'`, [p.id]),
    query(`SELECT id, date, mood, summary FROM status_updates
            WHERE project_id = $1 AND deleted_at IS NULL ORDER BY date DESC LIMIT 1`, [p.id]),
  ]);
  for (const m of ms.rows) {
    fact(`milestone:${m.id}`, `Milestone "${m.title}" (${m.type}) is ${m.status}, due ${iso(m.due_date) || "unscheduled"}.`);
  }
  for (const r of risks.rows) {
    fact(`risk:${r.id}`, `Open risk "${r.title}" — score ${r.score}, status ${r.status}.`);
  }
  for (const rb of roadblocks.rows) {
    fact(`roadblock:${rb.id}`, `${rb.severity} roadblock "${rb.title}" is ${rb.status}.`);
  }
  if (actions.rows[0].open > 0) {
    fact(`project:${p.id}`, `${actions.rows[0].open} open action(s), ${actions.rows[0].overdue} overdue.`);
  }
  if (status.rows.length) {
    const s = status.rows[0];
    fact(`status_update:${s.id}`, `Latest PM status (${iso(s.date)}, mood ${s.mood}): ${s.summary}`);
  }

  if (finance) {
    const { rows: fin } = await query(
      `SELECT coalesce(sum(b.approved * fx.rate_to_base),0) AS approved,
              coalesce(sum(b.actual * fx.rate_to_base),0) AS actual
         FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
        WHERE b.project_id = $1 AND b.deleted_at IS NULL`, [p.id]);
    if (Number(fin[0].approved) > 0 || Number(fin[0].actual) > 0) {
      fact(`finance:${p.id}`,
        `Budget: ${Math.round(fin[0].approved).toLocaleString("en-US")} USD approved, ` +
        `${Math.round(fin[0].actual).toLocaleString("en-US")} USD actual spend.`);
    }
  }
  return facts;
}

// Draft a source-grounded executive summary. Read-only: nothing is written.
async function draftExecutiveSummary(user, projectAccess) {
  const anthropic = client(); // throws 503 BLOCKED_EXTERNAL without a key
  const facts = await gatherFacts(user, projectAccess);
  const factBlock = facts.map((f) => `[${f.cite}] ${f.text}`).join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system:
      "You draft executive project summaries for a portfolio governance meeting. " +
      "Use ONLY the facts provided — never invent numbers, dates or names. " +
      "Every sentence must end with the [type:id] citation tag(s) of the facts it is based on. " +
      "You are drafting for humans to review: you do not approve, decide or recommend approval of anything. " +
      "Structure: 1) one-line status, 2) what needs attention and why, 3) suggested asks for the meeting. " +
      "Keep it under 200 words.",
    messages: [{ role: "user", content: `Facts about the project:\n${factBlock}\n\nDraft the executive summary.` }],
  });

  const draft = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return {
    draft,
    citations: facts.map((f) => f.cite),
    model: message.model || MODEL,
    disclaimer: "AI-drafted from the records cited — review before use. AI never approves or changes anything.",
  };
}

module.exports = { aiEnabled, gatherFacts, draftExecutiveSummary, setFetchForTests, MODEL };
