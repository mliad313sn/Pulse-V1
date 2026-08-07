# Release Qualification — RA-01 … RA-20 evidence map (E30)

Qualification run: 2026-08-07 · suite **119/119 green** (`npm test`) ·
`npm run a11y` PASS · backup→restore drill re-executed against the current
13-migration schema. Every journey below cites the automated evidence that
carries it; nothing is claimed on manual observation alone.

| RA | Journey | Automated evidence |
|----|---------|--------------------|
| RA-01 | Admin provisioning: user CRUD, privilege, reset, audit | `auth.test.js` (admin user management, reset forces change, audits), `finance.test.js` §2 (flag grant/revoke audited) |
| RA-02 | Full lifecycle IDEA→CLOSED with gate checks | `ecosystem.test.js` §1–2 (IDEA→EXECUTION, skip refusal, per-gate field checks) + `qualification.test.js` §1 (EXECUTION→DEPLOYMENT→RUN→CLOSED, 6-row transition ledger) |
| RA-03 | Contributor restriction | `permissions.test.js` (owned-item writes allowed; core/admin actions 403) |
| RA-04 | Viewer read-only | `permissions.test.js`, plus viewer write refusals in `changes/attachments/finance/portfolio` suites; exports readable (`exports.test.js`) |
| RA-05 | Steering separation | `ecosystem.test.js` §2 (non-Steering FULL-access 403 at Gate 2), `changes.test.js` §2 (PM cannot decide CR), unit `stageGates.test.js` |
| RA-06 | Enterprise access / site isolation | `ecosystem.test.js` §4 (list + direct-object 404), `exports.test.js` §2 (site-restricted export has zero cross-site trace) |
| RA-07 | Confidentiality (no inference) | `permissions.test.js` (concealed 404s), `portfolio.test.js` §3 (rollup counts exclude), `exports.test.js` (absent from xlsx/pdf/pptx bytes), `attachments.test.js` §2 (documents concealed) |
| RA-08 | Progress recalculation explained | `projects.test.js` / `rag.test.js` (milestone DONE → progress_pct + explained signals) |
| RA-09 | RAG: four signals + override | unit `computeRag.test.js` (all signals, worst-wins, freshness exemptions), `rag.test.js` (override ≥30-char reason, history) |
| RA-10 | Roadblock/CAPA: escalate, resolve, reopen, verify | `risk-capa.test.js` (escalation notification, reopen with reason, CAPA verification chain, overdue-CAPA agenda rule) |
| RA-11 | Meeting: agenda→live capture→minutes→version correction | `meetings.test.js` (9 auto-agenda rules, capture creates real objects, close snapshots minutes, re-close = version 2 with immutable v1) |
| RA-12 | Readiness → gate → GO_LIVE → RUN | `qualification.test.js` §1 (SITE_READINESS checklist items checked, RUN refused until GO_LIVE DONE, then RUN) |
| RA-13 | Resource overload explained | `resources.test.js` ("125% allocated across N projects: …" explanation, agenda rule 9) |
| RA-14 | Finance variance + masking | `finance.test.js` (variance math + explanation string; PM/lead/viewer 403; flag revocation immediate; executive block masked) |
| RA-15 | Filtered dashboard matches PPTX/PDF/XLSX | `exports.test.js` (X-Export-Rows parity, adaptive titles, per-format semantic content checks vs the same filters) |
| RA-16 | Scheduled dispatch: runs, recipient scope, logged | `qualification.test.js` §2 (weekly digest via `jobs/reportDispatch`; viewer count = admin − confidential; idempotent per ISO week; `report_dispatch_log` + REPORT notifications) |
| RA-17 | Concurrency: no silent overwrite | optimistic-locking 409 tests across projects/milestones/roadblocks/actions/changes suites; two-context browser drill (earlier phase, e2e-checklist.md) |
| RA-18 | Offline: ordered replay + conflict halt | `ecosystem.test.js` §5–6 (sync idempotency, halt alerts every admin, no auto-resolution); browser network-drop drill (e2e-checklist.md) |
| RA-19 | Backup/restore | drill re-run 2026-08-07 on current schema: `pg_dump -Fc` + verify → restore into fresh DB → row parity on 8 tables incl. schema_migrations(13) → live login against restored DB. Scripts `scripts/backup.sh|restore.sh`, nightly job `jobs/backup.js` |
| RA-20 | i18n/accessibility | `npm run a11y` (scripts/a11y_drill.js): axe serious/critical = 0 on login/wall/My Actions/Executive (EN + FR), keyboard-only login, FR strings asserted, html lang switches |

## Known qualification limits (honest)
- RA-17/RA-18 browser drills were executed and recorded in `tests/e2e-checklist.md`
  during the earlier phase; the API-level invariants are permanently in the suite.
- RA-20 covers the core journey; deep views (project room, meetings, admin,
  reports) are not yet translated and carry moderate (non-gating) axe findings.
- RA-16 dispatch delivers through the notification channel layer; live Teams/
  SMTP delivery still needs real credentials (EXTERNAL_DEPENDENCIES.md).
