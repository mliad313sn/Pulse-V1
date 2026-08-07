# External Dependencies (BLOCKED_EXTERNAL register)

Only items whose *code and tests are done locally* but which need a real external
credential/resource may sit here (SKILL.md §24).

## 1. Microsoft Teams notifications — READY, needs webhook URL
- Code: `src/modules/notifications/channels.js` (`teamsAdapter`) — real transport (fetch POST, MessageCard text).
- Tests: `tests/api/risk-capa.test.js` §5 (payload shape + failure path, injected fetch).
- Production config: `NOTIFY_CHANNEL_MODE=live`, `TEAMS_WEBHOOK_URL=<incoming webhook of the target channel>`.
- Validation after credential: trigger any notification (e.g. escalate a roadblock) and check the channel + `notification_deliveries` row status SENT.

## 2. SMTP email notifications — CONTRACT ONLY
- Code: adapter slot + config contract in `channels.js`; delivery ledger ready. No SMTP client library bundled yet (decision D-22: add `nodemailer` when a relay exists to test against).
- Production config: `NOTIFY_CHANNEL_MODE=live`, `SMTP_URL=smtp://user:pass@relay:587`, sender identity policy.
- Remaining local work when picked up: install nodemailer, implement send, add sink-relay test.

## 3. Microsoft Entra ID SSO — NOT YET WRITTEN
- Auth is an isolated module (`src/modules/auth/`) with session-based interface, designed for OIDC swap-in. The Entra adapter itself is future work (E02), so this is NOT claimable as BLOCKED_EXTERNAL yet.
- Will need: tenant ID, client ID/secret, redirect URI registration.

## 4. Production container registry / cloud runtime
- docker-compose + Dockerfile are authored and config-validated; image pulls are blocked inside the build sandbox (proxy 403). First `docker compose up` on a networked host is the outstanding validation step.
