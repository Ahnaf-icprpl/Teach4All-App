-- Migration: 042_update_premade_chat_prompts.sql
-- Description: Update premade chat prompts to real-world exam, quiz, and study materials prompts

INSERT INTO chat_prompts (id, title, detail, prompt, icon, color) VALUES
    (1, 'Kuis Ujian Komputer', 'Latihan soal jaringan & IT', 'Buatkan kuis 15 soal pilihan ganda untuk persiapan ujian komputer dan informatika (topik: perangkat keras, jaringan komputer, dan keamanan siber dasar).', 'bulb', 'blue'),
    (2, 'Materi Coding Web', 'Modul dasar HTML, CSS & JS', 'Buatkan modul materi pembelajaran terstruktur tentang dasar pemrograman web (HTML, CSS, dan JavaScript) untuk pemula lengkap dengan contoh kode dan latihan.', 'book', 'green'),
    (3, 'Kuis Matematika Ujian', 'Aljabar & pemecahan masalah', 'Buatkan kuis latihan soal matematika materi aljabar dan persamaan linier dengan tingkat kesulitan bertahap beserta langkah pembahasannya.', 'spark', 'purple'),
    (4, 'Materi Fisika Terapan', 'Hukum gerak & teknologi', 'Buatkan materi pembelajaran lengkap dan bertahap tentang Hukum Gerak Newton beserta penerapan nyatanya dalam teknologi otomotif dan luar angkasa.', 'bulb', 'amber'),
    (5, 'Latihan Bahasa Inggris', 'Grammar & reading text', 'Buatkan kuis 10 soal persiapan ujian bahasa Inggris fokus pada grammar tenses dan pemahaman teks bacaan (reading comprehension).', 'globe', 'blue'),
    (6, 'Rangkuman Biologi Sel', 'Poin penting & hafalan inti', 'Buatkan rangkuman ringkas materi biologi tentang struktur dan fungsi sel hewan serta tumbuhan yang sering keluar saat ujian.', 'leaf', 'green'),
    (7, 'Jadwal Belajar Ujian', 'Rencana 7 hari anti-SKS', 'Bantu saya menyusun jadwal belajar teratur selama 7 hari untuk menghadapi pekan ujian sekolah agar waktu belajar efektif dan tidak sistem kebut semalam.', 'plan', 'purple'),
    (8, 'Analogi Konsep Sulit', 'Pahami topik rumit jadi mudah', 'Jelaskan cara kerja jaringan internet dan routing paket data menggunakan analogi sederhana kehidupan nyata yang sangat mudah dipahami.', 'bulb', 'amber'),
    (9, 'Materi Sejarah Nasional', 'Perjuangan kemerdekaan RI', 'Buatkan materi modul pembelajaran tentang peristiwa penting sekitar proklamasi kemerdekaan Indonesia dan peran tokoh-tokoh mudanya.', 'book', 'blue'),
    (10, 'Bimbingan Soal Sulit', 'Solusi langkah demi langkah', 'Saya ada soal atau tugas yang belum saya pahami. Bimbing saya menyelesaikannya langkah demi langkah dengan konsep dasarnya, jangan langsung beri jawaban.', 'search', 'green')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    detail = EXCLUDED.detail,
    prompt = EXCLUDED.prompt,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    updated_at = CURRENT_TIMESTAMP;

-- Reset sequence to avoid conflict on future inserts
SELECT setval(pg_get_serial_sequence('chat_prompts', 'id'), coalesce(max(id), 1)) FROM chat_prompts;
