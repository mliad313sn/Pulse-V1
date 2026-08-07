# PULSE — Strategic Portfolio Management platform

**Endeavour Mining — Group IT.** One governed system from strategic demand,
through project delivery, to benefit realization — built to be used in the
governance meeting itself, not written up afterwards.

Pulse started as an IT project tracker and has been extended into an
enterprise SPM platform. Every capability below is implemented, persisted,
authorized, audited and covered by tests: there are no mock screens and no
features that exist only in the roadmap.

- Requirements of record: [`docs/PULSE_MASTER_PLAN.md`](docs/PULSE_MASTER_PLAN.md)
- Capabilities and governance rules: [`docs/CAPABILITIES_AND_RULES.md`](docs/CAPABILITIES_AND_RULES.md)
- Operations, metrics, backup/DR: [`docs/RUNBOOK_OPERATIONS.md`](docs/RUNBOOK_OPERATIONS.md)
- Build log and decisions: [`docs/execution/`](docs/execution/) · [`CHANGELOG.md`](CHANGELOG.md)
- Admin manual: [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) · Quickstart: [`USER_QUICKSTART.md`](USER_QUICKSTART.md)
- Live API description: `GET /api/v1/openapi.json` (generated from the running router)

## What it does

**Strategy & demand.** Ideas are raised, scored (WSJF, RICE, weighted,
cost-of-delay — every score shows its formula and its missing inputs),
ranked with mandatory/compliance work pinned to the top, decided by Steering,
and converted into projects with a permanent two-way audit link. Objectives
and key results connect projects to the outcomes they serve.

**Planning.** WBS with summary rollups, FS/SS/FF/SF dependencies with lag and
lead, working calendars with holiday and worked-weekend exceptions, date
constraints, ES/EF/LS/LF, total and free float, critical and near-critical
paths, task baselines with variance, cross-project dependencies with
concealment-safe blast radius, schedule quality checks, and resource leveling
that proposes shifts within float without ever moving anyone's dates.

**Resources.** Skills with proficiency and certification, day-weighted weekly
and monthly capacity across project work, BAU, leave and tentative bookings,
role-based resource requests raised before anyone is named, approval by a
Division Lead, automated candidate matching that explains every ranking, and
skill-gap analysis.

**Finance.** Multicurrency budgets converted through managed FX rates,
time-phased cost plans, and full earned value (PV, EV, AC, CPI, SPI, BAC, ETC,
EAC, VAC) that stays honestly `null` rather than inventing indices when there
are no actuals. Every money figure is masked server-side for anyone without
the finance flag.

**Benefits.** Realization windows with time-phased measurement against the
*baseline* (40→25 incidents is 100% realized at 25, not 62%), missing periods
named instead of averaged away, and observation that deliberately continues
after the project closes — the honest test of whether a benefit was real.

**Health.** Seven weighted dimensions (schedule, risks, finance, governance,
resources, benefits, data confidence) scored by criticality rather than
counts, each linking the actual records that moved it. Progress can be
measured by milestone, task, effort, cost or physical assessment, and always
reports which basis produced the number.

**Decisions.** Scenario objects model defer/stop/budget moves with pure
zero-mutation evaluation, mathematical portfolio optimization under a budget
constraint with mandatory work funded first and every in/out decision
explained, and promotion that turns an approved scenario into governed change
requests — humans still approve each one. The decision graph answers *why does
this project exist, who approved what, what changed, and what breaks if it
slips*.

**Meetings.** Auto-built agendas, live capture that creates real linked
objects, decision-to-change-request conversion carrying the meeting evidence,
live read-only scenario simulation, and immutable versioned minutes.

**Intelligence.** AI drafts source-grounded executive summaries from *only*
the facts the requesting user is authorized to see, with a citation on every
fact. It has no write path: **AI never approves a gate, budget, baseline, CAPA
or portfolio decision.** Without an API key the endpoint returns a clear
`BLOCKED_EXTERNAL` rather than degrading silently.

**Platform.** Durable webhook outbox with HMAC-signed delivery, exponential
backoff and a real dead-letter queue; OpenAPI generated from the live router;
integration adapter contracts for Jira, Azure DevOps, ServiceNow, Teams,
Power BI, ERP, HRIS and SCIM, each declaring its credentials and refusing to
pretend when unconfigured; external identity mapping anchored on immutable
source-system ids.

## Non-negotiable rules

These hold for every user, on every surface, enforced server-side:

- No skipping a lifecycle stage, and no gate without its required evidence.
- No approving the execution gate or a change request without Steering/Admin authority.
- Nothing from a confidential project you are not on — not seen, counted, searched, exported or downloaded.
- No other site's data if your account is site-restricted.
- No money figure without the finance flag.
- No overwriting a colleague's concurrent edit, erasing a baseline, editing closed minutes or deleting audit history.
- No overriding a health status without writing a real justification.

Governance tiers (`LITE` / `STANDARD`) trim gate *paperwork* for small or
simple work. They never relax any rule above — the guardrails are identical in
both tiers.

## Stack

Node 22 + Express + **PostgreSQL 16** · plain-SQL migrations with a tracked
runner · REST `/api/v1` · zod validation on every input · helmet · rate limits ·
double-submit CSRF · sessions in PostgreSQL · bcrypt(12) with lockout and
forced first-login change · optimistic locking (409 on stale edits) · audit
trail on every write · structured JSON logging with correlation ids ·
Prometheus metrics · durable webhook outbox · no-build vanilla-JS frontend.

## Deploy in 10 minutes (docker-compose)

```bash
git clone <this repo> && cd Pulse-V1
cp .env.example .env
#   set SESSION_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose up -d
```

The app container waits for the database healthcheck, runs `npm run migrate` on
boot (idempotent) and starts the scheduled jobs. Backups land on the `backups`
volume.

> Behind TLS? Set `SECURE_COOKIES=true` so the session cookie is marked `Secure`.
> **In production the app refuses to start without a real `SESSION_SECRET`** —
> failing closed beats running on a dev default.

### Optional integrations

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | AI executive-summary drafting (read-only, cited) |
| `JIRA_*`, `ADO_*`, `SERVICENOW_*`, `ERP_*`, `HRIS_*`, `SCIM_TOKEN` | The matching integration adapter |
| `TEAMS_WEBHOOK_URL` | Teams notification channel |

Anything unset reports `BLOCKED_EXTERNAL` through `GET /api/v1/integrations`
and refuses to run. Nothing silently no-ops.

### Seeded demo accounts

| Account | Email | Password |
|---|---|---|
| Admin (Group IT Manager) | `admin@endeavourmining.com` | `ChangeMe-2026!` → forced change |
| Division leads | `inf.lead@` `ops.lead@` `bap.lead@` `dat.lead@` `sec.lead@` `ear.lead@endeavourmining.com` | `Endeavour-2026!` |
| Site IT leads (Contributors — several are PMs) | `awa.diallo@` `ibrahim.traore@` `sekou.camara@` `aminata.sow@` `moussa.ouedraogo@` `leila.toure@endeavourmining.com` | `Endeavour-2026!` |
| Viewer (CIO office) | `cio@endeavourmining.com` | `Endeavour-2026!` |

The demo data deliberately covers every RAG boundary: a RED project (slipped
milestone plus critical roadblock), a RED-by-silence project, an ON_HOLD
project (freshness-exempt), a manual override with reason, and a confidential
project.

## Running without Docker

```bash
createdb pulse
cp .env.example .env            # set DATABASE_URL + SESSION_SECRET
npm ci
npm run migrate && npm run seed
npm start                       # http://localhost:3000
```

## Tests

```bash
createdb pulse_test             # dedicated test DB (DATABASE_URL_TEST)
npm test
```

**214 tests**, all green: scheduling mathematics (CPM with all four dependency
types, working calendars, constraints, leveling), scoring and prioritization
models, EVM and FX arithmetic, benefit realization, health weighting,
portfolio optimization, the permission matrix, WebSocket authorization,
confidentiality and finance masking (asserted by searching serialized
responses and exported files for the values that must be absent), optimistic
locking, offline idempotency including a concurrent replay burst, governance
gates, webhook retry and dead-lettering, and a performance floor for the
portfolio wall.

`npm test` also runs `npm run check:frontend`, which parses every browser
module as an ES module — `node --check` parses as CommonJS and once accepted a
file the browser refused to load.

## Backups, restore and operations

Daily verified `pg_dump -Fc` with 14-day retention; a dump that cannot be
listed is deleted rather than kept as a false comfort. The restore drill,
metrics, alerting guidance and the honest scaling limits are documented in
[`docs/RUNBOOK_OPERATIONS.md`](docs/RUNBOOK_OPERATIONS.md) — written from a
drill that was actually executed, not from memory.

## Repository layout

```
src/server.js                app factory + boot (migrate → listen → jobs)
src/config.js                fail-closed configuration
src/db/                      pool, migration runner, seed, migrations/*.sql
src/modules/<m>/             routes.js + service.js per module —
                             auth, projects, milestones, roadblocks, actions,
                             meetings, notifications, rag (+ health), reports,
                             search, audit, tasks (+ schedule, calendar),
                             resources (+ capacity), finance (+ evm,
                             realization), demand, strategy, templates,
                             scenarios, graph, changes, attachments,
                             intelligence, platform (outbox, OpenAPI),
                             integrations, realtime, sync, exports
src/middleware/              authz (permission matrix), csrf, audit, errors,
                             observability (logging + metrics)
src/jobs/                    snapshot, backup, reminders, report dispatch
public/                      no-build frontend; css/tokens.css is the single
                             palette source shared by app AND deck engine
tests/                       unit/ + api/ suites
scripts/                     backup.sh, restore.sh, check_frontend.js, a11y_drill.js
```
