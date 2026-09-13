-- ============================================================
-- Migration 018: Add Quiz Building Status UI Text
-- ============================================================
-- Add UI text for the animated loading indicator when compiling an interactive quiz.

INSERT INTO ui_texts (key, value)
VALUES
    ('chat_quiz_building_status', 'Menyusun kuis interaktif...')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
