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

## 3. Microsoft Entra ID SSO — READY, needs tenant + app registration
- Code: `src/modules/auth/oidc.js` + `/api/v1/auth/oidc/{login,callback}` — discovery,
  state-checked authorization-code flow, userinfo claims, mapping to LOCAL users
  (local deactivation always wins), refuse-unknown by default, `OIDC_AUTO_PROVISION=true`
  for JIT VIEWER creation. Routes are dormant (404) until configured.
- Tests: `tests/api/oidc.test.js` — full mocked flow against an injected fake issuer.
- Production config: `OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0`,
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` (registered in the app).
- Validation after credential: /api/v1/auth/oidc/login round-trip with a tenant user
  mapped to an existing PULSE account; then deactivate that account and confirm 403.

## 3b. S3-compatible attachment storage — CONTRACT READY, local disk in use
- Code: `src/modules/attachments/storage.js` — adapter contract (put/get/remove);
  local-disk adapter is the running implementation (`ATTACHMENTS_DIR`).
- Remaining when object storage exists: implement the S3 adapter against the same
  contract (endpoint/bucket/creds via env); no caller changes.

## 4. Production container registry / cloud runtime
- docker-compose + Dockerfile are authored and config-validated; image pulls are blocked inside the build sandbox (proxy 403). First `docker compose up` on a networked host is the outstanding validation step.
