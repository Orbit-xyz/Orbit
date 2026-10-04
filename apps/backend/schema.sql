-- Orbit MVP Database Schema

-- 1. Merchants Table
-- Stores the SaaS founders/businesses using Orbit
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Plans Table
-- Stores the pricing tiers created by the merchant (e.g., "Pro Plan - 29 USDC/month")
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    usdc_amount NUMERIC NOT NULL, -- Storing as numeric to handle large Stellar numbers without precision loss
    interval_seconds BIGINT NOT NULL, -- e.g., 2592000 for 30 days
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Subscriptions Table
-- Stores the customers who have subscribed to a specific plan
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    customer_wallet_address VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'past_due'
    next_billing_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure a customer can't accidentally subscribe to the exact same plan twice concurrently
    UNIQUE(plan_id, customer_wallet_address)
);

-- ==============================================================================
-- Row Level Security (RLS) Configuration
-- ==============================================================================
--
-- Security Model:
-- 1. The backend Express API connects using SUPABASE_SERVICE_ROLE_KEY, which
--    inherently bypasses RLS in PostgreSQL / Supabase.
-- 2. Direct client access using the public anon key is strictly read-only and
--    limited to what the public checkout flow requires (reading plans and
--    associated merchant names and wallet addresses).
-- 3. All table mutations (INSERT, UPDATE, DELETE) across all tables are forbidden
--    to anon/public clients and must be executed through the backend.
-- 4. The subscriptions table has NO public policies defined, enforcing default-deny
--    for the anon key (preventing any direct listing or modification of subscriber data).

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Public checkout read access for plans and merchant public identifiers
CREATE POLICY "Allow public read access to merchants for checkout"
    ON merchants FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access to plans for checkout"
    ON plans FOR SELECT
    USING (true);

-- No public policies for subscriptions: default-deny prevents anon key access.
-- No open INSERT or UPDATE policies: all mutations require backend service role.
