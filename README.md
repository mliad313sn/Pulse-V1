# PULSE — IT Project Tracking & Alignment Platform

**Endeavour Mining — Group IT.** One shared platform for project status, roadblocks and next actions across 7 IT divisions and all sites, built around a live Meeting Mode, with one-click Endeavour-styled PPTX decks.

Source of truth for all requirements: [`docs/PULSE_MASTER_PLAN.md`](docs/PULSE_MASTER_PLAN.md) (v2.1). Decision log: [`CHANGELOG.md`](CHANGELOG.md).

## Build status

| Phase | Scope | Status |
|---|---|---|
| **P1** | Design freeze — clickable HTML mock (Portfolio, Project Room, Meeting Live, Site Lens) | ✅ delivered, awaiting gate approval |
| P2 | Foundation — docker, Postgres, migrations, auth, sessions, CSRF, CRUD + permissions | ⏳ |
| P3 | Core UI + RAG engine | ⏳ |
| P4 | Meeting Mode | ⏳ |
| P5 | Site Lens, My Actions, Reports | ⏳ |
| P6 | Deck engine (PptxGenJS) | ⏳ |
| P7 | Hardening, UAT, restore drill | ⏳ |

## Viewing the P1 mock

No build, no server needed — static files:

```bash
# from the repo root, any static server works, e.g.:
npx serve .
# then open http://localhost:3000/mockup/
```

Or open `mockup/index.html` directly in Chrome/Edge. The mock consumes the **real** production palette tokens from `public/css/tokens.css`. Fake data only; "today" is frozen at 2026-08-06 GMT for deterministic RAG examples.

Pages: `index.html` (Portfolio Wall) · `project.html` (Project Room) · `meeting.html` (Meeting Live) · `site.html` (Site Lens).

Full deployment instructions (docker-compose, migrations, seed, backups) arrive with P2.
