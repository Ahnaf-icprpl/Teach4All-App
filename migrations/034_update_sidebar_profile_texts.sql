-- Migration: 034_update_sidebar_profile_texts.sql
-- Description: Ensure sidebar_profile_name, detail, and avatar match guest defaults and no longer display "Akun Pengguna"

UPDATE ui_texts
SET value = 'Akun Tamu', updated_at = CURRENT_TIMESTAMP
WHERE key = 'sidebar_profile_name';

UPDATE ui_texts
SET value = 'Klik untuk masuk', updated_at = CURRENT_TIMESTAMP
WHERE key = 'sidebar_profile_detail';

UPDATE ui_texts
SET value = 'T', updated_at = CURRENT_TIMESTAMP
WHERE key = 'sidebar_profile_avatar';
