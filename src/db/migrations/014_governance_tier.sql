-- Governance tiers: calibrate gate EVIDENCE to project nature, never the
-- guardrails themselves. LITE keeps the same 7 stages, no skipping, the same
-- Steering-only approvals, confidentiality/site/finance masking, optimistic
-- locking and audit — it only trims the paperwork demanded at each gate.
ALTER TABLE projects ADD COLUMN governance text NOT NULL DEFAULT 'STANDARD'
  CHECK (governance IN ('LITE','STANDARD'));
