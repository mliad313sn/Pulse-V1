# PULSE — MASTER PLAN v2.1 (PostgreSQL edition; supersedes v2.0)
## IT Project Tracking & Alignment Platform — Endeavour Mining Group IT
### Companion file to /goal prompt — SINGLE SOURCE OF TRUTH for all build phases

---

## 0. CONTEXT & MISSION

Endeavour Mining Group IT has 7 divisions: **Infrastructure** (networks & systems), **Business Apps** (ERP & business applications), **Data Insight** (BI & reporting), **Information Security** (cyber & infosec), **Operations** (day-to-day site IT, site IT managers), **Enterprise Architecture** (future design), plus Group IT leadership. Infrastructure and Operations are structurally interdependent: **no infrastructure can be deployed or operated without Operations**. Sites: SGO, HGO, ITY, SML, MGO, KGO + regional offices (Dakar, Abidjan, Ouagadougou). All locations are **GMT (UTC+0)**: store timestamptz UTC, display GMT; "today"/"overdue" boundaries = GMT midnight.

**Mission:** one shared, easy-to-use web platform where all divisions see the same project truth — status, roadblocks, next actions — structured around a recurring coordination meeting, with one-click export of presentation-ready decks (group portfolio, single project, or **site-scoped**) in Endeavour corporate style.

**Design principles (non-negotiable):**
1. **30-second rule** — any user understands the state of any project in 30 seconds.
2. **Computed truth** — status and progress are calculated from data, never self-declared without a justified override.
3. **The tool IS the meeting** — agenda, capture, minutes all live in the app.
4. **Zero-training UX** — a site technician and a CIO both use it without a manual.
5. **Site is a first-class dimension** — everything filterable and viewable by site; site IT leads can drive projects, not just execute them.
6. **Nothing trapped** — every object exportable (PPTX, XLSX).

**Non-functional targets:** ≤150 users, ≤500 active projects; browsers = latest 2 versions of Chrome & Edge; loads <4s on simulated 2 Mbps; English UI (FR toggle = V2); no external CDN — all assets served locally. **Database: PostgreSQL 16.**

---

## 1. USERS, ROLES & PERMISSION MATRIX

**Base roles (on the user account):**

| Role | Who |
|---|---|
| Admin | Group IT Manager (platform owner) |
| Division Lead | Heads of the 7 divisions |
| Contributor | Site IT leads, engineers |
| Viewer | CIO, stakeholders |

**Project Manager is NOT a base role — it is a per-project assignment.** Any active non-Viewer user (Admin, Division Lead, or **Contributor — explicitly including site IT leads**) can be set as `projects.project_manager_id`. Being PM grants **full edit rights on that project only** (project fields, milestones, roadblocks, actions, updates, exec_commentary, meeting items about it), while the user keeps their base-role rights everywhere else. A site IT lead can therefore drive an SGO deployment end-to-end without gaining group-wide powers.

**Edit-rights matrix (enforced server-side on every route; deny by default):**
- **Admin:** everything, incl. user management, confidential projects, soft-deletes, config.
- **Division Lead:** create projects; FULL edit on projects where own division = LEAD; on projects where own division = ENGAGED/CONSULTED: create/edit milestones, roadblocks, actions whose owner_division/owner is in own division, post status updates; read all.
- **PM (assignment):** FULL edit on assigned projects, regardless of base role or division.
- **Contributor:** edit any item where owner_user_id = self (mark done, update); create actions/roadblocks on projects touching own division or own site; post status updates on those projects; read all non-confidential; PLUS full PM rights on projects where assigned PM.
- **Viewer:** read all non-confidential + deck/XLSX export. No writes ever (verified by automated test). Cannot be assigned PM.

**Auth (V1 local, V2 Entra-ready):** email + password. bcrypt cost 12; min length 10; forced password change at first login; account lockout 15 min after 5 failed attempts; login endpoint rate-limited (10/min/IP). Auth implemented as an isolated module with a single interface (`authenticate(req) -> user|null`) so Entra ID OIDC can replace it without touching business code.

**Sessions:** express-session with **connect-pg-simple** (session table in PostgreSQL) — sessions MUST survive app-container restarts. Cookie: HttpOnly, SameSite=Strict, Secure behind TLS. **CSRF:** double-submit — csrf token issued at login; every mutating request carries it in `X-CSRF-Token`; verified middleware-side.

**Confidential flag** (Admin-set): hides project from Contributors/Viewers everywhere including search, reports, decks (see §5).

---

## 2. DATA MODEL (PostgreSQL 16)

**Conventions (mandatory):** all PKs `bigint GENERATED ALWAYS AS IDENTITY`; timestamps `timestamptz`; all enum-like columns get CHECK constraints (plain text + CHECK, not native ENUM types — easier migrations); FK constraints ON with `ON DELETE RESTRICT`; **index every FK column + all due_date/status/date columns**; `users.email` unique case-insensitively (`UNIQUE INDEX ON lower(email)`); schema managed by **plain SQL migration files run by a small node migration runner** (`/src/db/migrations/00X_*.sql`, applied in order, tracked in a `schema_migrations` table). All tables: id, created_at, updated_at, created_by, **deleted_at (soft delete — no hard DELETE anywhere; delete = Admin-only, sets deleted_at, audit-logged; all queries filter `deleted_at IS NULL`)**.

**Concurrency — optimistic locking:** every PUT/PATCH includes the `updated_at` the client last read; UPDATE runs `... WHERE id=$1 AND updated_at=$2`; zero rows affected → **409 Conflict** with current record; UI shows "This item changed — review and retry". No silent overwrites. All multi-table writes (e.g. meeting close, project create with code) wrapped in transactions via the pg pool.

**Project codes:** `PRJ-{YYYY}-{NNN}` issued from a `sequences` table row locked with `SELECT ... FOR UPDATE` inside the create transaction — collision-free under concurrency.

**divisions** (seed): code, name — INF, OPS, BAP, DAT, SEC, EAR, GRP
**sites** (seed): code, name — SGO, HGO, ITY, SML, MGO, KGO, DKR, ABJ, OUA, GROUP
**sequences**: name, next_value
**users**: name, email, password_hash, role CHECK(ADMIN|DIVISION_LEAD|CONTRIBUTOR|VIEWER), division_id FK, site_id FK nullable, active, must_change_password, failed_logins, locked_until
**projects**: code UNIQUE, title, description, lead_division_id FK, project_manager_id FK→users (any non-Viewer; site IT leads eligible), sponsor, stage CHECK(IDEA|DESIGN|BUILD|DEPLOY|RUN|CLOSED|ON_HOLD), priority CHECK(P1|P2|P3), start_date, target_date, actual_end_date, budget_note, roadmap_pillar CHECK(Network|BizPartnering|Risk|People|Other), confidential BOOL, rag_override nullable CHECK(G|A|R), rag_override_reason (≥30 chars enforced when override set), exec_commentary, **rag_computed CHECK(G|A|R), rag_signals_json jsonb, progress_pct (computed, §3), last_activity_at** (denormalized for fast Portfolio queries; refreshed by RAG engine)
**project_divisions** (M:N): project_id, division_id, role_in_project CHECK(LEAD|ENGAGED|CONSULTED)
**project_sites** (M:N): project_id, site_id — drives every site view/filter/deck scope
**milestones**: project_id, title, type CHECK(STANDARD|SECURITY_GATE|SITE_READINESS|UAT|GO_LIVE), owner_division_id, owner_user_id, co_owner_user_id (Infra↔Ops pairing), site_id nullable, due_date, status CHECK(NOT_STARTED|IN_PROGRESS|DONE|SLIPPED), done_date, order_index
**roadblocks**: project_id, title, description, severity CHECK(CRITICAL|MAJOR|MINOR), owner_user_id, raised_by_division_id, due_date, status CHECK(OPEN|IN_PROGRESS|RESOLVED|ESCALATED), resolution_note, escalated_to nullable
**actions**: project_id nullable (null = general action; appears in My Actions and meeting minutes; excluded from project RAG), meeting_id nullable, title, owner_user_id, due_date, status CHECK(OPEN|DONE|CANCELLED), done_date, source CHECK(MEETING|PROJECT|ROADBLOCK), roadblock_id nullable. "Overdue" = OPEN AND due_date < today(GMT). CANCELLED never counts anywhere.
**meetings**: title, date, type CHECK(INFRA_OPS_SYNC|PROJECT_REVIEW|ADHOC), status CHECK(PLANNED|LIVE|CLOSED)
**meeting_attendees** (M:N): meeting_id, user_id, present BOOL — join table, NOT JSON (enables attendance reporting later)
**meeting_items**: meeting_id, project_id nullable (ad-hoc items allowed), order_index, notes
**decisions**: project_id, meeting_id nullable, text, decided_by, date
**status_updates**: project_id, date, author_id, mood CHECK(ON_TRACK|WATCH|AT_RISK), summary ≤400 chars — **2 fields only; NO declarative progress% — progress is computed (§3)**
**readiness_items**: milestone_id (type SITE_READINESS), label, checked BOOL, checked_by, checked_at — seeded template: power, rack space, LAN ready, local hands identified, access badge, change window agreed
**notifications**: user_id, type CHECK(ROADBLOCK_ESCALATED|ACTION_ASSIGNED|MILESTONE_ASSIGNED|PROJECT_RED|MEETING_SCHEDULED|PM_ASSIGNED), entity, entity_id, text, read_at nullable — powers bell icon + unread count. Triggers: escalation → Admin + Division Leads of engaged divisions; action/milestone assigned → owner; project turns RED → PM + lead Division Lead; meeting created → PMs of agenda projects; **PM_ASSIGNED → the newly assigned PM**. In-app only (email/Teams = V2).
**rag_history**: project_id, snapshot_date, rag, progress_pct — written by weekly job (§6); feeds Reports trends.
**audit_log**: entity, entity_id, field, old_value, new_value, user_id, timestamp — middleware on ALL writes; **never logs password_hash or session values**; read endpoint paginated, Admin-only.

---

## 3. RAG & PROGRESS ENGINE (server-side; recomputed on any write touching a project or its children; result stored on projects row)

**progress_pct = (milestones DONE / total milestones) × 100** (0 if no milestones). Single definition, computed truth.
**last_activity_at** = timestamp of most recent write of any kind on the project or its children.

Four signals, each G/A/R:
- **Schedule:** % of milestones SLIPPED or overdue (due < today, not DONE): 0% → G; ≤20% → A; >20% → R.
- **Roadblocks:** any OPEN/ESCALATED CRITICAL → R; any OPEN/IN_PROGRESS MAJOR → A; else G.
- **Actions:** overdue project actions: 0 → G; 1–3 → A; >3 → R.
- **Freshness:** R if **no activity of ANY kind** > 30 days (truly silent project); A if no status_update > 21 days (working but not narrating); else G.

**Overall rag_computed = worst of the 4.** Signals stored in rag_signals_json for the breakdown tooltip. Manual rag_override requires rag_override_reason ≥30 chars (server-enforced); displayed with a "manual" badge + reason on hover — no silent green-washing. Stages RUN, CLOSED, ON_HOLD exempt from Freshness. Engine = pure function `computeRag(projectAggregate) -> {rag, signals}` covered by unit tests on all boundary cases.

---

## 4. VIEWS & UX

**Global shell:** left nav (Portfolio, Meetings, Sites, My Actions, Reports, Admin), top bar: global search + notification bell (unread count) + "Export Deck". **Global search** = GET /api/v1/search?q= → projects (code/title ILIKE) + roadblock titles, respecting confidentiality. Palette tokens (single CSS-vars file, reused by deck engine so app and PPTX can never drift): navy `#1A3A5F`, orange `#E87722`, RAG GREEN `#2E9E8F`, AMBER `#F2A900`, RED `#C8102E`; font stack Calibri, "Segoe UI", sans-serif. Responsive; Site Lens and My Actions phone-first. Every list view has a designed empty state; every mutation shows success/error toast.

**Site as a universal filter:** the site filter exists on Portfolio, Reports and search — not only in Site Lens. Any filtered Portfolio state is exportable as a deck (§5), which yields per-site decks natively.

**4.1 Portfolio Wall (home):** KPI banner (Total | G/A/R | Open critical roadblocks | Overdue actions | Silent projects) — banner recomputes to reflect active filters. Project cards: code, title, RAG dot (tooltip = 4-signal breakdown), stage chip, lead-division badge, engaged mini-badges, site chips, computed progress bar, top roadblock, next milestone + date, days-to-target, PM avatar. Filters: division, **site**, stage, RAG, priority, PM; sorts: RAG severity, target date. Click → Project Room.

**4.2 Project Room:** header (title, RAG + breakdown, stage stepper IDEA→RUN, PM — may be a site IT lead — sponsor, divisions, sites, dates, progress). Tabs:
- **Timeline:** milestones as horizontal timeline + list; co-owner shown as paired avatars (Infra/Ops); SECURITY_GATE and GO_LIVE visually distinct; SITE_READINESS expands checklist inline.
- **Roadblocks:** severity-colored table, owner, due, age in days; Escalate button → status ESCALATED + notifications per §2.
- **Actions:** quick-add inline (title + owner + due, Enter to save).
- **Updates & Decisions:** feed; "Post update" = mood + ≤400-char summary, 2 fields, done in 20 seconds.
**Right rail:** exec_commentary box ("what the CFO/CIO must understand this month" — feeds decks verbatim).

**4.3 Meeting Mode (the heart):**
- **Prepare:** create meeting → auto-agenda: (a) RED projects, (b) AMBER, (c) new roadblocks since last CLOSED meeting of same type, (d) overdue actions grouped by owner, (e) GO_LIVE ≤30 days, (f) silent projects. Optional **site scope** on the meeting: agenda rules then apply only to that site's projects (enables site-level reviews). Organizer reorders/removes/adds items; picks attendees.
- **Live (projection layout, large type, dark header):** item-by-item; each screen = project card + roadblocks + open actions; persistent capture bar [+ Action] [+ Decision] [+ Roadblock] [Note] — each creates the REAL object attached to project AND meeting, ≤3 fields. **Concurrency model V1: single-driver** — one organizer captures on the projected screen; others view read-only and refresh manually; no websockets (SSE live-sync = V2; UI labels this "presenter mode").
- **Close:** generates **minutes as structured JSON** (attendees, per-item notes, decisions, actions with owners/dues, RAG snapshot) rendered server-side to HTML **with full output escaping — user text is never interpreted as HTML (stored-XSS prevention)**. Editing minutes = editing the underlying notes/objects, then re-render. Print stylesheet for PDF + "Copy for email" (sanitized HTML to clipboard).

**4.4 Site Lens:** pick any site → everything about it: active projects (cards, same RAG language as Portfolio), site milestones, readiness checklists, roadblocks, actions owned by site staff, upcoming GO_LIVEs. The site IT manager's daily page — and the entry point from which a site IT lead who is PM drives their own projects. One-tap "Export site deck" from here.

**4.5 My Actions:** my open actions + owned roadblocks + milestones due ≤30 days + **projects where I am PM** (mini-cards on top), sorted by due; one-tap Done.

**4.6 Reports:** division workload (led/engaged), **RAG trend from rag_history**, roadblock aging, action resolution rate, **per-site breakdown of all of the above** — Chart.js using palette tokens; XLSX export of any table via client-side SheetJS from API JSON.

---

## 5. DECK EXPORT ENGINE (**client-side PptxGenJS** — no server headless deps; library served locally)

All modes produce .pptx in Endeavour Group IT style: navy #1A3A5F title band, orange #E87722 badge, Calibri, footer "Endeavour Mining — Group IT — {Month Year} — Confidential", navy commentary bands, RAG cells using the exact palette hexes from §4.

**A. Group Portfolio Deck:** S1 title; S2 KPI slide (counts, RAG donut, critical roadblocks); S3 portfolio table (code, title, lead div, sites, stage, RAG, next milestone, target) auto-paginated 10 rows/slide; S4 "Roadblocks requiring leadership" (CRITICAL + ESCALATED, owner/due); S5 per-division one-liners; S6 Executive Commentary assembled from RED/AMBER projects' exec_commentary. **The deck honors the active Portfolio filters** — filter to one site (or division, or stage) and export = a **site-scoped deck**, title auto-adjusted ("IT Projects — SGO — Aug 2026"); no separate template needed. Site Lens "Export site deck" triggers exactly this with the site pre-filtered.
**B. Project Deck:** S1 title (project, PM, sponsor, RAG); S2 elevator card (description, divisions, sites, dates, computed progress, stage stepper); S3 timeline slide (milestones as shapes on a date axis: DONE=green #2E9E8F, SLIPPED/overdue=red #C8102E, future=grey); S4 roadblocks & mitigations; S5 next actions; S6 decisions log; S7 exec commentary band.

**Rules:** decks respect the exporter's permissions — **confidential projects excluded unless exporter is Admin**; no raw IDs on slides; dates "12 Aug 26"; empty sections auto-skipped; filename `PULSE_{Group|SiteCode|ProjectCode}_{YYYY-MM-DD}.pptx`. Acceptance = presentable to CIO with **zero manual rework**.

---

## 6. TECH STACK, ARCHITECTURE, FILE TREE & OPERATIONS

- **Backend:** Node.js 20 LTS + Express; **PostgreSQL 16 via `pg` (node-postgres) connection Pool**, `DATABASE_URL` from env; parameterized queries ONLY (no string-built SQL anywhere); transactions for all multi-write operations; REST JSON `/api/v1/...`; zod validation on EVERY input; helmet; express-rate-limit (global API + strict login limiter); CSRF per §1; audit middleware; auth module per §1. **Dependencies pinned exact versions; npm audit clean at each gate.**
- **Migrations:** plain SQL files + node runner (§2); `npm run migrate` idempotent; seed via `npm run seed`.
- **List endpoints paginated** (`?limit=50&offset=`, max 200); Portfolio endpoint returns all active projects (cap 500).
- **Frontend:** no-build vanilla JS ES modules + small component helpers; Chart.js, PptxGenJS, SheetJS vendored locally under /public/vendor.
- **Scheduled jobs (node-cron in app process):** Mondays 06:00 GMT → rag_history snapshot for all non-CLOSED projects; daily 02:00 GMT → **`pg_dump -Fc` to /backups volume, then a verification pass (`pg_restore --list` on the dump; abort + error log on failure), 14-day retention**.
- **Deploy: docker-compose, two services** — `app` (node:20-alpine) and `db` (postgres:16-alpine) with named volume `pgdata`; shared volume `/backups`; env: DATABASE_URL, SESSION_SECRET, PORT (.env never committed; .env.example provided); app waits for db healthcheck. `npm run restore <dumpfile>` script documented + drilled.
- **File tree (agent MUST follow):**
```
/src/server.js  /src/db/{pool.js,migrate.js,seed.js,migrations/00X_*.sql}
/src/modules/{auth,projects,milestones,roadblocks,actions,meetings,notifications,rag,reports,search,audit}/  (routes.js, service.js per module)
/src/middleware/{authz.js,csrf.js,audit.js,errors.js}
/src/jobs/{snapshot.js,backup.js}
/public/{index.html,css/tokens.css,css/app.css,js/views/...,js/lib/...,vendor/...}
/tests/{api/,unit/,e2e-checklist.md}  /scripts/{backup.sh,restore.sh}
docker-compose.yml  Dockerfile  .env.example  README.md  ADMIN_GUIDE.md  USER_QUICKSTART.md  CHANGELOG.md
```
- **Testing:** node:test (built-in) + supertest for API against a dedicated test database (`DATABASE_URL_TEST`, migrated + truncated between suites); unit tests for computeRag (all boundaries) and the permission matrix (every role × every route class, incl. "Viewer cannot write" and **"Contributor assigned PM gains full edit on that project only"**); `npm test` runs everything; regressions block gates.

---

## 7. BUILD PHASES & SUCCESS CONDITIONS (gates — do NOT advance until all pass)

**P1 Design freeze:** clickable HTML mock (real palette tokens, fake data) of Portfolio Wall, Project Room, Meeting Live, **Site Lens**. ✔ Gate: user says "GO P2".
**P2 Foundation:** docker-compose up (app+db); migrations+seed; auth incl. lockout + forced first-login change; sessions in Postgres (survive app restart — tested); CSRF; CRUD APIs with zod + optimistic locking + transactions. ✔ Gate: API suite 100% green; permission tests prove Viewer cannot write, Division Lead blocked outside own scope, **Contributor+PM assignment = full edit on that project, still restricted elsewhere**; restarting the app container keeps a session alive; concurrent-edit test returns 409; project codes unique under 20 parallel creates.
**P3 Core UI + RAG:** Portfolio + Project Room live. ✔ Gate: seeded scenarios — slipped milestone + critical roadblock → RED automatically; silent project (>30d) → RED; ON_HOLD exempt; override without 30-char reason rejected server-side; RAG tooltip shows 4 signals; **site filter narrows cards AND the KPI banner**.
**P4 Meeting Mode:** full prepare/live/close incl. **site-scoped meeting agenda**. ✔ Gate: simulated INFRA_OPS_SYNC — agenda auto-built with all 6 rules; 2 actions + 1 decision + 1 roadblock captured live exist as real linked objects; minutes render a `<script>alert(1)</script>` note AS TEXT (XSS test); notifications fired per §2 incl. PM_ASSIGNED.
**P5 Site Lens + My Actions + Reports:** ✔ Gate: Site Lens shows exactly that site's items incl. readiness checklists; My Actions shows PM mini-cards for a Contributor-PM; RAG trend reads rag_history after forcing the snapshot job; per-site report breakdowns correct; XLSX opens clean in Excel.
**P6 Deck Engine:** ✔ Gate: Group deck, Project deck AND **site-filtered deck (from Site Lens button)** generated from demo data, opened in PowerPoint, style matches tokens, title auto-adjusts to scope, confidential project absent from non-Admin export, zero manual fixes.
**P7 Hardening & UAT:** rate limits verified; npm audit clean; audit log complete + paginated; empty states; toasts; 2 Mbps load <4s; **pg_dump→verify→pg_restore drill executed into a fresh database and app runs on it**.

**FINAL ACCEPTANCE CHECKLIST:**
- [ ] New Contributor onboarded and posts a status update in <3 min unaided
- [ ] A site IT lead assigned PM manages their project end-to-end (edit milestones, close roadblock, export project deck) with a Contributor account
- [ ] computeRag unit tests cover all boundaries incl. silent-project and ON_HOLD exemption
- [ ] Escalated critical roadblock: banner count + notifications within one refresh
- [ ] Minutes reproduce every live-captured item; XSS payload rendered inert
- [ ] Concurrent edit produces 409 + friendly merge UI, never silent overwrite
- [ ] Group, project AND site decks presentable as-is; confidentiality respected
- [ ] Sessions survive app restart; lockout after 5 failures; forced first-login change works
- [ ] All writes audited (no secrets logged); soft-delete only; parameterized SQL everywhere (spot-checked)
- [ ] pg_restore drill passed into a clean database
- [ ] Lighthouse mobile perf ≥85; <4s on simulated 2 Mbps

## 8. OUT OF SCOPE V1 (protect delivery — log as V2 backlog)
Gantt dependency engine, email/Teams notifications, Entra ID SSO (module boundary ready only), FR localization, file attachments, SSE live meeting sync, mobile app, budget tracking, attendance analytics, read replicas/HA Postgres.
