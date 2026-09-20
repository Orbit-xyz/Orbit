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

    -- HUMAN-READABLE decimal amount, e.g. 29.50 — NOT chain base units.
    --
    -- Orbit settles the same asset on rails with different precision (Stellar
    -- SAC USDC is 7 decimals, Arc ERC-20 USDC is 6). Storing base units would
    -- make a row meaningless without knowing its chain, and would silently
    -- misprice any plan migrated between rails. Convert to base units only at
    -- the chain boundary, using that network's decimals.
    usdc_amount NUMERIC(20, 8) NOT NULL CHECK (usdc_amount > 0),

    interval_seconds BIGINT NOT NULL CHECK (interval_seconds > 0), -- e.g., 2592000 for 30 days

    -- Which rail this plan settles on. Determines the contract, the wallet
    -- family, and the decimal precision used when building a transaction.
    network VARCHAR(32) NOT NULL DEFAULT 'stellar-testnet'
        CHECK (network IN ('stellar-testnet', 'arc-testnet')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Subscriptions Table
-- Stores the customers who have subscribed to a specific plan
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,

    -- Address format differs per rail: Stellar is 56-char base32 starting 'G',
    -- Arc/EVM is 42-char hex starting '0x'. The network column below is what
    -- makes this column interpretable.
    customer_wallet_address VARCHAR(255) NOT NULL,

    -- Which rail this subscriber authorized their vault on. A merchant may
    -- serve both rails at once, so this is NOT redundant with plans.network.
    network VARCHAR(32) NOT NULL DEFAULT 'stellar-testnet'
        CHECK (network IN ('stellar-testnet', 'arc-testnet')),

    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'past_due'
    next_billing_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure a customer can't accidentally subscribe to the exact same plan twice concurrently
    UNIQUE(plan_id, customer_wallet_address)
);

-- Billing cron / keeper queries subscriptions that are due, per rail.
CREATE INDEX idx_subscriptions_due ON subscriptions (network, next_billing_date)
    WHERE status = 'active';

-- Enable Row Level Security (RLS) for good practice
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create basic open policies so our Express API can easily read/write during development
CREATE POLICY "Enable read access for all users" ON merchants FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON merchants FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON plans FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON plans FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON subscriptions FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON subscriptions FOR UPDATE USING (true);
