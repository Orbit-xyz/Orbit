-- ===========================================================================
-- Migration 001 — Arc rail support
-- ===========================================================================
-- Brings an EXISTING Orbit database up to the shape in schema.sql.
-- Run once against Supabase (SQL Editor, or psql). schema.sql is the
-- create-from-scratch definition; this is the upgrade path for live data.
--
-- What it does:
--   1. Adds a `network` column to plans and subscriptions.
--   2. Converts plans.usdc_amount from Stellar base units (7 decimals) to
--      human-readable decimals.
--   3. Adds constraints and the billing-due index.
--
-- ⚠ STEP 2 REWRITES MONEY VALUES. Back up first:
--      CREATE TABLE plans_backup_001 AS SELECT * FROM plans;
--   and run the verification block at the bottom before committing.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. network column
-- ---------------------------------------------------------------------------
-- Every existing row predates Arc, so it is by definition a Stellar plan.
ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS network VARCHAR(32) NOT NULL DEFAULT 'stellar-testnet';

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS network VARCHAR(32) NOT NULL DEFAULT 'stellar-testnet';

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_network_check;
ALTER TABLE plans ADD CONSTRAINT plans_network_check
    CHECK (network IN ('stellar-testnet', 'arc-testnet'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_network_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_network_check
    CHECK (network IN ('stellar-testnet', 'arc-testnet'));

-- ---------------------------------------------------------------------------
-- 2. usdc_amount: Stellar base units -> human-readable decimals
-- ---------------------------------------------------------------------------
-- Old rows stored 7-decimal base units (29 USDC was 290000000). Arc uses 6
-- decimals for the same asset, so base units are ambiguous across rails.
-- Going forward the column holds 29.50, and each rail scales at its boundary.
--
-- Guard: only convert values that are clearly base units. A row already
-- holding a small decimal has been migrated (or was written by new code) and
-- must not be divided again. 1000 USDC = 10^10 in base units, so any value
-- at or above 10^6 is base units and anything below is already converted.
UPDATE plans
SET usdc_amount = usdc_amount / 10000000.0
WHERE usdc_amount >= 1000000;

ALTER TABLE plans ALTER COLUMN usdc_amount TYPE NUMERIC(20, 8);

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_usdc_amount_check;
ALTER TABLE plans ADD CONSTRAINT plans_usdc_amount_check
    CHECK (usdc_amount > 0);

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_interval_seconds_check;
ALTER TABLE plans ADD CONSTRAINT plans_interval_seconds_check
    CHECK (interval_seconds > 0);

-- ---------------------------------------------------------------------------
-- 3. billing-due index
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subscriptions_due
    ON subscriptions (network, next_billing_date)
    WHERE status = 'active';

COMMIT;

-- ===========================================================================
-- VERIFY before trusting this — amounts should read like prices, not integers
-- ===========================================================================
--   SELECT id, name, usdc_amount, network FROM plans ORDER BY created_at;
--
-- Expect 29.50, 100.00 — NOT 295000000. If anything still looks like base
-- units, STOP and restore from plans_backup_001.
--
-- Sanity check for values that survived the guard incorrectly:
--   SELECT count(*) AS suspicious FROM plans WHERE usdc_amount >= 1000000;
--   -- should be 0 unless you genuinely sell a million-dollar plan
-- ===========================================================================
