-- Migration: 002_update_rate_limit_per_ip_all_endpoints.sql
-- Description: Change rate limit per IP for all endpoints

-- Add explicit per-IP rate limit column if not present
ALTER TABLE endpoint_rate_limits 
ADD COLUMN IF NOT EXISTS rate_limit_per_ip INTEGER NOT NULL DEFAULT 120;

-- Update all existing endpoints to new rate limit per IP
UPDATE endpoint_rate_limits
SET 
    rate_limit_per_ip = 120,
    requests_per_minute = 120,
    burst_limit = 25,
    window_seconds = 60,
    updated_at = CURRENT_TIMESTAMP;

-- Upsert global wildcard entry ensuring all unlisted/future endpoints use new per-IP rate limit
INSERT INTO endpoint_rate_limits (endpoint, requests_per_minute, rate_limit_per_ip, burst_limit, window_seconds, updated_at)
VALUES ('*', 120, 120, 25, 60, CURRENT_TIMESTAMP)
ON CONFLICT (endpoint) 
DO UPDATE SET 
    rate_limit_per_ip = 120,
    requests_per_minute = 120,
    burst_limit = 25,
    window_seconds = 60,
    updated_at = CURRENT_TIMESTAMP;
