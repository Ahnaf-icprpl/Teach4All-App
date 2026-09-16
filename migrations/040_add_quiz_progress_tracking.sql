-- ============================================================
-- Migration 040: Add quiz progress tracking columns to quizzes
-- ============================================================

-- 1. Add last_question_index to quizzes table
ALTER TABLE quizzes
ADD COLUMN IF NOT EXISTS last_question_index INTEGER NOT NULL DEFAULT 0;

-- 2. Add user_answers to quizzes table
ALTER TABLE quizzes
ADD COLUMN IF NOT EXISTS user_answers JSONB NOT NULL DEFAULT '{}'::jsonb;
