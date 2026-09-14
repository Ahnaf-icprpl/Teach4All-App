-- Migration: 032_add_google_tag_id.sql
-- Store Google Tag ID in ui_texts table for production analytics script injection.

INSERT INTO ui_texts (key, value)
VALUES ('google_tag_id', 'G-KY7LRDLJ84')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
