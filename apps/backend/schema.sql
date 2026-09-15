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
