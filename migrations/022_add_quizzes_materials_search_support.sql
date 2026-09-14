-- Migration: 022_add_quizzes_materials_search_support.sql
-- Create GIN trigram indexes for fast case-insensitive search across quizzes, materials, and child tables,
-- and add UI texts for search inputs in study dialogs.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_quizzes_title_trgm ON quizzes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quizzes_category_trgm ON quizzes USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quizzes_summary_trgm ON quizzes USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_text_trgm ON quiz_questions USING gin (question_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_materials_title_trgm ON materials USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_materials_category_trgm ON materials USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_materials_summary_trgm ON materials USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_material_sections_title_trgm ON material_sections USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_material_sections_content_trgm ON material_sections USING gin (content gin_trgm_ops);

INSERT INTO ui_texts (key, value) VALUES
    ('dialogs_search_quiz_placeholder', 'Cari kuis pembelajaran...'),
    ('dialogs_search_material_placeholder', 'Cari materi pembelajaran...'),
    ('dialogs_search_aria', 'Cari topik pembelajaran')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
