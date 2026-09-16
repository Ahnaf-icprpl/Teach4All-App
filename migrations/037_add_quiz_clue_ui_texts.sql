-- ============================================================
-- Migration 037: Add UI Texts for Quiz Clue Stick Feature
-- ============================================================

INSERT INTO ui_texts (key, value)
VALUES
    ('dialogs_quiz_clue_title', 'Petunjuk AI'),
    ('dialogs_quiz_clue_loading', 'Menyiapkan petunjuk cerdas...'),
    ('dialogs_quiz_clue_tip', 'Petunjuk konseptual tanpa membocorkan jawaban'),
    ('dialogs_quiz_clue_close', 'Tutup Petunjuk'),
    ('dialogs_quiz_clue_retry', 'Petunjuk Lain')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
