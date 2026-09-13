-- ============================================================
-- Migration 014: Remove Unused Mock Quiz and Material UI Texts
-- ============================================================
-- The mock quiz and material titles, summaries, and prompts
-- were previously stored in ui_texts as a temporary measure.
-- Since migration 011, quizzes and materials are normalized into
-- their own dedicated tables (quizzes, quiz_questions, materials,
-- material_sections). The mock keys in ui_texts are obsolete.

DELETE FROM ui_texts
WHERE key LIKE 'dialogs_mock_%';
