# Requirement Traceability — PROJECT_MASTER_PLAN.md vs implementation

States: COMPLETE (implemented + tested) · PARTIAL (core works, plan asks for more) · NOT_STARTED · BLOCKED_EXTERNAL (code+tests done, real credential missing).
Evidence = test file(s) unless noted. Updated: 2026-08-07.

| Epic | Scope (plan §) | State | Implementation | Evidence / gap |
|---|---|---|---|---|
| E00 Foundation | §70,83,85 | PARTIAL | Node20+Express+PG16 modular monolith (JS, not TS monorepo); docker-compose; migrations+seed; no CI workflow yet | 79 tests green; `npm run migrate/seed`. Gap: TypeScript monorepo/CI per §70 — recorded decision D-20 keeps current coherent architecture |
| E01 Organization & users | §4,6 | PARTIAL | divisions/sites/users, admin CRUD, soft delete | auth.test, permissions.test. Gap: Service/Team tier, multi-membership |
| E02 Auth & sessions | §61,62 | PARTIAL | local auth (bcrypt12, lockout, forced change), pg sessions, CSRF, rate limits | auth.test, ratelimit.test. Gap: Entra OIDC adapter (BLOCKED_EXTERNAL once written), revoke-all-sessions |
| E03 Authorization & classification | §5–9 | PARTIAL | full RBAC matrix, PM assignment, Steering flag, enterprise access, project-level confidentiality (404-concealed, search/export safe) | permissions.test (9), ecosystem.test. Gap: RESTRICTED classification tier, finance-role dimension |
| E04 Portfolio/program/project | §10,11 | PARTIAL | projects w/ safe codes, divisions/sites, Project Room | projects.test (20-parallel codes). Gap: pillars/portfolio/program entities |
| E05 Lifecycle & governance | §12–14 | PARTIAL | no-skip stage machine, gate prerequisites, Steering-only gate, immutable-by-absence transition ledger, War Room | stageGates.test (6), ecosystem.test. Gap: 7-stage lifecycle naming (INITIATION/DEPLOYMENT), separate operating status, data-driven gate config, gate request/evidence records |
| E06 Change/baseline | §15,185 | NOT_STARTED | — | — |
| E07 Workstreams/tasks/Gantt | §17,18,20,184 | NOT_STARTED | — | — |
| E08 Milestones/progress/readiness | §21–23 | PARTIAL | 5 milestone types, readiness auto-checklist, computed progress | rag.test. Gap: weighted progress, forecast vs baseline dates, readiness template admin |
| E09 Actions | §19 | COMPLETE | quick-add, notify, done/cancel, sources, overdue analytics | permissions/meetings/reports tests |
| E10 Health | §24–26 | COMPLETE (core) | 4 signals worst-wins, explained tooltips, override ≥30 chars + badge + audit, freshness exemptions, rag_history trend | computeRag.test (18), rag.test (8). Optional extra dimensions not configured |
| E11 Risk/roadblock/CAPA | §27–29 | COMPLETE (core) | risk register (scored, residual), CAPA verified lifecycle, roadblock escalate/reopen-with-reason | risk-capa.test (5). Gap: heatmap UI, CAPA analytics dashboards |
| E12 Deliverable/RACI | §30,31 | PARTIAL | deliverables, R/A/C/I, R/A can progress | ecosystem.test. Gap: acceptance workflow, RACI quality warnings |
| E13 Updates/decisions | §32–34 | COMPLETE (core) | 20-second updates, exec commentary → decks verbatim, decision register | permissions, meetings tests. Gap: update revisioning, 4-mood naming |
| E14 Meetings | §35,36,39 | PARTIAL | 8 agenda rules (a–f + gates-waiting + overdue-CAPA), site scope, live capture, escaped minutes | meetings.test (6), risk-capa.test. Gap: minutes VERSIONING (single snapshot today), rule 9 (resource conflicts — needs E16) |
| E15 Realtime meeting sync | §38,124 | NOT_STARTED | single-driver presenter mode only | — |
| E16 Resources/time | §40,41 | NOT_STARTED | — | — |
| E17 Finance | §42,145 | NOT_STARTED | — | — |
| E18 Benefits | §43 | NOT_STARTED | — | — |
| E19 Notifications | §52 | PARTIAL | 7 in-app types incl. SYNC_HALTED, bell, deep links | meetings.test. Gap: dedupe keys, reminder schedule (T-14…T+7), preferences |
| E20 Email/Teams | §53 | PARTIAL/BLOCKED_EXTERNAL | channel dispatcher + delivery ledger + local sink + real Teams webhook adapter (tested via injected fetch); SMTP contract documented | risk-capa.test §5. Needs: TEAMS_WEBHOOK_URL, SMTP relay (see EXTERNAL_DEPENDENCIES.md) |
| E21 Scheduling/workers | §54,55,81 | PARTIAL | cron: weekly snapshot, daily verified backup | reports.test snapshot. Gap: reminder engine, scheduled report dispatch, durable queue |
| E22 Dashboards | §44–48 | PARTIAL | Portfolio Wall (filter-aware KPI), Site Lens, My Work, War Room, reports+trends | reports.test, browser smoke. Gap: Executive Command Center view, KPI drill-through links |
| E23 Exports | §56,91 | PARTIAL | client-side PPTX (group/site/project, filter+authz parity by construction: exports render only server-authorized data), XLSX | validated via python-pptx + PDF render. Gap: server-side export service, PDF, semantic leak tests |
| E24 Search/documents | §50,51 | PARTIAL | scoped search (projects+roadblocks, confidentiality/site safe) | permissions/ecosystem/reports tests. Gap: more entities in search, attachments (NOT_STARTED) |
| E25 Offline | §57 | COMPLETE (core) | IndexedDB FIFO log, ordered replay, halt-on-refusal, admin alert, human retry/discard, op-id idempotency | ecosystem.test + in-browser drill. Gap: PWA service worker shell |
| E26 Concurrency | §58 | COMPLETE | updated_at token, 409 + current record, UI retry guidance | projects.test §3 |
| E27 Backup/ops | §64,148 | COMPLETE (core) | nightly verified pg_dump, 14d retention, rehearsed scripted restore into fresh DB with app boot | executed drill 2026-08-06. Gap: encryption, tiered retention |
| E28 i18n/a11y/responsive | §68,69 | NOT_STARTED (FR) / PARTIAL (responsive) | responsive layouts exist; no i18n layer, no axe automation | — |
| E29 Security hardening | §86,112 | PARTIAL | parameterized SQL, zod, helmet CSP, CSRF, lockout, rate limits, XSS-inert minutes, secret-free audit, 0-vuln audit | across suites. Gap: formal threat-model doc, upload security (n/a yet), session revoke-all |
| E30 Release qualification | §107,108 | NOT_STARTED | blocked on epics above | RELEASE_READINESS.md tracks |
