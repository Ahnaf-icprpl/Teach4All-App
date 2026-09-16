-- ============================================================
-- Migration 039: Add rate_limit_per_guest column to endpoint_rate_limits
-- ============================================================

-- 1. Add rate_limit_per_guest column if not exists
ALTER TABLE endpoint_rate_limits
ADD COLUMN IF NOT EXISTS rate_limit_per_guest INTEGER NOT NULL DEFAULT 2;

-- 2. Add validation check constraint
ALTER TABLE endpoint_rate_limits
    DROP CONSTRAINT IF EXISTS chk_rate_limit_per_guest_positive,
    ADD CONSTRAINT chk_rate_limit_per_guest_positive CHECK (rate_limit_per_guest > 0);

-- 3. Set default rate_limit_per_guest for chat endpoint to 2 messages
UPDATE endpoint_rate_limits
SET rate_limit_per_guest = 2
WHERE endpoint = '/api/chat';

-- 4. Add UI texts for guest rate limit message
INSERT INTO ui_texts (key, value)
VALUES
    ('chat_guest_limit_reached', 'Batas akun tamu tercapai (maksimal 2 pesan). Silakan masuk ke akun Anda untuk melanjutkan percakapan — setelah masuk tetap gratis!')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
