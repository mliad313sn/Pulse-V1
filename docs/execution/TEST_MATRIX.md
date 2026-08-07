# Test Matrix (current suites → plan areas)

| Suite | Count | Covers |
|---|---|---|
| tests/unit/computeRag.test.js | 18 | §24-26 RAG signals/boundaries/exemptions |
| tests/unit/stageGates.test.js | 6 | §12-13 lifecycle machine, gate prereqs, Steering independence |
| tests/api/auth.test.js | 7 | §61-62 lockout, forced change, pg-session survival, CSRF |
| tests/api/permissions.test.js | 9 | §5-9,76 role matrix, PM scoping, confidentiality, audit hygiene, soft delete |
| tests/api/projects.test.js | 7 | §11,58,129 codes under concurrency, 409, override validation, filters |
| tests/api/rag.test.js | 8 | §24-25 via API incl. silence + revival |
| tests/api/meetings.test.js | 6 | §35-39 agenda rules a-f, capture, XSS-inert minutes, notifications |
| tests/api/reports.test.js | 5 | §45-46,49 site lens, my-work, snapshots/trend, search scope |
| tests/api/ratelimit.test.js | 2 | §164 login + API limiters |
| tests/api/ecosystem.test.js | 6 | gates via API, RACI, site isolation, sync idempotency, halt alert |
| tests/api/risk-capa.test.js | 5 | §27-29 risks, CAPA lifecycle, reopen, agenda rules 7-8, channel adapters |
| **Total** | **79** | |

Gaps to add next: minutes versioning, task dependency/cycle tests, export leak tests
with seeded unauthorized records, reminder idempotency, i18n/a11y smoke.
