-- Phase 0 (Trust & Correctness) — two foundations:
--
-- 1. Offline idempotency scoping: an op_id is only "the same operation" when
--    it comes from the SAME user with the SAME method/path/body. Previously
--    op_id was globally unique, so a colliding id from another user would be
--    swallowed as a duplicate. Old rows keep working (body_hash nullable).
ALTER TABLE sync_ops DROP CONSTRAINT sync_ops_op_id_key;
ALTER TABLE sync_ops ADD COLUMN body_hash char(64);
CREATE UNIQUE INDEX sync_ops_scope_ux ON sync_ops (op_id, user_id);

-- 2. Multicurrency-safe finance: budget lines already carry a currency, but
--    every aggregation summed raw numbers across currencies. fx_rates holds
--    admin-managed conversion rates to the base currency (USD); aggregations
--    now convert per line and refuse silently-unconvertible currencies.
CREATE TABLE fx_rates (
  currency char(3) PRIMARY KEY,
  rate_to_base numeric(18,8) NOT NULL CHECK (rate_to_base > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users(id)
);
INSERT INTO fx_rates (currency, rate_to_base) VALUES
  ('USD', 1),
  ('EUR', 1.08),
  ('GBP', 1.27),
  ('XOF', 0.00165),
  ('GHS', 0.064),
  ('CAD', 0.73),
  ('AUD', 0.65);

-- every budget line's currency MUST have a rate — no silently unconvertible
-- money anywhere in the system (all existing lines default to USD)
ALTER TABLE budget_lines
  ADD CONSTRAINT budget_lines_currency_fk FOREIGN KEY (currency) REFERENCES fx_rates(currency);
