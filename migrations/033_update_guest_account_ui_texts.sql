-- Migration: 033_update_guest_account_ui_texts.sql
-- Description: Update guest account UI texts to explicitly display "Akun Tamu" and "Klik untuk masuk"

UPDATE ui_texts
SET value = 'Akun Tamu', updated_at = CURRENT_TIMESTAMP
WHERE key = 'auth_guest_name';

UPDATE ui_texts
SET value = 'Klik untuk masuk', updated_at = CURRENT_TIMESTAMP
WHERE key = 'auth_guest_detail';

UPDATE ui_texts
SET value = 'T', updated_at = CURRENT_TIMESTAMP
WHERE key = 'auth_guest_avatar';
