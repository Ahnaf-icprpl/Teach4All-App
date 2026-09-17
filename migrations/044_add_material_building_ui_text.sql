-- ============================================================
-- Migration 044: Add Material Building Status UI Text
-- ============================================================
-- Add UI text for the animated loading indicator when generating structured learning materials.

INSERT INTO ui_texts (key, value)
VALUES
    ('chat_material_building_status', 'Menyusun materi pembelajaran...')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
