-- ============================================================
-- Migration 013: Add UI Texts for Interactive Quiz & Material Integration
-- ============================================================

INSERT INTO ui_texts (key, value)
VALUES
    ('dialogs_filter_all', 'Semua'),
    ('dialogs_filter_unsolved', 'Belum Selesai'),
    ('dialogs_filter_solved', 'Selesai'),
    ('dialogs_btn_mark_solved', 'Tandai Selesai'),
    ('dialogs_btn_mark_unsolved', 'Belum Selesai'),
    ('dialogs_btn_solve', 'Kerjakan Kuis'),
    ('dialogs_btn_read', 'Baca Materi'),
    ('dialogs_btn_chat', 'Tanya AI'),
    ('dialogs_quiz_question_label', 'Soal'),
    ('dialogs_quiz_of_label', 'dari'),
    ('dialogs_quiz_score_label', 'Skor Anda'),
    ('dialogs_quiz_explanation_label', 'Penjelasan & Pembahasan'),
    ('dialogs_quiz_next_btn', 'Soal Selanjutnya'),
    ('dialogs_quiz_prev_btn', 'Sebelumnya'),
    ('dialogs_quiz_finish_btn', 'Selesaikan Kuis'),
    ('dialogs_quiz_restart_btn', 'Ulangi Kuis'),
    ('dialogs_quiz_correct_feedback', 'Jawaban Benar!'),
    ('dialogs_quiz_incorrect_feedback', 'Jawaban Kurang Tepat'),
    ('dialogs_quiz_completed_title', 'Kuis Selesai!'),
    ('dialogs_material_section_label', 'Bagian'),
    ('dialogs_material_finish_btn', 'Selesai Membaca'),
    ('dialogs_material_next_btn', 'Bagian Selanjutnya'),
    ('dialogs_material_prev_btn', 'Sebelumnya'),
    ('dialogs_back_to_list', 'Kembali ke Daftar'),
    ('dialogs_toast_quiz_solved', 'Kuis berhasil ditandai selesai!'),
    ('dialogs_toast_quiz_unsolved', 'Kuis ditandai belum selesai.'),
    ('dialogs_toast_material_solved', 'Materi berhasil ditandai selesai!'),
    ('dialogs_toast_material_unsolved', 'Materi ditandai belum selesai.'),
    ('dialogs_empty_filter', 'Tidak ada modul pada filter ini.'),
    ('dialogs_quiz_loading', 'Memuat kuis...'),
    ('dialogs_quiz_not_found', 'Kuis tidak ditemukan.'),
    ('dialogs_material_loading', 'Memuat materi...'),
    ('dialogs_material_not_found', 'Materi tidak ditemukan.')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
