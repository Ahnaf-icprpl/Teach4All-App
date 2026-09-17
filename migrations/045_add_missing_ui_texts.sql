-- Migration: 045_add_missing_ui_texts.sql
-- Ensure 100% of UI texts referenced across the application are stored in ui_texts table.

INSERT INTO ui_texts (key, value) VALUES
    ('auth_not_configured', 'Autentikasi belum dikonfigurasi pada server.'),
    ('materials_default_title', 'Materi Pembelajaran'),
    ('auth_user_profile_button', 'Kelola Akun'),
    ('auth_default_user_name', 'Pengguna'),
    ('dialogs_quiz_clue_concept_prefix', 'Pikirkan konsep ini: '),
    ('dialogs_quiz_clue_concept_suffix', '. Analisis pilihan mana yang paling sesuai dengan prinsip tersebut.'),
    ('dialogs_quiz_clue_generic', 'Cermati kata kunci utama pada pertanyaan. Analisis karakteristik khas setiap pilihan dan eliminasi opsi yang tidak berkaitan dengan konsep yang ditanyakan.'),
    ('router_request_timed_out', 'Permintaan habis waktu. Silakan periksa koneksi Anda dan coba lagi.'),
    ('router_no_response', 'Tidak ada respons yang diterima dari server.'),
    ('router_request_cancelled', 'Permintaan dibatalkan.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
