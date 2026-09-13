-- Migration: 009_add_quiz_material_dialog_texts.sql
-- Add UI texts for quiz and material list dialogs

INSERT INTO ui_texts (key, value) VALUES
    ('dialogs_title_quiz', 'Daftar Kuis Pembelajaran'),
    ('dialogs_title_material', 'Daftar Materi Pembelajaran'),
    ('dialogs_quiz_desc', 'Pilih kuis latihan untuk menguji pemahaman Anda secara langsung.'),
    ('dialogs_material_desc', 'Pilih topik ringkasan materi terstruktur untuk dipelajari.'),
    ('dialogs_topic_custom_quiz', 'Atau ketik topik kuis kustom...'),
    ('dialogs_topic_custom_material', 'Atau ketik topik materi kustom...'),
    ('dialogs_topic_open_button', 'Buka')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
