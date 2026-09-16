-- ============================================================
-- Migration 038: Add clue column to quiz_questions table
-- ============================================================

ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS clue TEXT;
