-- Migration: 001_initial_rate_limits.sql
-- Description: Create initial endpoint and client IP rate limiting schema

CREATE TABLE IF NOT EXISTS endpoint_rate_limits (
    id SERIAL PRIMARY KEY,
    endpoint VARCHAR(255) NOT NULL UNIQUE,
    requests_per_minute INTEGER NOT NULL DEFAULT 60,
    burst_limit INTEGER NOT NULL DEFAULT 10,
    window_seconds INTEGER NOT NULL DEFAULT 60,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE endpoint_rate_limits 
ADD COLUMN IF NOT EXISTS requests_per_minute INTEGER DEFAULT 60;

CREATE TABLE IF NOT EXISTS client_ip_requests (
    ip_address INET NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_request_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ip_address, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_client_ip_requests_lookup 
ON client_ip_requests (ip_address, endpoint, window_start);

-- Baseline rate limits for endpoints
INSERT INTO endpoint_rate_limits (endpoint, requests_per_minute, burst_limit, window_seconds)
VALUES 
    ('/api/chat', 30, 5, 60),
    ('*', 60, 10, 60)
ON CONFLICT (endpoint) DO NOTHING;
