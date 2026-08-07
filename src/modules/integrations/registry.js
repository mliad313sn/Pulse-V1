"use strict";
// SPM Phase 10 (remainder) — integration adapter contracts.
//
// Every adapter declares what it can do and exactly which credentials it
// needs. Without those credentials the adapter reports BLOCKED_EXTERNAL and
// refuses to run — it never pretends to have synced, and it never silently
// degrades to a no-op that looks like success. That honesty is the point:
// a dashboard showing "integrated" for a connection that was never wired is
// worse than one showing nothing.
//
// The `local` adapter is a real, fully working implementation of the same
// contract, used to prove the contract end to end in tests and to let a
// deployment exercise the mapping model before buying anything.

const { ApiError } = require("../../middleware/errors");

const CAPABILITIES = {
  PULL_WORK: "Import work items (issues, tasks, tickets) as Pulse tasks",
  PUSH_WORK: "Push Pulse tasks back to the source system",
  PULL_PEOPLE: "Import people and org structure",
  PUSH_NOTIFY: "Send notifications/messages",
  PULL_FINANCE: "Import actual cost / invoice data",
  PUSH_REPORT: "Publish datasets for reporting tools",
  PROVISION_USERS: "Create/update/deactivate accounts (SCIM)",
};

// Each adapter: key, name, entity it maps, capabilities, required env vars,
// and a `check` returning a live verdict. Adapters that need a real system
// declare `remote: true` and are BLOCKED_EXTERNAL until configured.
const ADAPTERS = [
  {
    key: "jira", name: "Atlassian Jira", remote: true,
    entity: "task", capabilities: ["PULL_WORK", "PUSH_WORK"],
    requiredEnv: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    externalIdField: "issue id (numeric, immutable — not the PROJ-123 key, which changes on project move)",
    docs: "Basic auth with an API token; /rest/api/3/search for pull, /rest/api/3/issue for push.",
  },
  {
    key: "ado", name: "Azure DevOps", remote: true,
    entity: "task", capabilities: ["PULL_WORK", "PUSH_WORK"],
    requiredEnv: ["ADO_ORG_URL", "ADO_PROJECT", "ADO_PAT"],
    externalIdField: "work item id",
    docs: "PAT auth; WIQL for queries, /_apis/wit/workitems for writes.",
  },
  {
    key: "servicenow", name: "ServiceNow ITSM", remote: true,
    entity: "task", capabilities: ["PULL_WORK", "PULL_PEOPLE"],
    requiredEnv: ["SERVICENOW_INSTANCE", "SERVICENOW_USER", "SERVICENOW_PASSWORD"],
    externalIdField: "sys_id",
    docs: "Table API /api/now/table/{table}; sys_id is the immutable key on every record.",
  },
  {
    key: "teams", name: "Microsoft Teams", remote: true,
    entity: "notification", capabilities: ["PUSH_NOTIFY"],
    requiredEnv: ["TEAMS_WEBHOOK_URL"],
    externalIdField: "n/a (fire-and-forget webhook)",
    docs: "Incoming webhook; already implemented as a notification channel adapter.",
  },
  {
    key: "powerbi", name: "Power BI / Tableau", remote: true,
    entity: "dataset", capabilities: ["PUSH_REPORT"],
    requiredEnv: ["POWERBI_TENANT_ID", "POWERBI_CLIENT_ID", "POWERBI_CLIENT_SECRET"],
    externalIdField: "dataset id",
    docs: "Reporting tools can also read the existing authenticated export endpoints directly.",
  },
  {
    key: "erp", name: "ERP / finance system", remote: true,
    entity: "budget_line", capabilities: ["PULL_FINANCE"],
    requiredEnv: ["ERP_BASE_URL", "ERP_API_KEY"],
    externalIdField: "cost object / WBS element",
    docs: "Pulls committed and actual cost by cost centre; currency must resolve against fx_rates.",
  },
  {
    key: "hris", name: "HRIS", remote: true,
    entity: "user", capabilities: ["PULL_PEOPLE"],
    requiredEnv: ["HRIS_BASE_URL", "HRIS_API_KEY"],
    externalIdField: "employee id",
    docs: "Source of truth for people, sites and reporting lines; Pulse never writes back.",
  },
  {
    key: "scim", name: "Entra ID / SCIM provisioning", remote: true,
    entity: "user", capabilities: ["PROVISION_USERS", "PULL_PEOPLE"],
    requiredEnv: ["SCIM_TOKEN"],
    externalIdField: "SCIM externalId (immutable directory object id)",
    docs: "Group-to-role mapping is configured per deployment; the directory object id is the identity anchor.",
  },
  {
    key: "local", name: "Local file/manual link", remote: false,
    entity: "task", capabilities: ["PULL_WORK"],
    requiredEnv: [],
    externalIdField: "caller-supplied id",
    docs: "Always available. Implements the same contract, so the mapping model is exercised for real.",
  },
];

const byKey = new Map(ADAPTERS.map((a) => [a.key, a]));

function missingEnv(adapter) {
  return adapter.requiredEnv.filter((v) => !process.env[v]);
}

// The live verdict for one adapter — the single place that decides
// "configured" vs "blocked", so no surface can claim more than is true.
function status(adapter) {
  const missing = missingEnv(adapter);
  if (!adapter.remote) {
    return { state: "AVAILABLE", detail: "Built in — no external credentials needed" };
  }
  if (missing.length) {
    return {
      state: "BLOCKED_EXTERNAL",
      detail: `Not configured on this deployment — set ${missing.join(", ")}`,
      missing,
    };
  }
  return { state: "CONFIGURED", detail: "Credentials present" };
}

function list() {
  return ADAPTERS.map((a) => ({
    key: a.key, name: a.name, entity: a.entity,
    capabilities: a.capabilities.map((c) => ({ code: c, description: CAPABILITIES[c] })),
    required_env: a.requiredEnv,
    external_id_field: a.externalIdField,
    notes: a.docs,
    ...status(a),
  }));
}

function get(key) {
  const adapter = byKey.get(key);
  if (!adapter) throw new ApiError(404, `No integration adapter named "${key}"`);
  return adapter;
}

// Throws the honest 503 unless the adapter can genuinely run.
function assertUsable(key) {
  const adapter = get(key);
  const s = status(adapter);
  if (s.state === "BLOCKED_EXTERNAL") {
    throw new ApiError(503, s.detail, { code: "BLOCKED_EXTERNAL", adapter: key, missing: s.missing });
  }
  return adapter;
}

module.exports = { ADAPTERS, CAPABILITIES, list, get, status, assertUsable, missingEnv };
