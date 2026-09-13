-- Migration: 004_drop_redundant_rpm_column.sql
-- Description: Drop redundant requests_per_minute column in favor of explicit rate_limit_per_ip

-- 1. Drop check constraint associated with requests_per_minute
ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_requests_per_minute_positive;

-- 2. Drop the redundant requests_per_minute column
ALTER TABLE endpoint_rate_limits
    DROP COLUMN IF EXISTS requests_per_minute;
