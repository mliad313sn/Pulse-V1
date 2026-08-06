# PULSE — IT Project Tracking & Alignment Platform

**Endeavour Mining — Group IT.** One shared platform where all 7 IT divisions see the same project truth — status, roadblocks, next actions — built around a live Meeting Mode, filterable by site everywhere, with one-click Endeavour-styled PPTX decks that need zero rework.

- Source of truth for requirements: [`docs/PULSE_MASTER_PLAN.md`](docs/PULSE_MASTER_PLAN.md) (v2.1)
- Decision log & phase history: [`CHANGELOG.md`](CHANGELOG.md)
- Admin manual: [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) · Site-manager quickstart: [`USER_QUICKSTART.md`](USER_QUICKSTART.md)

## Stack

Node 20 + Express + **PostgreSQL 16** (`pg` pool, parameterized queries only) · plain-SQL migrations + runner · REST `/api/v1` · zod validation on every input · helmet · rate limits (global + strict login) · double-submit CSRF · sessions in Postgres (survive restarts) · bcrypt(12) + lockout + forced first-login change · optimistic locking (409 on stale edits) · audit trail on all writes · in-app notifications · node-cron jobs (weekly RAG snapshot, daily **verified** `pg_dump`, 14-day retention) · no-build vanilla-JS frontend with Chart.js / PptxGenJS / SheetJS vendored locally.

## Deploy in 10 minutes (docker-compose)

```bash
git clone <this repo> && cd Pulse-V1

# 1. configure (≈1 min)
cp .env.example .env
#   edit .env → set SESSION_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD

# 2. start (≈3 min: builds the app image, starts postgres:16-alpine, runs migrations)
docker compose up -d --build

# 3. seed demo data + accounts (≈1 min)
docker compose exec app npm run seed

# 4. open http://localhost:3000 and sign in
#      admin@endeavourmining.com / ChangeMe-2026!   (password change is forced)
```

The app container waits for the db healthcheck, runs `npm run migrate` on boot (idempotent), and schedules the two cron jobs automatically. Backups land on the `backups` volume.

> Behind TLS? Set `SECURE_COOKIES=true` in `.env` so the session cookie is marked `Secure`.

### Seeded demo accounts

| Account | Email | Password |
|---|---|---|
| Admin (Group IT Manager) | `admin@endeavourmining.com` | `ChangeMe-2026!` → forced change |
| Division leads | `inf.lead@` `ops.lead@` `bap.lead@` `dat.lead@` `sec.lead@` `ear.lead@endeavourmining.com` | `Endeavour-2026!` |
| Site IT leads (Contributors — several are PMs) | `awa.diallo@` `ibrahim.traore@` `sekou.camara@` `aminata.sow@` `moussa.ouedraogo@` `leila.toure@endeavourmining.com` | `Endeavour-2026!` |
| Viewer (CIO office) | `cio@endeavourmining.com` | `Endeavour-2026!` |

The demo data deliberately covers every RAG boundary: a RED project (slipped milestone + critical roadblock), a RED-by-silence project (>30 days quiet), an ON_HOLD project (freshness-exempt), a manual override with reason, and a confidential project.

## Running without Docker

```bash
createdb pulse
cp .env.example .env            # set DATABASE_URL + SESSION_SECRET
npm ci
npm run migrate && npm run seed
npm start                       # http://localhost:3000
```

## Tests

```bash
createdb pulse_test             # dedicated test DB (DATABASE_URL_TEST)
npm test                        # 62 tests: computeRag boundaries, permission matrix,
                                # lockout/CSRF/session-survival, 409 locking, 20-parallel
                                # code uniqueness, 6-rule agendas, XSS-inert minutes,
                                # site lens, snapshots, rate limits
```

## Backups & restore

- **Automatic:** daily 02:00 GMT — `pg_dump -Fc` to `$BACKUP_DIR`, then a `pg_restore --list` verification (bad dumps deleted + error logged), 14-day retention. Weekly RAG snapshot Mondays 06:00 GMT feeds the Reports trend.
- **Manual:** `npm run backup`
- **Restore drill** (into a fresh database — practiced, not theoretical):

```bash
createdb pulse_restore
DATABASE_URL=postgres://user:pass@host:5432/pulse_restore npm run restore -- /backups/pulse_<stamp>.dump
# point the app at pulse_restore and start — sessions, logins and data work immediately
```

## Repository layout

```
src/server.js                app factory + boot (migrate → listen → cron)
src/db/                      pool, migration runner, seed, migrations/*.sql
src/modules/<m>/             routes.js + service.js per module (auth, projects,
                             milestones, roadblocks, actions, meetings,
                             notifications, rag, reports, search, audit)
src/middleware/              authz (permission matrix), csrf, audit, errors
src/jobs/                    snapshot.js (weekly), backup.js (daily, verified)
public/                      no-build frontend; css/tokens.css = single palette
                             source shared by app AND deck engine; vendor/ libs
tests/                       unit/ + api/ suites, e2e-checklist.md
scripts/                     backup.sh, restore.sh
mockup/                      P1 design-freeze mock (kept as design reference)
```
