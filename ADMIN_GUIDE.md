# PULSE — Admin Guide

For the Group IT Manager (platform owner). Everything here is Admin-only unless noted.

## 1. Users & roles

**Admin → Users.** Create users with name, email, role, division, site. Every new user gets a temporary password (min 10 chars) and **must change it at first login** — PULSE blocks all other actions until they do.

Base roles:

| Role | Grants |
|---|---|
| **Admin** | Everything: user management, confidential projects, soft-deletes, audit trail |
| **Division Lead** | Create projects; full edit where own division leads; scoped writes where engaged |
| **Contributor** | Edit own items; create actions/roadblocks + post updates on projects touching own division or site |
| **Viewer** | Read-only + deck/XLSX export. Can never write, can never be PM |

**Project Manager is not a role — it's an assignment.** Set `Project → Edit → Project manager` to any non-Viewer, including a Contributor site IT lead. That person gains **full edit on that project only** (fields, milestones, roadblocks, actions, updates, decisions, commentary) and is notified (PM_ASSIGNED). Their rights everywhere else are unchanged.

**Lockouts.** 5 wrong passwords → 15-minute lockout (shown as LOCKED in the user list). *Reset pwd* clears the lockout and forces a change at next login.

**Deleting** users/projects is always a **soft delete** — the record is hidden and deactivated but history and audit entries remain. There is no hard delete anywhere.

## 2. Confidential projects

Tick *Confidential* on a project (Admin-only field). The project disappears for Contributors and Viewers everywhere — portfolio, search, reports, decks, meeting agendas. Admins and Division Leads still see it. Exception: an assigned PM keeps access to their own project. Decks exported by non-admins never contain confidential projects.

## 3. RAG discipline

RAG is computed server-side as the worst of 4 signals (schedule, roadblocks, overdue actions, freshness) and cannot be edited directly. A **manual override** requires a reason of at least 30 characters and shows a permanent "MANUAL" badge with the computed value still visible on hover — there is no silent green-washing. RUN / CLOSED / ON_HOLD projects are exempt from the freshness signal.

If a project turns RED, its PM and the lead Division Lead are notified automatically.

## 4. Meetings

Admins and Division Leads create meetings. The agenda auto-builds from 6 rules (RED, AMBER, new roadblocks since the last closed meeting of the same type, overdue actions by owner, GO_LIVE ≤ 30 days, silent projects). Setting a **site scope** on the meeting applies all rules to that site only — this is how site-level reviews run.

Live mode is **single-driver**: the organizer captures on the projected screen; everyone else views read-only and refreshes manually. Everything captured (+Action / +Decision / +Roadblock / Note) creates a **real object** linked to both project and meeting.

Closing generates structured minutes (JSON snapshot, rendered as printable HTML with all user text escaped). To "edit minutes", edit the underlying objects and re-close — minutes are a projection, not a document.

## 5. Audit trail

**Admin → Audit** (bottom of the page): every write, field-by-field (old → new), with author and GMT timestamp, paginated. Passwords and session data are never logged. The API endpoint (`GET /api/v1/audit`) is Admin-only.

## 6. Jobs, backups & restore

Both jobs run inside the app process (GMT):

- **Mondays 06:00** — RAG snapshot of every non-CLOSED project into `rag_history` (feeds the Reports trend).
- **Daily 02:00** — `pg_dump -Fc` to the backups volume, then a `pg_restore --list` verification pass. A dump that fails verification is deleted and the failure logged. Retention: 14 days.

Manual backup any time: `docker compose exec app npm run backup`.

**Restore drill** (do this quarterly — it is rehearsed and takes ~3 minutes):

```bash
docker compose exec db createdb -U pulse pulse_restore
docker compose exec app bash -c \
  'DATABASE_URL=postgres://pulse:$POSTGRES_PASSWORD@db:5432/pulse_restore npm run restore -- /backups/<dump>'
# then point DATABASE_URL at pulse_restore (compose env) and restart the app service
```

## 7. Security posture

- Sessions live in PostgreSQL — app restarts/redeploys never log users out.
- CSRF: every mutating request must carry `X-CSRF-Token` (the SPA does this automatically).
- Rate limits: 10 login attempts/min/IP; 600 API requests/min/IP (configurable via `API_RATE_LIMIT`).
- All SQL is parameterized; all input zod-validated; helmet CSP allows same-origin assets only (no CDN).
- `npm audit` is clean at every gate; dependencies are pinned exact.

## 8. Entra ID readiness (V2)

Local auth is isolated in `src/modules/auth/` behind a single session-based interface. Swapping in Entra ID OIDC replaces that module only — business code never touches credentials.
