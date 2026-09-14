-- Migration: 024_add_endpoint_rate_limits_and_per_user.sql
-- Description: Add rate_limit_per_user column, check constraints, and seed per-IP & per-user limits for all endpoints

-- 1. Add rate_limit_per_user column if not exists
ALTER TABLE endpoint_rate_limits
ADD COLUMN IF NOT EXISTS rate_limit_per_user INTEGER NOT NULL DEFAULT 60;

-- 2. Add validation check constraint
ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_rate_limit_per_user_positive,
    ADD CONSTRAINT chk_rate_limit_per_user_positive CHECK (rate_limit_per_user > 0);

-- 3. Upsert rate limits for all API endpoints in the system
INSERT INTO endpoint_rate_limits (endpoint, rate_limit_per_ip, rate_limit_per_user, burst_limit, window_seconds, updated_at)
VALUES
    ('/api/chat', 60, 30, 10, 60, CURRENT_TIMESTAMP),
    ('/api/title', 60, 30, 10, 60, CURRENT_TIMESTAMP),
    ('/api/conversations', 120, 60, 25, 60, CURRENT_TIMESTAMP),
    ('/api/messages', 120, 60, 25, 60, CURRENT_TIMESTAMP),
    ('/api/quizzes', 120, 60, 25, 60, CURRENT_TIMESTAMP),
    ('/api/materials', 120, 60, 25, 60, CURRENT_TIMESTAMP),
    ('/api/ui-texts', 120, 60, 30, 60, CURRENT_TIMESTAMP),
    ('/api/chat-prompts', 120, 60, 30, 60, CURRENT_TIMESTAMP),
    ('*', 120, 60, 25, 60, CURRENT_TIMESTAMP)
ON CONFLICT (endpoint)
DO UPDATE SET
    rate_limit_per_ip = EXCLUDED.rate_limit_per_ip,
    rate_limit_per_user = EXCLUDED.rate_limit_per_user,
    burst_limit = EXCLUDED.burst_limit,
    window_seconds = EXCLUDED.window_seconds,
    updated_at = CURRENT_TIMESTAMP;
