# Execution Status

Updated: 2026-08-07 · Branch: `claude/pulse-platform-build-0n6w1u` · Tests: **119/119 green** · `npm audit`: 0 vulnerabilities

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

## Queue: EMPTY — master-plan completion contract met (2026-08-07)
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
