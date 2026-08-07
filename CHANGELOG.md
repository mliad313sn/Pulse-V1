# PULSE — CHANGELOG & Decision Log

All notable changes and build decisions, phase by phase. Source of truth for requirements: `docs/PULSE_MASTER_PLAN.md` (v2.1).

## P1 — Design freeze (2026-08-06)

### Delivered
- `public/css/tokens.css` — **production** design tokens (navy `#1A3A5F`, orange `#E87722`, RAG `#2E9E8F` / `#F2A900` / `#C8102E`, Calibri font stack). The mock consumes this same file; the app and deck engine will too, so palette can never drift.
- `mockup/` — clickable HTML mock, fake data, no backend:
  - `index.html` **Portfolio Wall**: working filters (division, site, stage, RAG, priority, PM), search, sorts; **KPI banner recomputes from the filtered set**; RAG dots with 4-signal breakdown tooltip; manual-override badge; empty state.
  - `project.html` **Project Room**: header with stage stepper + Contributor-PM surfaced; Timeline (SECURITY_GATE / GO_LIVE distinct, SITE_READINESS checklist inline, Infra↔Ops co-owner pairs); Roadblocks with Escalate; Actions quick-add (Enter to save); Updates & Decisions feed; exec-commentary right rail.
  - `meeting.html` **Meeting Live**: projection layout, dark header, presenter-mode label, item-by-item navigation with agenda reasons, capture bar (+Action/+Decision/+Roadblock/Note, ≤3 fields) appending linked objects, 6 auto-agenda rules displayed.
  - `site.html` **Site Lens**: site picker, scoped project cards, GO_LIVE strip, milestones, readiness checklists, roadblocks, site-staff actions, "Export site deck" entry point.

### Decisions
1. **Mock location** — plan §6 file tree has no mockup dir → mock lives in `/mockup/`, referencing the real `/public/css/tokens.css`. Kept as design reference after P1; not served by the app.
2. **Seed admin credentials (for P2)** — `admin@endeavourmining.com` / `ChangeMe-2026!`, `must_change_password = true`.
3. **Branding** — "Endeavour Mining — Group IT" per plan §5 deck footer (plan wins over prompt's "Endeavour Group").
4. Mock uses a frozen "today" (2026-08-06 GMT) in fake data so RAG/overdue examples are deterministic.
5. Demo dataset deliberately covers RAG edge cases needed by later gates: RED via critical roadblock + slipped milestone (PRJ-2026-001), RED via silence >30d (PRJ-2026-006), ON_HOLD freshness exemption (PRJ-2026-008), manual override with ≥30-char reason (PRJ-2026-009), confidential project (PRJ-2026-010), Contributor site IT leads as PMs (5 of 10 projects).

## P2–P7 — Full build (2026-08-06)

### P2 Foundation ✅
- PostgreSQL 16 schema (`001_init.sql`): 19 tables, identity PKs, CHECK enums, FK
  indexes everywhere, soft deletes, unique lower(email), session table.
- Migration runner (`npm run migrate`, idempotent) + seed with RAG-boundary demo data.
- Auth: bcrypt(12), min length 10, 15-min lockout after 5 failures, forced
  first-login change (blocks all non-auth routes), login limiter 10/min/IP.
- Sessions via connect-pg-simple — proven to survive an app "restart" in tests.
- Double-submit CSRF (`X-CSRF-Token`), helmet CSP (self-only), global API limiter.
- Optimistic locking on projects/milestones/roadblocks/actions → 409 + current
  record; project codes from a `FOR UPDATE` sequence (unique under 20 parallel creates).
- Gate evidence: auth 7/7, permissions 9/9, projects 7/7 test suites.

### P3 Core UI + RAG ✅
- Pure `computeRag` (18 boundary unit tests) + recompute on every project/child write.
- Portfolio Wall with filter-aware KPI banner; Project Room with stage stepper,
  timeline (SECURITY_GATE/GO_LIVE distinct, SITE_READINESS inline checklist),
  RAG breakdown rail, override modal (≥30-char reason server-enforced).

### P4 Meeting Mode ✅
- 6-rule auto-agenda, site-scopable; silent projects keep their specific tag inside
  the RED block. Prepare (reorder/remove/add), Live presenter mode (single-driver),
  capture bar creating real linked objects, close → structured JSON minutes rendered
  fully escaped (XSS test green), print + copy-for-email.
- Notifications: PM_ASSIGNED, ACTION/MILESTONE_ASSIGNED, ROADBLOCK_ESCALATED
  (Admin + engaged leads), PROJECT_RED (PM + lead DL), MEETING_SCHEDULED (agenda PMs).

### P5 Site Lens + My Actions + Reports ✅
- Site Lens: scoped cards, milestones ≤60d, readiness progress, roadblocks,
  site-staff actions, GO_LIVE strip, one-tap site deck.
- My Actions with PM mini-cards (verified for a Contributor-PM).
- Reports: RAG trend from rag_history (snapshot job tested), division workload,
  roadblock aging, action resolution, per-site table; Chart.js on palette tokens;
  XLSX export via SheetJS (file validated).

### P6 Deck engine ✅
- Client-side PptxGenJS; colors read live from css/tokens.css (single source).
- Group deck honoring active filters (site filter ⇒ site deck, title auto-adjusts),
  Project deck (7 slides incl. date-axis timeline), footer/title-band Endeavour style.
- Validated: python-pptx structural check + LibreOffice PDF render; empty sections
  skipped; filenames PULSE_{Scope}_{date}.pptx.

### P7 Hardening ✅
- Rate limits verified by test (login 429 after 10; API limiter engages).
- npm audit: 0 vulnerabilities (express 4.22.2, express-session 1.19.0, node-cron 4).
- Audit trail complete + paginated + secret-free (tested).
- 2 Mbps throttled load: 2.63 s total first-use (<4 s target) after moving vendor
  libs (~1.5 MB) to on-demand loading.
- Backup job run → dump verified → restored into fresh DB → app served logins/data
  from it (drill scripted in scripts/restore.sh).

### Decisions (P2–P7)
6. bcryptjs (pure JS) instead of native bcrypt — same algorithm/cost 12, no
   node-gyp in alpine images.
7. express 4.22.2 / express-session 1.19.0 / node-cron 4.2.1 pinned to clear all
   npm audit findings (plan requires audit-clean at every gate).
8. SheetJS vendored at 0.18.5 from npm (cdn.sheetjs.com blocked by build proxy);
   used for *generating* exports only — the parsing CVEs don't apply. Upgrade path
   documented: drop cdn.sheetjs.com 0.20.x into public/vendor when network allows.
9. int8 columns parsed as JS numbers in pool.js (IDs ≪ 2^53) for coherent
   comparisons between JSON input and DB rows.
10. Optimistic-lock token compared at millisecond precision
    (`date_trunc('milliseconds', …)`) — JSON round-trips milliseconds while
    Postgres stores microseconds.
11. Confidential projects stay visible to their assigned PM even if Contributor
    (a PM must see their own project); hidden from all other Contributors/Viewers.
12. Meetings created by Admin/Division Leads; organizer (or Admin) drives live
    capture; capture inherits the organizer's project permissions.
13. minutes_json column added to meetings (structured snapshot at close) and
    meeting_items.reason records which agenda rule pulled each item in.
14. RAG recompute never bumps updated_at (system write ≠ user edit, keeps the
    optimistic-lock token stable).
15. Freshness for never-updated projects measured from creation date so new
    projects aren't instantly amber.
16. docker compose fully authored + config-validated; image pulls blocked by the
    build sandbox's egress proxy, so `docker compose up` must be smoke-run on a
    networked host (identical boot path verified natively throughout).

## Ecosystem baseline — Pulse-V1 sync · ITPM360 gates · OpsPm360 RACI/War Room (2026-08-07)

Additive layer per the "Baseline Ecosystem" goal — nothing in the delivered
product changed shape; 74 tests green (62 existing + 12 new).

### Pulse-V1 — offline queuing & synchronization
- `public/js/lib/syncQueue.js` (SyncQueueManager): mutating API calls that fail
  on a dead network are stored in IndexedDB as a sequential log and replayed
  strictly FIFO on reconnect. A server error during replay HALTS the queue,
  keeps the op, and alerts every Admin (SYNC_HALTED notification) — no
  automated conflict resolution. Manual RETRY / DISCARD from the topbar chip.
- Server: `X-Client-Op-Id` idempotency middleware + `sync_ops` ledger (a
  replayed op applies exactly once); `POST /api/v1/sync/halt-alert`.
- Validated in-browser: network drop → 2 ops queued → reconnect → FIFO applied
  → server reflects final state (stage BUILD + deliverable), queue empty.

### ITPM360 — stage-gate state machine
- Pure `gates.js`: rigid linear flow over the existing lifecycle with
  governance labels (PROPOSAL≈IDEA, PLANNING≈DESIGN, EXECUTION≈BUILD/DEPLOY/RUN,
  CLOSURE≈CLOSED); ON_HOLD parks/resumes. Gates cannot be skipped.
- Hard-coded prerequisites: IDEA→DESIGN needs description+sponsor+target date;
  DESIGN→BUILD needs ≥1 milestone AND an approver flagged Steering Committee
  (users.is_steering_committee, Admin-managed); DEPLOY→RUN needs a DONE GO_LIVE;
  RUN→CLOSED needs actual_end_date.
- Every transition recorded in the auditable `stage_transitions` ledger
  (who approved, when, optional note) — shown in the War Room.

### OpsPm360 — RACI, site isolation & War Room
- `deliverables` + `raci_assignments` (R/A/C/I per user per deliverable);
  full-access defines the matrix; a tagged R/A can progress the deliverable.
- Site isolation: `users.enterprise_access=false` restricts EVERY read path
  (portfolio, project access→404, search, reports, war room) to projects
  touching the user's own site; existing users default to true (no behavior
  change); PM assignment always wins. Admin-managed checkbox.
- War Room view (`#/warroom`): active portfolio with governance phase, next
  gate + live requirement checklist, deliverables progress, "my RACI duties",
  recent gate approvals.

### Decisions
17. The new /goal conflicts in places with PULSE_MASTER_PLAN v2.1 (site
    isolation vs read-all; new phase names). Resolved additively: master-plan
    behavior is the default; isolation and gates are opt-in per user/flag, and
    governance phases are labels over the existing stage enum.
18. `updated_at` already serves as the directive's `last_modified`; sync state
    lives client-side (IndexedDB) + in the server `sync_ops` ledger instead of
    a `sync_status` column on every table.
19. Seed: admin + bap.lead are Steering Committee;
    `sgo.office@endeavourmining.com` demonstrates site isolation (SGO only).
