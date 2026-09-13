-- ============================================================
-- Migration 016: Update Development Notice Banner Text to Proper Indonesian
-- ============================================================

UPDATE ui_texts
SET
    value = 'Ini adalah versi pengembangan — seluruh riwayat percakapan dapat bercampur dengan pengguna lain.',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'dev_banner_notice';
