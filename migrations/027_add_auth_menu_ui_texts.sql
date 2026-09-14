-- Migration: 027_add_auth_menu_ui_texts.sql
-- Description: Add UI text for manage account option in profile menu

INSERT INTO ui_texts (key, value)
VALUES
    ('auth_manage_account', 'Kelola Akun')
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
