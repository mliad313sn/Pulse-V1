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
- **D-26 — Two-tier governance (user directive 2026-08-07).** "Keep the guardrails
  but allow flexibility by project nature/complexity; avoid bureaucracy." Chosen:
  projects.governance = STANDARD | LITE (migration 014). LITE trims gate EVIDENCE
  only — G0 needs description alone; G1 needs PM alone; G2 needs one milestone
  (no deliverable/risk-register demand); G4 requires a done GO_LIVE only if one
  is planned. NEVER relaxed, either tier: no stage skipping, Steering-only Gate 2
  and change-request decisions, critical-roadblock deployment block, close
  discipline (end date + all actions dispositioned), confidentiality/site/finance
  masking, optimistic locking, immutable baselines/minutes, audit, RAG-override
  justification. Tier set by Admin/Division Lead only — a PM cannot lighten their
  own project. Adoption aid: the Project Room now shows the NEXT-GATE CHECKLIST
  (met/unmet) up front, so gates read as a to-do list instead of a rejection.
- **D-27 — SPM transformation Phase 0 (2026-08-07).** New /goal (compete with
  Planview/Planisware/ServiceNow SPM) executed as staged slices on top of the
  completed master plan. Phase 0 choices: base currency = USD with admin-managed
  fx_rates and an FK guaranteeing convertibility (no silent cross-currency sums);
  idempotency key = (op_id, user) + body hash (reuse with different body = 409);
  presenter chair = organizer/Admin/Steering (same rule as meeting drive);
  attachment content verified by magic bytes with a SCAN_MODE adapter
  (real scanner BLOCKED_EXTERNAL); CPM kernel upgraded in place keeping the
  existing API surface (earlyFinish/lateFinish/slack/critical preserved).
