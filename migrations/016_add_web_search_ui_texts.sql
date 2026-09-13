-- ============================================================
-- Migration 016: Add Web Search UI Texts
-- ============================================================
-- Add UI texts for the autonomous web search toggle and citation labels.

INSERT INTO ui_texts (key, value)
VALUES
    ('chat_web_search_toggle', 'Pencarian Web'),
    ('chat_web_search_active', 'Pencarian Web: Otomatis Aktif (AI mencari jika perlu)'),
    ('chat_web_search_inactive', 'Pencarian Web: Nonaktif (Hanya pengetahuan model)'),
    ('chat_web_search_offline', 'Pencarian Web memerlukan koneksi internet'),
    ('chat_web_search_status', 'Mencari informasi di web...'),
    ('chat_sources_label', 'Sumber Referensi')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
