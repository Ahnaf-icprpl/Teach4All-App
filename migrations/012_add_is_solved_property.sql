-- ============================================================
-- Migration 012: Add is_solved property to quizzes and materials
-- ============================================================

-- 1. Add is_solved column to quizzes
ALTER TABLE quizzes
ADD COLUMN IF NOT EXISTS is_solved BOOLEAN NOT NULL DEFAULT false;

-- 2. Add is_solved column to quiz_questions
ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS is_solved BOOLEAN NOT NULL DEFAULT false;

-- 3. Add is_solved and is_completed columns to materials
ALTER TABLE materials
ADD COLUMN IF NOT EXISTS is_solved BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE materials
ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;

-- 4. Add is_completed column to material_sections
ALTER TABLE material_sections
ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;

-- 5. Add index for filtering by solved status
CREATE INDEX IF NOT EXISTS idx_quizzes_is_solved ON quizzes(is_solved);
CREATE INDEX IF NOT EXISTS idx_materials_is_solved ON materials(is_solved);

-- 6. Insert UI texts for solved status badge (zero fallback guarantee)
INSERT INTO ui_texts (key, value)
VALUES
    ('dialogs_status_solved', 'Selesai'),
    ('dialogs_status_unsolved', 'Belum Selesai')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
