# Architecture & Interpretation Decisions (goal-skill ledger)

Continues the numbered decision log in CHANGELOG.md (D-1…D-19 recorded there).

- **D-20 — Keep the existing architecture.** PROJECT_MASTER_PLAN §70 recommends a
  TypeScript monorepo (Next.js/NestJS/worker). SKILL.md §5 says do not rewrite a
  coherent existing implementation. The repository holds a tested Node/Express/PG16
  modular monolith with 79 green tests covering the security-critical core. Rewriting
  would destroy verified authorization/gate/audit behavior for structural preference.
  Decision: extend the current architecture; preserve module boundaries so extraction
  to the recommended shape stays possible. Revisit only if a requirement (e.g. worker
  scale-out) cannot be met in-process.
- **D-21 — Governance naming.** Master-plan lifecycle (7 stages, separate operating
  status) is a scheduled atomic slice (STATUS.md item 1), not a partial hack: renaming
  the enum touches gates, seed, agenda and many tests, so it must ship in one slice
  with a data migration. Until then the 6-stage machine with governance labels stands.
- **D-22 — SMTP client deferred.** No mail relay is reachable from this environment;
  bundling nodemailer untested would be a fake production path (forbidden by SKILL §7D).
  The adapter contract + delivery ledger + sink are in place; the send implementation
  lands together with a testable relay.
- **D-23 — CAPA lifecycle enforcement.** Plan §29 gives a linear lifecycle without
  explicit skip rules. Chosen: max one step forward, free steps back (rework),
  CLOSED requires verifier + effectiveness + verification date. Safest reading of
  "verification of effectiveness" as a hard gate.
- **D-24 — Agenda enrichment over dedupe.** A project already on the agenda gets
  additional signals appended to its item notes ("Overdue CAPA: …") instead of the
  signal being silently dropped (plan §3.8 no-silent-loss).
- **D-25 — Risk/CAPA activity counts as freshness.** Plan §26 defines "meaningful
  project activity"; risk and CAPA writes now feed last_activity_at.
