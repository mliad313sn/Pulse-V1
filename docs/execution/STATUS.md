# Execution Status

Updated: 2026-08-07 · Branch: `claude/pulse-platform-build-0n6w1u` · Tests: **209/209 green** · `npm audit`: 0 vulnerabilities

## Where the build stands

The repository contains a coherent, working platform (PULSE) covering roughly Waves 1–2
plus large parts of Waves 3–4 and 7 of the master plan. Per SKILL.md §5, the existing
implementation was kept and extended, not rewritten. Full mapping:
`REQUIREMENT_TRACEABILITY.md`.

## Completed this execution round
- Installed `PROJECT_MASTER_PLAN.md` + `.claude/skills/goal/SKILL.md` as repo authorities.
- Initialized docs/execution/* memory.
- **E11 slice**: risk register (prob×impact scoring, residual, treatment, permissions),
  CAPA with stepwise verified lifecycle (close needs verifier + effectiveness),
  roadblock reopen-with-reason control. Migration `003_risk_capa_channels.sql`.
- **E14 slice**: auto-agenda rules 7 (gates awaiting Steering) and 8 (overdue CAPA);
  agenda items now enrich instead of dropping co-occurring signals.
- **E20 slice**: notification channel dispatcher + `notification_deliveries` ledger +
  local sink adapter (default) + real Teams-webhook adapter (contract-tested);
  SMTP contract documented as BLOCKED_EXTERNAL.
- Freshness now counts risk/CAPA writes as project activity.
- **E14 slice**: versioned minutes (migration 004) — re-closing a meeting after
  correcting underlying objects creates version n+1; prior versions immutable and
  readable (?version=n), version index endpoint.

## Test commands
```
npm test                        # full suite (79)
node --test tests/api/risk-capa.test.js
```
Dev DB: `postgres://pulse:pulse@localhost:5432/pulse` · test DB `pulse_test` (see .env.example).

## Completed: E05 remodel (2026-08-07, round 3)
7-stage lifecycle + operating_status shipped as one atomic slice (migration 005 with
data mapping DESIGN→PLANNING, BUILD→EXECUTION, DEPLOY→DEPLOYMENT, stage ON_HOLD →
operating_status). Gates 0-5 with per-gate prerequisites (G2 = milestone+deliverable+
risk+Steering). Hold/cancel need reasons; cancelled terminal; CLOSED sets COMPLETED.
Freshness exemption now stage RUN/CLOSED or op-status ON_HOLD/CANCELLED/COMPLETED.
Channel dispatch made commit-race tolerant (FK retry then unlinked ledger row).

## Completed: E22 Executive Command Center (2026-08-07)
`GET /api/v1/reports/executive` composes attention (RED + explained why from
rag_signals_json), gates awaiting Steering, go-lives ≤45d, exception counts,
RAG trend, site health, overloaded people, and a finance block that is
server-side masked (null) for anyone without ADMIN/finance_access — verified
by leak-string assertion in finance.test §4. Frontend `#/exec` view wired.

## Completed: E04 portfolio hierarchy (2026-08-07)
Migration 010: strategic_pillars / portfolios / programs + projects.portfolio_id,
program_id. Pillars are Admin config; portfolios/programs Admin+Division Lead;
a project carrying a program must carry that program's portfolio (400 on
mismatch, checked on create AND update). Wall filters ?portfolio=&program=.
Rollups (health, red/amber counts, sites, divisions, finance, benefits) are
computed per viewer with the same confidentiality/site-isolation predicate as
the wall — confidential projects never inflate an unauthorized viewer's counts,
finance summary masked without the flag. `#/portfolios` view with deep links,
demo hierarchy seeded. Browser smoke clean.

## Completed: E28 phase 1 — i18n core journey + a11y gate (2026-08-07)
EN/FR i18n layer with language switcher; core journey translated (login,
password change, nav, wall chrome, My Actions, RAG labels, error toasts).
WCAG AA contrast repaired via text-safe tokens (brand hexes untouched for
fills/decks). `npm run a11y` boots the app in Chromium, injects axe-core and
FAILS on any serious/critical violation, plus keyboard-only login and FR
render assertions — currently PASS with 0 serious/critical on login/wall/
My Actions/Executive. Remaining: translate deep views (project room, meetings,
admin, reports), clear moderate region/heading-order findings.

## Completed: E23 server-side export engine (2026-08-07)
`/api/v1/exports/portfolio.{xlsx,pdf,pptx}` — scope resolved exclusively from
filters via listPortfolio (same confidentiality/site-isolation predicate as
the wall; client cannot pass project IDs). exceljs workbook (finance columns
only when authorized), pdfkit report (uncompressed streams so tests decode
real text), pptxgenjs deck (adaptive title + paged table). Wall gained
Excel/PDF buttons carrying live filters. Semantic leak tests parse each
format and assert confidential titles/codes and finance figures are ABSENT
for unauthorized users, and site-restricted users export only their site.
Deps: exceljs+pdfkit+pptxgenjs added (uuid overridden to ^11 — audit stays 0).

## NEW GOAL (2026-08-07): SPM transformation — compete with Planview/Planisware/ServiceNow SPM
A second /goal directive extends the completed master plan into a Strategic
Portfolio Management platform. Phases (dependency order; each = tested slices):
- **P0 Trust & Correctness — DONE this round** (see below)
- **P1 Strategy & Demand — DONE**: demand lifecycle + scoring + conversion +
  Demand UI; objectives/OKRs with computed progress + strategy board;
  project templates/blueprints (dated milestone stamping incl. readiness
  checklists, workstreams, deliverables, migration 018); Admin-defined typed
  custom fields validated server-side, stored in projects.custom_json.
  (Configurable saved views deferred to P11 UX.)
- **P2 Advanced planning — MOSTLY DONE**: WBS parent/summary rollups,
  remaining effort (auto-zero on DONE), task baselines + day-level variance,
  cross-project dependencies + concealment-safe blast radius, 5 schedule
  quality checks (migration 019). CPM full semantics from P0 — and a REAL BUG
  FIXED: kernel read dependency_type but the DB column is dep_type, so live
  plans computed FS-only; now honors both. COMPLETED (migration 026): working
  calendars with two-way exceptions (holidays AND worked recovery days),
  Admin-curated because a calendar change moves everyone's dates; the CPM now
  runs in WORKING days and returns real dates that never land on a weekend;
  work content is measured against the working WEEK so a mid-window holiday
  pushes the chain out instead of silently deleting a day of work; date
  constraints (START_NO_EARLIER_THAN / FINISH_NO_LATER_THAN / MUST_START_ON /
  MUST_FINISH_ON) with unsatisfiable ones reported as named violations and
  NEGATIVE float; resource leveling that finds double-bookings and proposes a
  shift within float without ever moving anyone's dates. Bug found and fixed:
  pg returns DATE as a JS Date, so the exception lookup key was
  "Mon Jun 01" — calendar exceptions were being silently ignored.
  REMAINING: Gantt visual (P11).
- **P3 Capacity intelligence — DONE (core)**: migration 024 adds a skills
  catalogue with per-person proficiency/certification (self-service for your
  own, Admin/DL for others), allocation TYPE (PROJECT/BAU/LEAVE — project_id
  now nullable with a CHECK so non-project time is bookable) and COMMITMENT
  (COMMITTED/TENTATIVE). Pure capacity kernel (capacity.js): day-weighted
  weekly/monthly buckets, leave REDUCES capacity while BAU consumes it,
  tentative load reported separately as at-risk, every period explains itself.
  Role-based resource requests raised before anyone is named → DL/Admin
  approval → automated candidate matching (skill fit + free capacity + site,
  each candidate carrying its reason) → fulfilment into a real allocation.
  Skill-gap report. Capacity heatmap UI at #/capacity with match-and-assign.
  REMAINING: rates/cost-of-resource, workforce demand forecasting beyond
  booked work, scenario-linked capacity planning.
- **P4 Finance & benefits — MOSTLY DONE**: time-phased cost plans (YYYY-MM,
  finance-gated, migration 020) + full EVM (PV/EV/AC/CPI/SPI/BAC/ETC/EAC/VAC,
  explainable, honest n/a without actuals, AC FX-converted, EV from computed
  milestone progress). FX/multicurrency from P0. REMAINING: vendor/PO/contract
  linkage. COMPLETED (migration 027): benefit realization — realization window
  + measurement frequency on the benefit, time-phased benefit_measurements,
  and a pure realization kernel that measures against the BASELINE (40→25
  incidents is 100% realized at 25, not 62%) and handles decreasing targets.
  Missing due periods are NAMED rather than averaged away. Measurement
  deliberately continues after the project CLOSES and is flagged
  post_closure — the honest test of whether a benefit was real or just a
  business-case number — with a `sustained` signal when post-closure
  observations hold up. Per-project realization summary endpoint. The
  closure test walks the real gate chain (evidence supplied, never bypassed).
- **P5 Health 2.0 — DONE (core)**: GET /projects/:id/health scores seven
  weighted dimensions (schedule 25, risks 15, finance 15, governance 15,
  resources 10, benefits 10, confidence 10) by CRITICALITY not counts — a
  late GO_LIVE outweighs a late checkpoint, a 25/25 risk outweighs five
  trivial ones — and every dimension returns the actual records that moved
  it. Finance without the flag is DROPPED and its weight redistributed
  (masking never fabricates a bad score). Reconciles honestly with the
  operational RAG instead of creating a second source of truth for the wall.
  Migration 025 adds progress methodologies (MILESTONE default, TASK, EFFORT,
  COST, PHYSICAL) — every progress number reports its own basis, and PHYSICAL
  requires a written justification (DB CHECK + a helpful 400). Health panel in
  the project room with per-dimension evidence. Also fixed: task create
  advertised `status` but silently dropped it (DONE now also zeroes remaining
  effort, so progress-by-effort can't be fooled).
- **P6 Scenarios & optimization — DONE (core)**: scenario objects (DEFER/
  STOP/BUDGET_DELTA moves, migration 021) with pure zero-mutation evaluation
  (schedule shifts, freed budget; money masked without finance flag);
  0/1-knapsack portfolio optimization ($1k DP, mandatory funded first, every
  in/out decision explained) over the demand backlog; Steering-gated
  decisions; PROMOTED scenarios spawn PENDING change requests per move —
  humans still approve each one. REMAINING: resource-constraint dimension in
  the optimizer; scenario UI (P8/P11).
- **P7 Decision graph — DONE (core)**: GET /projects/:id/graph assembles
  demand origin → objectives → portfolio/pillar → gate approvals → change
  requests → baselines → decisions → risks → CAPAs → benefits → downstream
  blast radius as nodes+edges, plus plain answers (why / approvals / last
  changes / impacted); concealment preserved (hidden downstream counted,
  never named). REMAINING: graph UI visualization (P11).
- **P8 Meeting Mode 2.0 — DONE (core)**: decision→CR conversion (POST
  /meetings/:id/decisions/:did/convert-to-cr, migration 022 links
  decisions.change_request_id; organizer/Admin/Steering convert; CR stays
  PENDING with meeting evidence in the rationale; once-only; convert button
  + CR chip in the live meeting UI); live scenario simulation in meetings
  (⚗ Simulate in the capture bar evaluates any scenario read-only via the
  P6 evaluate API, money masked without finance flag); immutable meeting
  evidence already covered by versioned minutes (P0-era).
- **P9 Intelligence — DONE (core)**: official Anthropic SDK adapter (model
  claude-opus-5, adaptive thinking, injected-fetch test seam); POST
  /projects/:id/ai/summary drafts a source-grounded executive summary — the
  model sees ONLY caller-authorized facts (confidentiality via
  loadProjectAccess, money only with the finance flag), every fact carries a
  [type:id] citation and the draft must cite; 503 BLOCKED_EXTERNAL without
  ANTHROPIC_API_KEY (/ai/status tells the UI); strictly read-only — AI has no
  write path and never approves. UI: ✨ Draft with AI fills the exec
  commentary for human review. REMAINING: predictions/anomaly detection;
  meeting-assistant drafting.
- **P10 Platform — DONE (core)**: durable webhook outbox (migration 023) —
  events enqueue in the SAME transaction as the domain change (project
  created/stage changed/health changed, CR created/decided, demand decided,
  meeting closed), delivered HMAC-SHA256-signed with exponential backoff and
  a real DLQ after 6 attempts, Admin ledger + redrive, FOR UPDATE SKIP LOCKED
  so multiple instances never double-send; payloads carry identifiers only so
  a webhook can never bypass confidentiality or finance masking. OpenAPI 3.1
  document GENERATED from the live Express router (a route that exists is
  documented; deleted routes disappear) at /api/v1/openapi.json, plus the
  event catalogue at /api/v1/events/catalogue. REMAINING: Jira/ADO/
  ServiceNow/Teams/PowerBI/ERP/HRIS/SCIM adapters (BLOCKED_EXTERNAL contracts).
- **P11 UX — PARTIAL**: Gantt drawn from the CPM's COMPUTED early dates
  (critical / near-critical / past-deadline / done colouring, month ticks,
  constraint violations listed) and a kanban board, both switchable in the
  project Plan tab over the same /plan payload — no second source of truth.
  Resource heatmap shipped with P3 (#/capacity). Verified in a real browser
  (screenshots), not assumed. Added `npm run check:frontend`: every browser
  module is parsed as an ES MODULE and the check gates `npm test` — `node
  --check` parses as CommonJS and had accepted a mis-nested template literal
  the browser refused. REMAINING: decision-graph visualization, timeline/
  calendar views, saved configurable views.
- **P12 Scale/ops — MOSTLY DONE**: structured JSON request logging with
  correlation ids (an upstream X-Request-Id survives; slow requests logged as
  warnings; bodies NEVER logged since they carry confidential titles and
  money); unhandled errors log one correlated line and return the id to the
  user without the stack; Admin-only /metrics in Prometheus format reporting
  only what is genuinely measured (requests, 5xx, duration histogram, webhook
  queue depth + dead letters, DB pool saturation); performance test asserting
  the wall stays fast at 120 projects (catches an N+1 regression); durable
  outbox/DLQ shipped in P10. docs/RUNBOOK_OPERATIONS.md written from an
  ACTUALLY EXECUTED backup + restore drill (restored into a fresh database,
  verified 26 migrations and reference data, booted the app against it and
  got readyz 200). Honest limits documented rather than hidden: rate limiting
  is per-instance and the realtime room needs sticky sessions until a shared
  backend exists; PITR is a server capability, configured where PostgreSQL is
  hosted. REMAINING: Redis-backed shared rate limit + realtime pub/sub,
  OpenTelemetry traces.

## Completed: SPM P1 slice 1 — demand management (2026-08-07)
Migration 016: demands (problem/outcome hypothesis, business case, scoring
inputs, mandatory override with reason CHECK, decision fields, permanent
converted_project_id link + projects.demand_id backlink). Pure explainable
scoring module (WSJF, RICE, weighted, CD3 — every score returns formula +
missing inputs; mandatory pins to top). Lifecycle DRAFT→SUBMITTED→APPROVED/
REJECTED→CONVERTED: any non-Viewer raises ideas (defaults to own division/
site), requester/DL/Admin edit, Steering/Admin decide with note, Admin/DL
convert approved demands into IDEA-stage projects (governance tier choosable);
converted demands frozen; everything audited; optimistic locking throughout.
Endpoints: /api/v1/demands (+/ranked?model=, /decision, /convert).
NO UI YET — next P1 slice adds the Demand backlog view + OKRs.

## Completed: SPM Phase 0 — Trust & Correctness (2026-08-07)
- Fail-closed SESSION_SECRET in production (src/config.js; CI asserts refusal)
- /healthz liveness + /readyz readiness (DB-checked, 503 when down)
- GitHub Actions CI: migrate-from-empty, full suite, audit gate, fail-closed check
- Offline idempotency scoped per (op_id, user) + method/path/body-hash;
  cross-user op-id collision no longer swallowed; id reuse with different
  body = 409 (migration 015)
- Multicurrency-safe money: fx_rates (admin-managed, audited) + FK from
  budget_lines.currency; EVERY aggregation (financials, exports, portfolio
  rollups, executive, baseline snapshots) converts to USD base; unknown
  currency = 400 with guidance
- Attachments: magic-byte content validation, malware-scan adapter contract
  (SCAN_MODE; real engine BLOCKED_EXTERNAL), CONFIDENTIAL classification now
  ENFORCED (FULL-access only, concealed 404)
- Realtime presenter chair restricted to organizer/Admin/Steering
- Scheduling kernel v2: FS/SS/FF/SF honored with lag/lead, ES/EF/LS/LF,
  total + free float, near-critical set (12 unit tests)

## Previous goal: master-plan completion contract met (2026-08-07)
E30 executed: RA-01…RA-20 evidence map in RELEASE_QUALIFICATION.md, lifecycle
tail walk + scheduled dispatch automated (qualification.test), backup/restore
drill re-run on the current 13-migration schema, RELEASE_READINESS.md verdict
GO for pilot (production GO conditional only on external credentials —
Entra tenant, Teams webhook, SMTP, object storage, one networked
`docker compose up`). Remaining PARTIAL scope is documented per epic and
non-blocking: Gantt visual drag, search breadth, deep-view i18n, admin UI breadth.

## Completed: E24 attachments + E02 OIDC adapter (2026-08-07)
Attachments: metadata in Postgres, bytes behind a storage-adapter contract
(local disk now, S3 contract BLOCKED_EXTERNAL); streaming 25MB cap, type
allowlist, hostile-filename sanitization, random never-exposed storage keys,
versioning, sha256, entity linking, concealment-correct download/delete,
Documents tab. OIDC: full Entra authorization-code adapter (discovery, state
check, userinfo → local-user mapping; local deactivation wins; JIT off by
default) tested against a mocked issuer; dormant until OIDC_* env configured.

## Completed: E15 realtime presenter sync (2026-08-07)
WebSocket rooms with session-cookie-authenticated upgrade (HMAC verified,
forged cookies 401). Transport carries view pointers only — data always flows
through authorized REST. Presenter chair with Viewer refusal and Admin/
Steering takeover, pivot broadcast, late-join replay, reconnect with backoff,
Follow-presenter opt-out in the live meeting view.

## Completed: E06 change control + baselines (2026-08-07)
Immutable versioned baseline snapshots (v1 = original; dates + approved budget
+ milestone plan); change requests (6 types, rationale enforced) decided only
by Steering/Admin with optimistic locking; approval auto-captures the next
baseline in-transaction, rejection never does; forecast edits leave history
untouched; Steering notified on submission; Project Room "Changes" tab.

## How to resume (future session)
Read this file + REQUIREMENT_TRACEABILITY.md + DECISIONS.md, run `npm test`,
then take the next item above as a vertical slice (schema → service → routes → UI → tests → docs).

## Completed: two-tier governance — LITE vs STANDARD (2026-08-07, D-26)
User directive: keep every guardrail, add flexibility by project complexity,
reduce bureaucracy. LITE projects need only a description at Gate 0, only a PM
at Gate 1, only one milestone (plus Steering) at Gate 2, and a go-live check
only if one is planned — while stage order, Steering-only approvals, the
critical-roadblock deployment block, close discipline, confidentiality/site/
finance masking, locking and audit stay identical in both tiers. Tier is set
by Admin/Division Lead only. The Project Room now shows the next gate's
met/unmet checklist so gates read as a to-do list, not a surprise rejection.
