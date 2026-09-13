-- ============================================================
-- Migration 015: Add Development Notice Banner UI Texts
-- ============================================================
-- Add UI texts for the sticky development warning popup.
-- Displayed only when running in development environment.

INSERT INTO ui_texts (key, value)
VALUES
    ('dev_banner_badge', 'Dev'),
    ('dev_banner_notice', 'Ini adalah development build — semua riwayat percakapan dapat bercampur dengan semua orang (all chat history may be mixed with everyone).'),
    ('dev_banner_close_aria', 'Tutup pemberitahuan')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
