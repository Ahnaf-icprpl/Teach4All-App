-- Migration: 041_update_export_chat_history_ui_text.sql
-- Description: Update export UI text to proper Indonesian sentence "Ekspor riwayat percakapan"

INSERT INTO ui_texts (key, value)
VALUES
    ('auth_export_workspace', 'Ekspor riwayat percakapan')
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
