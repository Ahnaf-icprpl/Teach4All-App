-- Migration: 010_add_mock_quiz_material_ui_texts.sql
-- Add UI texts for mock quiz and material cards, suffixes, categories, and timestamps

INSERT INTO ui_texts (key, value) VALUES
    ('dialogs_modules_count_suffix', 'modul'),
    ('dialogs_quiz_start_button', 'Mulai Kuis'),
    ('dialogs_material_open_button', 'Buka Materi'),
    ('dialogs_quiz_create_new', 'Buat Kuis Baru'),
    ('dialogs_material_create_new', 'Buat Materi Baru'),
    ('dialogs_meta_parts_suffix', 'Bagian'),
    ('dialogs_meta_read_time_suffix', 'mnt baca'),
    ('dialogs_meta_questions_suffix', 'Soal'),
    ('dialogs_meta_multiple_choice', 'Pilihan Ganda'),
    ('dialogs_meta_structured_logic', 'Logika Terarah'),
    ('dialogs_meta_applied_science', 'Sains Terapan'),
    ('dialogs_meta_self_reflection', 'Refleksi Diri'),
    ('dialogs_time_today', 'Hari ini'),
    ('dialogs_time_yesterday', 'Kemarin'),
    ('dialogs_time_days_ago_suffix', 'hari lalu'),
    ('dialogs_cat_biology', 'Biologi'),
    ('dialogs_cat_astronomy', 'Astronomi'),
    ('dialogs_cat_math', 'Matematika'),
    ('dialogs_cat_basic_science', 'Sains Dasar'),
    ('dialogs_cat_self_development', 'Pengembangan Diri'),
    ('dialogs_cat_literacy_science', 'Literasi & Sains')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
