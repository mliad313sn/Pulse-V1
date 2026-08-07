# Execution Status

Updated: 2026-08-07 · Branch: `claude/pulse-platform-build-0n6w1u` · Tests: **100/100 green** · `npm audit`: 0 vulnerabilities

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

## Next executable work items (dependency order)
8. **E28**: i18n string extraction (EN/FR) then axe automation.
9. **E23**: server-side export service + PDF + seeded leak tests.
10. **E15**: WebSocket presenter sync.
11. **E06**: baselines + change requests.
12. **E30**: release qualification per §108 journeys.

## How to resume (future session)
Read this file + REQUIREMENT_TRACEABILITY.md + DECISIONS.md, run `npm test`,
then take the next item above as a vertical slice (schema → service → routes → UI → tests → docs).
