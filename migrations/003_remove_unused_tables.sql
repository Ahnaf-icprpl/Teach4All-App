-- Migration: 003_remove_unused_tables.sql
-- Description: Drop unused client_ip_requests table and ensure proper constraints, indexes, and triggers

-- 1. Drop unused client_ip_requests table and associated indexes
-- High-volume requests and rate limits are handled in-memory (zero DB writes on request path)
DROP TABLE IF EXISTS client_ip_requests CASCADE;

-- 2. Add validation check constraints to endpoint_rate_limits
ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_requests_per_minute_positive,
    ADD CONSTRAINT chk_requests_per_minute_positive CHECK (requests_per_minute > 0);

ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_rate_limit_per_ip_positive,
    ADD CONSTRAINT chk_rate_limit_per_ip_positive CHECK (rate_limit_per_ip > 0);

ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_burst_limit_positive,
    ADD CONSTRAINT chk_burst_limit_positive CHECK (burst_limit > 0);

ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_window_seconds_positive,
    ADD CONSTRAINT chk_window_seconds_positive CHECK (window_seconds > 0);

-- 3. Enforce proper column defaults and non-null constraints
ALTER TABLE endpoint_rate_limits
    ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN updated_at SET NOT NULL;

-- 4. Create automatic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_endpoint_rate_limits_updated_at ON endpoint_rate_limits;
CREATE TRIGGER trg_endpoint_rate_limits_updated_at
    BEFORE UPDATE ON endpoint_rate_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- 5. Create index on endpoint for fast configuration lookups
CREATE INDEX IF NOT EXISTS idx_endpoint_rate_limits_endpoint
ON endpoint_rate_limits (endpoint);
