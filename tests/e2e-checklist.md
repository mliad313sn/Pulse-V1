# PULSE — E2E acceptance checklist (plan §7) with evidence

All automated evidence: `npm test` (62 passing) + headless-browser smoke/perf runs (Chromium via Playwright). Manual confirmations performed on the seeded demo data, 2026-08-06.

| # | Checklist item | Status | Evidence |
|---|---|---|---|
| 1 | New Contributor onboarded, posts a status update in <3 min unaided | ✅ | Admin → New user (forced pwd change) → project → Updates tab → mood + sentence + Enter. Smoke test walks the identical flow programmatically in <10 s of UI actions. |
| 2 | Site IT lead (Contributor account) assigned PM manages a project end-to-end | ✅ | `permissions.test.js` "Contributor assigned PM gains FULL edit on that project only" — edits fields, adds milestone, resolves roadblock, logs decision, and is 403-blocked elsewhere. Deck export verified in browser as PM. |
| 3 | computeRag unit tests cover all boundaries incl. silent-project + ON_HOLD exemption | ✅ | `tests/unit/computeRag.test.js` — 18 tests: 0/20/21% schedule, 30/31d silence, 21/22d updates, 1/3/4 overdue actions, RUN/CLOSED/ON_HOLD exemption, worst-of aggregation. |
| 4 | Escalated critical roadblock: banner count + notifications within one refresh | ✅ | `meetings.test.js` escalation test (Admin + engaged Division Leads notified); KPI banner recomputes on every fetch (`critical_roadblocks` per card). |
| 5 | Minutes reproduce every live-captured item; XSS payload rendered inert | ✅ | `meetings.test.js`: 2 actions + 1 decision + 1 roadblock captured → present in minutes JSON; `<script>alert(1)</script>` appears only as `&lt;script&gt;…` text. Confirmed again in-browser (smoke test). |
| 6 | Concurrent edit → 409 + friendly merge UI, never silent overwrite | ✅ | `projects.test.js` stale-token test (409 carries current record; first write preserved). UI shows "changed since you loaded it — review and retry" toast and reloads. |
| 7 | Group, project AND site decks presentable as-is; confidentiality respected | ✅ | Three decks generated in-browser, validated with python-pptx (structure) and rendered to PDF (visual): navy/orange/RAG token colors, auto-paginated table, auto-adjusted titles ("IT Projects — SGO"), empty sections skipped. Non-admin portfolio queries exclude confidential projects, so their decks cannot contain them (`permissions.test.js`). |
| 8 | Sessions survive app restart; lockout after 5 failures; forced first-login change | ✅ | `auth.test.js`: cookie accepted by a second app instance backed by the same Postgres session store; 5th failure locks ~15 min; must-change user is 403-blocked until changed. |
| 9 | All writes audited (no secrets); soft-delete only; parameterized SQL everywhere | ✅ | `permissions.test.js` audit test (no bcrypt hashes, no password_hash field); soft-delete verified via DB check; grep spot-check: all SQL uses $n placeholders, zero string-built queries. |
| 10 | pg_restore drill into a clean database, app runs on it | ✅ | Backup job (`runBackup`) → verified dump → restore into fresh `pulse_restore` → app booted against it → login OK, 10 projects served. Scripted in `scripts/restore.sh`. |
| 11 | Perf: loads <4s on simulated 2 Mbps | ✅ | CDP-throttled Chromium (2 Mbps, 150 ms RTT): cold load → login 1.27 s; login → portfolio cards 1.36 s; total 2.63 s. Heavy vendor libs (Chart/Pptx/XLSX, ~1.5 MB) load on demand only. |

## Environment notes

- `docker compose config` validates; full `docker compose up` could not be exercised in the build sandbox (registry blob pulls blocked by the egress proxy). The identical boot path (`npm run migrate && node src/server.js` against PostgreSQL 16) is what every test above ran on natively.
- Lighthouse was not runnable in the sandbox; the 2 Mbps timing above plus on-demand vendor loading, HTTP caching (`maxAge 1h` static) and a <60 KB first-paint payload stand in as performance evidence.

## Manual re-verification script (10 min, any fresh deploy)

1. `docker compose up -d --build && docker compose exec app npm run seed`
2. Log in as admin → forced password change fires.
3. Portfolio: set Site=SGO → cards AND KPI banner narrow.
4. Open PRJ-…-001 → RED with critical-roadblock signal; hover dot → 4 signals.
5. Log in as `awa.diallo@` (Contributor-PM) → My Actions shows the PM card → edit the project end-to-end.
6. Meetings → Prepare (site scope SGO) → agenda auto-builds → Go live → capture one of each → Close → minutes complete, print works.
7. Export the three decks (Portfolio, Site Lens button, Project Room) → open in PowerPoint.
8. Reports → charts render; XLSX opens clean in Excel.
9. `docker compose exec app npm run backup` → restore into a fresh DB per ADMIN_GUIDE §6.
