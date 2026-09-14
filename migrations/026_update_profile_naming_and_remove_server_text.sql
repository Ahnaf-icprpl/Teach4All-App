-- Migration: 026_update_profile_naming_and_remove_server_text.sql
-- Description: Update bottom-left profile naming to a proper title and remove "tersimpan di server" text

UPDATE ui_texts
SET value = 'Akun Pengguna', updated_at = CURRENT_TIMESTAMP
WHERE key = 'sidebar_profile_name';

UPDATE ui_texts
SET value = 'Pribadi', updated_at = CURRENT_TIMESTAMP
WHERE key = 'sidebar_profile_detail';

UPDATE ui_texts
SET value = 'Akun Pengguna', updated_at = CURRENT_TIMESTAMP
WHERE key = 'auth_guest_name';

UPDATE ui_texts
SET value = 'Pribadi', updated_at = CURRENT_TIMESTAMP
WHERE key = 'auth_guest_detail';

UPDATE ui_texts
SET value = 'P', updated_at = CURRENT_TIMESTAMP
WHERE key = 'sidebar_profile_avatar';
