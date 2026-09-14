-- ============================================================
-- Migration 021: Remove all seeded quizzes and materials
-- Deletes the initial 5 quizzes and 5 materials seeded in migration 011.
-- ============================================================

-- 1. Remove quiz questions belonging to seeded quizzes
DELETE FROM quiz_questions
WHERE quiz_id IN (
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0001-000000000005'
)
OR quiz_id IN (
    SELECT id FROM quizzes WHERE slug IN (
        'fotosintesis-dan-reaksi-terang',
        'tata-surya-dan-karakteristik-planet',
        'penalaran-matematika-dan-logika',
        'pengetahuan-sains-dan-alam-sekitar',
        'metode-dan-manajemen-waktu-belajar'
    )
);

-- 2. Remove seeded quizzes
DELETE FROM quizzes
WHERE id IN (
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0001-000000000005'
)
OR slug IN (
    'fotosintesis-dan-reaksi-terang',
    'tata-surya-dan-karakteristik-planet',
    'penalaran-matematika-dan-logika',
    'pengetahuan-sains-dan-alam-sekitar',
    'metode-dan-manajemen-waktu-belajar'
);

-- 3. Remove material sections belonging to seeded materials
DELETE FROM material_sections
WHERE material_id IN (
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0002-000000000002',
    '00000000-0000-0000-0002-000000000003',
    '00000000-0000-0000-0002-000000000004',
    '00000000-0000-0000-0002-000000000005'
)
OR material_id IN (
    SELECT id FROM materials WHERE slug IN (
        'ringkasan-fotosintesis-dapur-bertenaga-surya',
        'arsitektur-tata-surya-dan-hukum-gravitasi',
        'kerangka-5-langkah-pemecahan-masalah-matematika',
        'strategi-belajar-efektif-dan-retensi-memori',
        'prinsip-berpikir-kritis-dan-literasi-informasi'
    )
);

-- 4. Remove seeded materials
DELETE FROM materials
WHERE id IN (
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0002-000000000002',
    '00000000-0000-0000-0002-000000000003',
    '00000000-0000-0000-0002-000000000004',
    '00000000-0000-0000-0002-000000000005'
)
OR slug IN (
    'ringkasan-fotosintesis-dapur-bertenaga-surya',
    'arsitektur-tata-surya-dan-hukum-gravitasi',
    'kerangka-5-langkah-pemecahan-masalah-matematika',
    'strategi-belajar-efektif-dan-retensi-memori',
    'prinsip-berpikir-kritis-dan-literasi-informasi'
);
