-- Migration: 030_update_export_ui_text.sql
-- Description: Update export UI text in profile menu to "expor histori chat"

INSERT INTO ui_texts (key, value)
VALUES
    ('auth_export_workspace', 'expor histori chat')
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
