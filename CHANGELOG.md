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
