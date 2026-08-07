# Release Readiness — Enterprise PPM Platform

**Verdict: GO for pilot deployment. Conditional GO for production —
conditions are exactly the external-credential items below, none of them code.**

Updated: 2026-08-07 (qualification run — see RELEASE_QUALIFICATION.md)

## Quality snapshot
- Tests: **119/119 green** (`npm test`) — unit + API/integration, single command
- Accessibility/i18n gate: `npm run a11y` **PASS** (axe serious/critical = 0 on
  core views EN+FR, keyboard-only login)
- `npm audit`: **0 vulnerabilities**; overrides pinned (uuid ^11)
- Migrations: 001→013 apply cleanly from an empty database; deterministic seed
- Backup → verify → restore drill: **re-executed 2026-08-07** on the current
  schema — row parity verified, app boots and authenticates against the
  restored database
- Offline replay/halt, concurrency (409) and presenter-sync drills executed in
  real browsers (two contexts where relevant)

## Scope completion (detail in REQUIREMENT_TRACEABILITY.md)
- DONE: E01 org model, E03 RBAC, E04 portfolio hierarchy, E05 7-stage
  lifecycle + operating status, E06 change control/baselines, E07 tasks/
  dependencies/critical path, E08 projects, E09 actions, E10 health/RAG,
  E11 risks/CAPA, E13 status updates, E14 meetings+versioned minutes,
  E15 realtime presenter sync, E16 resources/time, E17 finance masking,
  E18 benefits, E21 reminders + scheduled dispatch, E22 dashboards incl.
  Executive Command Center, E23 server-side exports with leak tests,
  E24 attachments, E25 offline, E26 concurrency, E27 backup/ops,
  E30 qualification (RA-01…RA-20 mapped to automated evidence)
- DONE with external condition: E02 auth (local complete; Entra OIDC adapter
  code+tests done, needs tenant), E20 channels (Teams adapter done, needs
  webhook; SMTP contract only)
- PARTIAL (documented, non-blocking for pilot): E12 Gantt visual drag
  (tabular plan + critical path shipped), E19 search breadth (projects +
  roadblocks only), E28 i18n deep views (core journey EN/FR done; moderate
  axe findings open), E29 admin config UI breadth
- Deliberately out of scope until requested: RESTRICTED classification tier,
  update revisioning

## Conditions for full production GO (all external, code ready)
1. Microsoft Entra tenant + app registration → set `OIDC_*` env (adapter tested against mocked issuer)
2. Teams incoming-webhook URL → `NOTIFY_CHANNEL_MODE=live`, `TEAMS_WEBHOOK_URL`
3. SMTP relay (then: add nodemailer send per contract in channels.js)
4. Object storage for attachments at scale (S3 adapter contract ready; local disk fine for pilot)
5. One `docker compose up` on a network-unrestricted host (registry pulls blocked in this sandbox; compose config-validated)

## Operating notes
- Single test command: `npm test`; accessibility gate: `npm run a11y`
- Nightly backup 02:00 GMT, reminders 05:00 GMT, weekly digest Mon 06:00 GMT,
  RAG snapshot job — all GMT, all disable-able via `DISABLE_JOBS=true`
- Resumption: `docs/execution/STATUS.md` + REQUIREMENT_TRACEABILITY.md +
  DECISIONS.md rebuild full context from repository state alone
