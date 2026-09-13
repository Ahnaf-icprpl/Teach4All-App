-- ============================================================
-- Migration 020: Add Sidebar Lazy Load UI Texts
-- ============================================================
-- Add UI texts for lazy loading conversations in the sidebar.

INSERT INTO ui_texts (key, value)
VALUES
    ('sidebar_load_more', 'Muat lebih banyak'),
    ('sidebar_loading_more', 'Memuat percakapan...')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
