"use strict";
// SPM Phase 10 — the OpenAPI document is GENERATED from the live Express
// router tree, not hand-maintained: a route that exists is documented, a
// route that is deleted disappears. Descriptions for the governed endpoints
// are curated below; everything else is still listed (honestly, as
// undocumented) so the spec can never quietly under-report the surface.
const pkg = require("../../../package.json");

// Curated summaries for the endpoints integrators care about most.
const SUMMARIES = {
  "GET /api/v1/projects": "List projects visible to the caller (confidentiality + site isolation applied)",
  "POST /api/v1/projects": "Create a project (optionally from a template)",
  "GET /api/v1/projects/{projectId}": "Project detail with access level, milestones, roadblocks and gate state",
  "PUT /api/v1/projects/{projectId}": "Update a project — requires updated_at for optimistic locking",
  "GET /api/v1/projects/{projectId}/graph": "Decision graph: strategy → delivery → impact, with why/approvals/impacted answers",
  "GET /api/v1/projects/{projectId}/plan": "Schedule plan: CPM dates, float, critical + near-critical path, quality checks",
  "GET /api/v1/projects/{projectId}/evm": "Earned value (PV/EV/AC/CPI/SPI/BAC/ETC/EAC/VAC) — requires the finance flag",
  "POST /api/v1/projects/{projectId}/ai/summary": "AI-drafted, source-grounded executive summary (read-only; 503 when unconfigured)",
  "GET /api/v1/demands": "Demand backlog",
  "GET /api/v1/demands/ranked": "Demand backlog ranked by a scoring model (wsjf|rice|weighted|cd3)",
  "POST /api/v1/demands/{id}/convert": "Convert an approved demand into a project (audited, two-way linked)",
  "GET /api/v1/scenarios/{id}/evaluate": "Evaluate a scenario — pure what-if, mutates nothing",
  "POST /api/v1/scenarios/optimize": "Portfolio optimization under a budget constraint (mandatory work funded first)",
  "POST /api/v1/scenarios/{id}/promote": "Turn an approved scenario into PENDING change requests (humans still decide each)",
  "POST /api/v1/meetings/{id}/decisions/{decisionId}/convert-to-cr": "Convert a captured meeting decision into a governed change request",
  "GET /api/v1/webhooks": "List webhook subscriptions (Admin)",
  "POST /api/v1/webhooks": "Create a webhook subscription (Admin)",
  "GET /api/v1/openapi.json": "This document",
  "GET /healthz": "Liveness probe",
  "GET /readyz": "Readiness probe (checks the database)",
};

// Express path params (:id) → OpenAPI ({id})
function toOpenApiPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/$/, "") || "/";
}

function collect(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      const path = toOpenApiPath(prefix + layer.route.path);
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (!on || method === "_all") continue;
        out.push({ method: method.toUpperCase(), path });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      // Recover the mount path from the layer's regexp
      const src = layer.regexp?.source || "";
      const m = /^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/.exec(src);
      const mount = m ? "/" + m[1].replace(/\\\//g, "/").replace(/\\\./g, ".") : "";
      collect(layer.handle.stack, prefix + mount, out);
    }
  }
}

function paramsFor(path) {
  return [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => ({
    name: m[1], in: "path", required: true, schema: { type: "string" },
  }));
}

function document(app) {
  const routes = [];
  const stack = app?._router?.stack || app?.router?.stack;
  if (stack) collect(stack, "", routes);

  const paths = {};
  for (const r of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    const key = `${r.method} ${r.path}`;
    paths[r.path] = paths[r.path] || {};
    paths[r.path][r.method.toLowerCase()] = {
      summary: SUMMARIES[key] || "Undocumented endpoint — see the module source",
      responses: {
        200: { description: "Success" },
        401: { description: "Authentication required" },
        403: { description: "Not allowed for this caller" },
        404: { description: "Not found (also returned for concealed confidential records)" },
        409: { description: "Optimistic-locking conflict — reload and retry" },
      },
      ...(paramsFor(r.path).length ? { parameters: paramsFor(r.path) } : {}),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Pulse API",
      version: pkg.version,
      description:
        "Pulse Strategic Portfolio Management API. Every endpoint enforces the same " +
        "authorization model server-side: confidential projects are concealed as 404, " +
        "site-restricted accounts see only their sites, and money figures require the " +
        "finance flag. Writes that carry updated_at use optimistic locking (409 on conflict). " +
        "Webhook payloads are signed with HMAC-SHA256 in the x-pulse-signature header.",
    },
    servers: [{ url: "/", description: "This deployment" }],
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "connect.sid",
          description: "Session cookie from POST /api/v1/auth/login; state-changing calls also need the CSRF token header." },
      },
    },
    security: [{ session: [] }],
    "x-events": require("./events").CATALOGUE,
    paths,
  };
}

module.exports = { document, SUMMARIES };
