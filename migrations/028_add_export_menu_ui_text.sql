-- Migration: 028_add_export_menu_ui_text.sql
-- Description: Add UI text for export workspace option in profile menu

INSERT INTO ui_texts (key, value)
VALUES
    ('auth_export_workspace', 'Ekspor Ruang Kerja')
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
