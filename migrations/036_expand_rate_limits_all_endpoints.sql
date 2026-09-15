-- Migration: 036_expand_rate_limits_all_endpoints.sql
-- Description: Seed per-IP and per-user rate limits for all remaining endpoints:
-- chat status, chat stream, auth config, auth signup, auth sync, and metrics.

INSERT INTO endpoint_rate_limits (endpoint, rate_limit_per_ip, rate_limit_per_user, burst_limit, window_seconds, updated_at)
VALUES
    ('/api/chat/status', 120, 60, 20, 60, CURRENT_TIMESTAMP),
    ('/api/chat/stream', 60, 30, 10, 60, CURRENT_TIMESTAMP),
    ('/api/auth/config', 120, 60, 30, 60, CURRENT_TIMESTAMP),
    ('/api/auth/signup', 30, 15, 5, 60, CURRENT_TIMESTAMP),
    ('/api/auth/sync', 60, 30, 10, 60, CURRENT_TIMESTAMP),
    ('/metrics', 120, 60, 30, 60, CURRENT_TIMESTAMP)
ON CONFLICT (endpoint)
DO UPDATE SET
    rate_limit_per_ip = EXCLUDED.rate_limit_per_ip,
    rate_limit_per_user = EXCLUDED.rate_limit_per_user,
    burst_limit = EXCLUDED.burst_limit,
    window_seconds = EXCLUDED.window_seconds,
    updated_at = CURRENT_TIMESTAMP;
