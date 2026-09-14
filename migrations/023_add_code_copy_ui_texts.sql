-- Migration: 023_add_code_copy_ui_texts.sql
-- Add UI texts for code block copy button and feedback in markdown renderer.

INSERT INTO ui_texts (key, value) VALUES
    ('markdown_copy_code_aria', 'Salin kode'),
    ('markdown_copy_code_button', 'Salin'),
    ('markdown_copy_code_success', 'Kode berhasil disalin.')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
