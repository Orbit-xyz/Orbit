-- Brand profile fields for hosted checkout, /pay/:id and the checkout widget (#350).
-- migrate:up
ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS tagline VARCHAR(160),
    ADD COLUMN IF NOT EXISTS support_email VARCHAR(254),
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS banner_url TEXT,
    ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7)
        CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$');
