-- Migration: 011_create_quizzes_and_materials_tables.sql
-- Create normalized relational tables for quizzes and materials, split into 2 tables each.

-- ============================================================
-- 1. Quizzes Table (Header / Metadata)
-- ============================================================
CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    category VARCHAR(100) NOT NULL DEFAULT 'Umum',
    summary TEXT NOT NULL DEFAULT '',
    difficulty VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    icon VARCHAR(50) NOT NULL DEFAULT 'bulb',
    color VARCHAR(50) NOT NULL DEFAULT 'blue',
    prompt TEXT NOT NULL DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quizzes_category ON quizzes(category);
CREATE INDEX IF NOT EXISTS idx_quizzes_conversation_id ON quizzes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_created_at ON quizzes(created_at DESC);

DROP TRIGGER IF EXISTS trg_quizzes_updated_at ON quizzes;
CREATE TRIGGER trg_quizzes_updated_at
    BEFORE UPDATE ON quizzes
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- ============================================================
-- 2. Quiz Questions Table (Questions per Quiz)
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_number INT NOT NULL,
    question_text TEXT NOT NULL,
    question_type VARCHAR(30) NOT NULL DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'true_false', 'short_answer')),
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_answer TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    points INT NOT NULL DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_quiz_question_number UNIQUE (quiz_id, question_number)
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_order ON quiz_questions(quiz_id, question_number ASC);

DROP TRIGGER IF EXISTS trg_quiz_questions_updated_at ON quiz_questions;
CREATE TRIGGER trg_quiz_questions_updated_at
    BEFORE UPDATE ON quiz_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- ============================================================
-- 3. Materials Table (Header / Metadata)
-- ============================================================
CREATE TABLE IF NOT EXISTS materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    category VARCHAR(100) NOT NULL DEFAULT 'Umum',
    summary TEXT NOT NULL DEFAULT '',
    estimated_read_time INT NOT NULL DEFAULT 5,
    difficulty VARCHAR(20) NOT NULL DEFAULT 'beginner' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    icon VARCHAR(50) NOT NULL DEFAULT 'book',
    color VARCHAR(50) NOT NULL DEFAULT 'green',
    prompt TEXT NOT NULL DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_conversation_id ON materials(conversation_id);
CREATE INDEX IF NOT EXISTS idx_materials_created_at ON materials(created_at DESC);

DROP TRIGGER IF EXISTS trg_materials_updated_at ON materials;
CREATE TRIGGER trg_materials_updated_at
    BEFORE UPDATE ON materials
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- ============================================================
-- 4. Material Sections Table (Sections / Parts per Material)
-- ============================================================
CREATE TABLE IF NOT EXISTS material_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    section_number INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    read_time_minutes INT NOT NULL DEFAULT 2,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_material_section_number UNIQUE (material_id, section_number)
);

CREATE INDEX IF NOT EXISTS idx_material_sections_material_id ON material_sections(material_id);
CREATE INDEX IF NOT EXISTS idx_material_sections_order ON material_sections(material_id, section_number ASC);

DROP TRIGGER IF EXISTS trg_material_sections_updated_at ON material_sections;
CREATE TRIGGER trg_material_sections_updated_at
    BEFORE UPDATE ON material_sections
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- ============================================================
-- 5. Seed Data: Initial 5 Quizzes
-- ============================================================
INSERT INTO quizzes (id, title, slug, category, summary, difficulty, icon, color, prompt, is_published)
VALUES
    ('00000000-0000-0000-0001-000000000001', 'Kuis Fotosintesis & Reaksi Terang', 'fotosintesis-dan-reaksi-terang', 'Biologi', 'Evaluasi 5 soal tentang kloroplas, penyerapan foton matahari, siklus Calvin, dan pelepasan oksigen.', 'medium', 'leaf', 'green', 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Fotosintesis dan Reaksi Terang', true),
    ('00000000-0000-0000-0001-000000000002', 'Kuis Tata Surya & Karakteristik Planet', 'tata-surya-dan-karakteristik-planet', 'Astronomi', 'Uji pemahaman tentang planet kebumian, planet gas raksasa, orbit elips, dan gravitasi Matahari.', 'medium', 'globe', 'blue', 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Tata Surya dan Karakteristik Planet', true),
    ('00000000-0000-0000-0001-000000000003', 'Kuis Penalaran Matematika & Logika', 'penalaran-matematika-dan-logika', 'Matematika', 'Soal penalaran proporsional, pola deret angka, dan pemecahan masalah bertahap.', 'hard', 'bulb', 'purple', 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Matematika dan Logika Bertahap', true),
    ('00000000-0000-0000-0001-000000000004', 'Kuis Pengetahuan Sains & Alam Sekitar', 'pengetahuan-sains-dan-alam-sekitar', 'Sains Dasar', 'Pertanyaan seputar wujud zat, siklus air, perubahan energi, dan gaya gesek di lingkungan sekitar.', 'easy', 'spark', 'amber', 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Sains dan Alam Sekitar', true),
    ('00000000-0000-0000-0001-000000000005', 'Kuis Metode & Manajemen Waktu Belajar', 'metode-dan-manajemen-waktu-belajar', 'Pengembangan Diri', 'Refleksi penerapan teknik active recall, spaced repetition, dan strategi fokus pomodoro.', 'easy', 'plan', 'blue', 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Rencana dan Metode Belajar', true)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    prompt = EXCLUDED.prompt,
    updated_at = CURRENT_TIMESTAMP;

-- Seed Questions for Quiz 1 (Fotosintesis)
INSERT INTO quiz_questions (quiz_id, question_number, question_text, question_type, options, correct_answer, explanation, points)
VALUES
    ('00000000-0000-0000-0001-000000000001', 1, 'Di bagian manakah pada sel tumbuhan reaksi terang fotosintesis berlangsung?', 'multiple_choice', '[{"key": "A", "text": "Membran tilakoid dalam kloroplas"}, {"key": "B", "text": "Stroma kloroplas"}, {"key": "C", "text": "Matriks mitokondria"}, {"key": "D", "text": "Vakuola sentral"}]'::jsonb, 'A', 'Reaksi terang berlangsung pada membran tilakoid kloroplas di mana terdapat klorofil dan fotosistem I & II.', 10),
    ('00000000-0000-0000-0001-000000000001', 2, 'Senyawa gas apakah yang dihasilkan sebagai produk sampingan dari fotolisis air?', 'multiple_choice', '[{"key": "A", "text": "Karbon dioksida (CO2)"}, {"key": "B", "text": "Oksigen (O2)"}, {"key": "C", "text": "Gas nitrogen (N2)"}, {"key": "D", "text": "Gas metana (CH4)"}]'::jsonb, 'B', 'Fotolisis air memecah molekul H2O menjadi elektron, ion hidrogen, dan gas oksigen bebas.', 10),
    ('00000000-0000-0000-0001-000000000001', 3, 'Molekul energi utama yang dihasilkan selama reaksi terang untuk digunakan dalam siklus Calvin adalah...', 'multiple_choice', '[{"key": "A", "text": "ATP dan NADPH"}, {"key": "B", "text": "Glukosa dan FADH2"}, {"key": "C", "text": "Asam piruvat dan NADH"}, {"key": "D", "text": "ADP dan NADP+"}]'::jsonb, 'A', 'ATP dan NADPH dihasilkan melalui fosforilasi dan transfer elektron untuk menyuplai energi di siklus Calvin.', 10),
    ('00000000-0000-0000-0001-000000000001', 4, 'Enzim krusial yang mengikat karbon dioksida pada awal siklus Calvin dinamakan...', 'multiple_choice', '[{"key": "A", "text": "ATP Sintase"}, {"key": "B", "text": "RuBisCO"}, {"key": "C", "text": "Katalase"}, {"key": "D", "text": "Amilase"}]'::jsonb, 'B', 'RuBisCO (Ribulose-1,5-bisphosphate carboxylase-oxygenase) mengkatalisis fiksasi CO2 pada RuBP.', 10),
    ('00000000-0000-0000-0001-000000000001', 5, 'Faktor lingkungan yang dapat membatasi laju fotosintesis pada siang hari terik adalah...', 'multiple_choice', '[{"key": "A", "text": "Penutupan stomata karena dehidrasi"}, {"key": "B", "text": "Kelebihan kadar nitrogen udara"}, {"key": "C", "text": "Ketiadaan klorofil"}, {"key": "D", "text": "Penurunan intensitas cahaya"}]'::jsonb, 'A', 'Saat terik dan kering, stomata menutup untuk mencegah penguapan air, sehingga pasokan CO2 menurun.', 10)
ON CONFLICT (quiz_id, question_number) DO UPDATE SET
    question_text = EXCLUDED.question_text,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    explanation = EXCLUDED.explanation;

-- Seed Questions for Quiz 2 (Tata Surya)
INSERT INTO quiz_questions (quiz_id, question_number, question_text, question_type, options, correct_answer, explanation, points)
VALUES
    ('00000000-0000-0000-0001-000000000002', 1, 'Planet manakah yang memiliki massa dan ukuran terbesar di tata surya kita?', 'multiple_choice', '[{"key": "A", "text": "Saturnus"}, {"key": "B", "text": "Yupiter"}, {"key": "C", "text": "Uranus"}, {"key": "D", "text": "Neptunus"}]'::jsonb, 'B', 'Yupiter adalah planet terbesar dengan massa lebih dari 2.5 kali gabungan seluruh planet lainnya.', 10),
    ('00000000-0000-0000-0001-000000000002', 2, 'Sabuk asteroid utama di tata surya terletak di antara orbit planet...', 'multiple_choice', '[{"key": "A", "text": "Bumi dan Mars"}, {"key": "B", "text": "Mars dan Yupiter"}, {"key": "C", "text": "Yupiter dan Saturnus"}, {"key": "D", "text": "Saturnus dan Uranus"}]'::jsonb, 'B', 'Sabuk asteroid terletak di antara Mars dan Yupiter, memisahkan planet kebumian dan planet luar.', 10),
    ('00000000-0000-0000-0001-000000000002', 3, 'Hukum Kepler I menyatakan bahwa lintasan orbit planet mengelilingi Matahari berbentuk...', 'multiple_choice', '[{"key": "A", "text": "Lingkaran sempurna"}, {"key": "B", "text": "Elips dengan Matahari di salah satu fokusnya"}, {"key": "C", "text": "Parabola terbuka"}, {"key": "D", "text": "Spiral konvergen"}]'::jsonb, 'B', 'Hukum I Kepler membuktikan bahwa semua planet bergerak dalam orbit elips dengan Matahari di salah satu titik fokusnya.', 10),
    ('00000000-0000-0000-0001-000000000002', 4, 'Planet yang dikenal memiliki efek rumah kaca ekstrem dengan suhu permukaan terpanas adalah...', 'multiple_choice', '[{"key": "A", "text": "Merkurius"}, {"key": "B", "text": "Venus"}, {"key": "C", "text": "Mars"}, {"key": "D", "text": "Yupiter"}]'::jsonb, 'B', 'Atmosfer tebal CO2 di Venus memerangkap panas ekstrem hingga mencapai suhu rata-rata lebih dari 460°C.', 10),
    ('00000000-0000-0000-0001-000000000002', 5, 'Benda langit yang mengelilingi Matahari dan memiliki ekor yang selalu menjauhi Matahari adalah...', 'multiple_choice', '[{"key": "A", "text": "Meteorit"}, {"key": "B", "text": "Komet"}, {"key": "C", "text": "Asteroid"}, {"key": "D", "text": "Satelit alami"}]'::jsonb, 'B', 'Angin matahari mendorong partikel es dan gas yang menguap dari komet sehingga ekornya selalu menjauhi Matahari.', 10)
ON CONFLICT (quiz_id, question_number) DO UPDATE SET
    question_text = EXCLUDED.question_text,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    explanation = EXCLUDED.explanation;

-- Seed Questions for Quiz 3 (Matematika & Logika)
INSERT INTO quiz_questions (quiz_id, question_number, question_text, question_type, options, correct_answer, explanation, points)
VALUES
    ('00000000-0000-0000-0001-000000000003', 1, 'Tentukan bilangan berikutnya pada deret pola: 3, 7, 15, 31, 63, ...', 'multiple_choice', '[{"key": "A", "text": "127"}, {"key": "B", "text": "125"}, {"key": "C", "text": "119"}, {"key": "D", "text": "131"}]'::jsonb, 'A', 'Pola deret adalah dikali 2 lalu ditambah 1: (63 × 2) + 1 = 127, atau penambahan beda berlipat ganda (+4, +8, +16, +32, +64).', 10),
    ('00000000-0000-0000-0001-000000000003', 2, 'Jika 5 pekerja membutuhkan 12 hari untuk menyelesaikan proyek, berapa hari yang dibutuhkan 10 pekerja dengan kecepatan kerja sama?', 'multiple_choice', '[{"key": "A", "text": "24 hari"}, {"key": "B", "text": "6 hari"}, {"key": "C", "text": "4 hari"}, {"key": "D", "text": "8 hari"}]'::jsonb, 'B', 'Ini adalah perbandingan berbalik nilai: (5 × 12) / 10 = 6 hari.', 10),
    ('00000000-0000-0000-0001-000000000003', 3, 'Premis 1: Semua mamalia bernapas dengan paru-paru. Premis 2: Lumba-lumba adalah mamalia. Kesimpulannya adalah...', 'multiple_choice', '[{"key": "A", "text": "Lumba-lumba bernapas dengan insang"}, {"key": "B", "text": "Lumba-lumba bernapas dengan paru-paru"}, {"key": "C", "text": "Beberapa mamalia tidak bernapas dengan paru-paru"}, {"key": "D", "text": "Lumba-lumba bukan ikan"}]'::jsonb, 'B', 'Berdasarkan silogisme modus ponens kategoris, kesimpulan sah adalah lumba-lumba bernapas dengan paru-paru.', 10),
    ('00000000-0000-0000-0001-000000000003', 4, 'Sebuah segitiga siku-siku memiliki panjang sisi alas 6 cm dan tinggi 8 cm. Berapakah panjang sisi miringnya?', 'multiple_choice', '[{"key": "A", "text": "9 cm"}, {"key": "B", "text": "10 cm"}, {"key": "C", "text": "12 cm"}, {"key": "D", "text": "14 cm"}]'::jsonb, 'B', 'Berdasarkan teorema Pythagoras: akar kuadrat dari (6^2 + 8^2) = akar(36 + 64) = akar(100) = 10 cm.', 10),
    ('00000000-0000-0000-0001-000000000003', 5, 'Dua koin logam seimbang dilempar bersamaan. Berapakah peluang munculnya minimal satu sisi gambar?', 'multiple_choice', '[{"key": "A", "text": "1/4"}, {"key": "B", "text": "1/2"}, {"key": "C", "text": "3/4"}, {"key": "D", "text": "2/3"}]'::jsonb, 'C', 'Ruang sampel total ada 4: (A,A), (A,G), (G,A), (G,G). Tiga di antaranya memiliki minimal satu sisi gambar (G). Peluang = 3/4.', 10)
ON CONFLICT (quiz_id, question_number) DO UPDATE SET
    question_text = EXCLUDED.question_text,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    explanation = EXCLUDED.explanation;

-- Seed Questions for Quiz 4 (Sains Dasar)
INSERT INTO quiz_questions (quiz_id, question_number, question_text, question_type, options, correct_answer, explanation, points)
VALUES
    ('00000000-0000-0000-0001-000000000004', 1, 'Peristiwa perubahan wujud zat dari padat langsung menjadi gas tanpa melalui fase cair disebut...', 'multiple_choice', '[{"key": "A", "text": "Mengembun"}, {"key": "B", "text": "Menyublim"}, {"key": "C", "text": "Mengkristal"}, {"key": "D", "text": "Membeku"}]'::jsonb, 'B', 'Menyublim adalah perubahan wujud dari padat langsung ke gas (contoh: kapur barus atau dry ice).', 10),
    ('00000000-0000-0000-0001-000000000004', 2, 'Energi yang tersimpan pada benda karena posisi atau ketinggiannya relatif terhadap permukaan bumi adalah...', 'multiple_choice', '[{"key": "A", "text": "Energi kinetik"}, {"key": "B", "text": "Energi potensial gravitasi"}, {"key": "C", "text": "Energi kalor"}, {"key": "D", "text": "Energi kimia"}]'::jsonb, 'B', 'Energi potensial gravitasi dirumuskan dengan Ep = m × g × h, dipengaruhi oleh massa dan ketinggian.', 10),
    ('00000000-0000-0000-0001-000000000004', 3, 'Dalam siklus hidrologi (air), proses penguapan air dari permukaan tanaman ke atmosfer dinamakan...', 'multiple_choice', '[{"key": "A", "text": "Evaporasi"}, {"key": "B", "text": "Transpirasi"}, {"key": "C", "text": "Presipitasi"}, {"key": "D", "text": "Kondensasi"}]'::jsonb, 'B', 'Transpirasi adalah pelepasan uap air dari stomata daun tumbuhan ke atmosfer.', 10),
    ('00000000-0000-0000-0001-000000000004', 4, 'Bunyi hukum aksi-reaksi Newton (Hukum III Newton) menyatakan bahwa...', 'multiple_choice', '[{"key": "A", "text": "Gaya total selalu berbanding lurus dengan massa benda"}, {"key": "B", "text": "Setiap gaya aksi akan menimbulkan gaya reaksi yang sama besar dan berlawanan arah"}, {"key": "C", "text": "Benda diam akan selalu diam selamanya"}, {"key": "D", "text": "Percepatan berbanding terbalik dengan gaya"}]'::jsonb, 'B', 'Hukum III Newton: F_aksi = -F_reaksi, bekerja pada dua benda berbeda secara simultan.', 10),
    ('00000000-0000-0000-0001-000000000004', 5, 'Perambatan kalor yang terjadi tanpa memerlukan medium perantara adalah...', 'multiple_choice', '[{"key": "A", "text": "Konduksi"}, {"key": "B", "text": "Konveksi"}, {"key": "C", "text": "Radiasi"}, {"key": "D", "text": "Adveksi"}]'::jsonb, 'C', 'Radiasi termal merambat melalui gelombang elektromagnetik sehingga dapat melewati ruang hampa udara (seperti sinar Matahari ke Bumi).', 10)
ON CONFLICT (quiz_id, question_number) DO UPDATE SET
    question_text = EXCLUDED.question_text,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    explanation = EXCLUDED.explanation;

-- Seed Questions for Quiz 5 (Metode Belajar)
INSERT INTO quiz_questions (quiz_id, question_number, question_text, question_type, options, correct_answer, explanation, points)
VALUES
    ('00000000-0000-0000-0001-000000000005', 1, 'Metode mengingat dengan cara aktif menguji diri sendiri (tanpa melihat buku) disebut...', 'multiple_choice', '[{"key": "A", "text": "Passive re-reading"}, {"key": "B", "text": "Active recall"}, {"key": "C", "text": "Cramming"}, {"key": "D", "text": "Highlighting"}]'::jsonb, 'B', 'Active recall merangsang memori kerja untuk menarik kembali informasi dari ingatan jangka panjang sehingga jalur sinapsis otak menguat.', 10),
    ('00000000-0000-0000-0001-000000000005', 2, 'Teknik Pomodoro standar membagi interval belajar menjadi sesi fokus selama...', 'multiple_choice', '[{"key": "A", "text": "25 menit fokus, 5 menit istirahat"}, {"key": "B", "text": "50 menit fokus, 20 menit istirahat"}, {"key": "C", "text": "60 menit fokus tanpa henti"}, {"key": "D", "text": "10 menit fokus, 10 menit istirahat"}]'::jsonb, 'A', 'Siklus standar Pomodoro adalah 25 menit sesi fokus intensif diikuti jeda istirahat singkat 5 menit.', 10),
    ('00000000-0000-0000-0001-000000000005', 3, 'Kurva Lupa Ebbinghaus menunjukkan bahwa manusia paling banyak melupakan informasi baru pada...', 'multiple_choice', '[{"key": "A", "text": "24 jam pertama setelah mempelajari informasi"}, {"key": "B", "text": "Satu bulan setelah belajar"}, {"key": "C", "text": "Saat sedang tidur malam"}, {"key": "D", "text": "Satu minggu setelah belajar"}]'::jsonb, 'A', 'Penurunan retensi memori terjadi paling drastis dalam 24 jam pertama jika materi tidak diulang kembali.', 10),
    ('00000000-0000-0000-0001-000000000005', 4, 'Kunci utama dari Teknik Feynman dalam memahami konsep rumit adalah...', 'multiple_choice', '[{"key": "A", "text": "Menghafal definisi kata demi kata"}, {"key": "B", "text": "Menjelaskan konsep tersebut dengan bahasa sederhana seolah mengajarkannya kepada anak kecil"}, {"key": "C", "text": "Menggarisbawahi seluruh teks dengan stabilo"}, {"key": "D", "text": "Membaca buku secara cepat (speed reading)"}]'::jsonb, 'B', 'Teknik Feynman melatih kita menemukan celah pemahaman dengan cara menyederhanakan bahasa dan membuat analogi konkret.', 10),
    ('00000000-0000-0000-0001-000000000005', 5, 'Manfaat menerapkan Spaced Repetition (pengulangan berjeda) adalah...', 'multiple_choice', '[{"key": "A", "text": "Mempersingkat total waktu belajar sebelum ujian dengan SKS"}, {"key": "B", "text": "Mengubah ingatan jangka pendek menjadi ingatan jangka panjang yang kokoh"}, {"key": "C", "text": "Menghindari perlunya membuat ringkasan"}, {"key": "D", "text": "Menghilangkan kebutuhan tidur malam"}]'::jsonb, 'B', 'Spaced repetition menginterupsi kurva lupa pada interval yang tepat sehingga daya rekat ingatan meningkat secara permanen.', 10)
ON CONFLICT (quiz_id, question_number) DO UPDATE SET
    question_text = EXCLUDED.question_text,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    explanation = EXCLUDED.explanation;

-- ============================================================
-- 6. Seed Data: Initial 5 Materials
-- ============================================================
INSERT INTO materials (id, title, slug, category, summary, estimated_read_time, difficulty, icon, color, prompt, is_published)
VALUES
    ('00000000-0000-0000-0002-000000000001', 'Ringkasan Fotosintesis: Dapur Bertenaga Surya', 'ringkasan-fotosintesis-dapur-bertenaga-surya', 'Biologi', 'Uraian terstruktur tentang struktur daun, konversi foton menjadi glukosa, dan peran krusial klorofil.', 4, 'beginner', 'leaf', 'green', 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Fotosintesis', true),
    ('00000000-0000-0000-0002-000000000002', 'Arsitektur Tata Surya & Hukum Gravitasi', 'arsitektur-tata-surya-dan-hukum-gravitasi', 'Astronomi', 'Susunan planet dalam dan planet luar, pengaruh orbit elips Kepler, serta karakteristik sabuk asteroid.', 6, 'intermediate', 'globe', 'blue', 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Tata Surya', true),
    ('00000000-0000-0000-0002-000000000003', 'Kerangka 5 Langkah Pemecahan Masalah Matematika', 'kerangka-5-langkah-pemecahan-masalah-matematika', 'Matematika', 'Langkah terarah membedah soal rumit: pemahaman premis, pembuatan model, penyelesaian, dan validasi.', 5, 'intermediate', 'bulb', 'purple', 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Pemecahan Masalah Matematika', true),
    ('00000000-0000-0000-0002-000000000004', 'Strategi Belajar Efektif & Retensi Memori', 'strategi-belajar-efektif-dan-retensi-memori', 'Pengembangan Diri', 'Panduan active recall, teknik Feynman sederhana, dan cara mengatasi kurva lupa Ebbinghaus secara konsisten.', 4, 'beginner', 'plan', 'amber', 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Rencana dan Metode Belajar', true),
    ('00000000-0000-0000-0002-000000000005', 'Prinsip Berpikir Kritis & Literasi Informasi', 'prinsip-berpikir-kritis-dan-literasi-informasi', 'Literasi & Sains', 'Tiga pilar verifikasi argumen ilmiah, pengujian data, dan pembedaan kausalitas dari korelasi semu.', 5, 'advanced', 'book', 'blue', 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Sains dan Pemikiran Kritis', true)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    estimated_read_time = EXCLUDED.estimated_read_time,
    prompt = EXCLUDED.prompt,
    updated_at = CURRENT_TIMESTAMP;

-- Seed Sections for Material 1 (Fotosintesis)
INSERT INTO material_sections (material_id, section_number, title, content, read_time_minutes)
VALUES
    ('00000000-0000-0000-0002-000000000001', 1, '1. Pengantar Fotosintesis & Kloroplas', 'Fotosintesis adalah proses biokimia fundamental di mana organisme autotrof (seperti tumbuhan hijau, alga, dan beberapa bakteri) mengonversi energi foton cahaya matahari menjadi energi kimia dalam bentuk molekul karbohidrat (glukosa).

Organel utama penyelenggara fotosintesis pada sel tumbuhan adalah **kloroplas**. Di dalam kloroplas terdapat dua kompartemen penting:
- **Tilakoid**: kantung membran pipih yang tersusun menjadi tumpukan (*grana*), tempat melekatnya pigmen klorofil dan pusat terjadinya reaksi terang.
- **Stroma**: cairan kental di luar tilakoid yang kaya akan enzim, tempat berlangsungnya siklus Calvin (reaksi gelap).', 1),
    ('00000000-0000-0000-0002-000000000001', 2, '2. Mekanisme Reaksi Terang & Fotolisis Air', 'Reaksi terang berlangsung secara langsung bergantung pada keberadaan cahaya. Tahapannya mencakup:
1. **Penyerapan Foton**: Cahaya diserap oleh kompleks antena pigmen pada Fotosistem II (P680) dan Fotosistem I (P700).
2. **Fotolisis Air**: Molekul air (H2O) dipecah menghasilkan elektron, proton H+, dan melepaskan gas oksigen (O2) ke atmosfer:
   `2 H2O -> 4 H+ + 4 e- + O2`
3. **Transport Elektron & Fotofosforilasi**: Aliran elektron melalui rantai transpor memompa proton ke dalam lumen tilakoid. Gradien proton ini menggerakkan enzim **ATP Sintase** untuk menghasilkan ATP serta mereduksi NADP+ menjadi NADPH.', 2),
    ('00000000-0000-0000-0002-000000000001', 3, '3. Siklus Calvin (Reaksi Gelap) & Pembentukan Gula', 'Siklus Calvin berlangsung di stroma tanpa memerlukan cahaya langsung, memanfaatkan energi kimia yang telah dihasilkan reaksi terang (ATP dan NADPH). Siklus ini terdiri dari 3 fase utama:
- **Fiksasi Karbon**: Enzim RuBisCO mengikat gas CO2 ke molekul gula 5-karbon (RuBP), menghasilkan molekul 3-PGA.
- **Reduksi**: Molekul 3-PGA diubah menjadi gula berenergi tinggi G3P menggunakan ATP dan NADPH.
- **Regenerasi RuBP**: Sebagian G3P keluar dari siklus untuk membentuk glukosa, sementara sisanya disusun kembali menjadi RuBP agar siklus dapat berlanjut.', 1)
ON CONFLICT (material_id, section_number) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    read_time_minutes = EXCLUDED.read_time_minutes;

-- Seed Sections for Material 2 (Tata Surya)
INSERT INTO material_sections (material_id, section_number, title, content, read_time_minutes)
VALUES
    ('00000000-0000-0000-0002-000000000002', 1, '1. Anatomi Pusat Tata Surya & Pengelompokan Planet', 'Tata Surya terbentuk sekitar 4,6 miliar tahun lalu dari keruntuhan gravitasi awan molekul raksasa antarbintang. Matahari merupakan bintang kelas katai kuning di pusat sistem yang menguasai lebih dari 99,8% massa total tata surya.

Planet-planet dikelompokkan menjadi dua golongan utama:
- **Planet Kebumian (Terestrial)**: Merkurius, Venus, Bumi, dan Mars. Dicirikan oleh kepadatan tinggi, permukaan berbatu padat, mantel logam, dan sedikit atau tanpa satelit alami.
- **Planet Gas & Es Raksasa (Jovian)**: Yupiter, Saturnus, Uranus, dan Neptunus. Dicirikan oleh diameter luar biasa, tidak memiliki permukaan padat yang tegas, komposisi hidrogen-helium atau senyawa volatil es, serta cincin partikel.', 2),
    ('00000000-0000-0000-0002-000000000002', 2, '2. Sabuk Asteroid & Wilayah Trans-Neptunus', 'Di antara orbit Mars dan Yupiter terbentang **Sabuk Asteroid Utama**, kumpulan jutaan pecahan batuan dan logam sisa pembentukan planet awal yang gagal bergabung karena tarikan gravitasi Yupiter yang dominan.

Di luar orbit Neptunus terdapat:
- **Sabuk Kuiper**: Wilayah piringan beku yang dihuni planet kerdil seperti Pluto, Haumea, dan Makemake.
- **Awan Oort**: Awan bola raksasa di tepi terluar pengaruh gravitasi Matahari yang menjadi asal-usul komet berperiode panjang.', 2),
    ('00000000-0000-0000-0002-000000000002', 3, '3. Hukum Kepler & Gravitasi Universal Newton', 'Gerak orbit planet dijelaskan secara matematis melalui Tiga Hukum Kepler:
1. **Hukum I**: Orbit setiap planet berbentuk elips dengan Matahari berada di salah satu titik fokusnya.
2. **Hukum II**: Garis khayal yang menghubungkan Matahari dengan planet menyapu luas daerah yang sama dalam selang waktu yang sama (planet bergerak lebih cepat di dekat perihelion).
3. **Hukum III**: Kuadrat periode revolusi planet sebanding dengan pangkat tiga jarak rata-ratanya ke Matahari (T^2 / a^3 = konstan).

Sir Isaac Newton menyatukan hukum Kepler ini dengan Hukum Gravitasi Universal:
`F = G * (m1 * m2) / r^2`', 2)
ON CONFLICT (material_id, section_number) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    read_time_minutes = EXCLUDED.read_time_minutes;

-- Seed Sections for Material 3 (Matematika)
INSERT INTO material_sections (material_id, section_number, title, content, read_time_minutes)
VALUES
    ('00000000-0000-0000-0002-000000000003', 1, '1. Kerangka Berpikir George Pólya', 'Matematikawan George Pólya merumuskan empat pilar universal dalam memecahkan masalah kuantitatif dan penalaran:
1. **Memahami Masalah (*Understanding the Problem*)**: Identifikasi apa yang ditanyakan, apa data yang diketahui, dan apakah informasi yang tersedia cukup untuk menentukan solusi.
2. **Menyusun Rencana (*Devising a Plan*)**: Temukan hubungan antara data dan hal yang tidak diketahui. Cari pola, gunakan analogi soal yang serupa, atau visualisasikan ke bentuk diagram/tabel.
3. **Melaksanakan Rencana (*Carrying Out the Plan*)**: Lakukan eksekusi perhitungan langkah demi langkah secara teliti dan buktikan kebenaran tiap baris operasi.
4. **Memeriksa Kembali (*Looking Back / Reflecting*)**: Uji hasil akhir dengan substitusi balik atau metode alternatif.', 2),
    ('00000000-0000-0000-0002-000000000003', 2, '2. Strategi Dekonstruksi & Pemodelan Aljabar', 'Saat menghadapi soal narasi yang tampak rumit:
- **Tentukan Variabel**: Beri label simbol aljabar yang jelas (misal: `x` untuk jumlah barang, `t` untuk waktu tempuh).
- **Terjemahkan Kalimat ke Persamaan**: Kata "dua kali lipat dari" diterjemahkan menjadi `2 * x`; kata "selisih" diterjemahkan menjadi `|x - y|`.
- **Eliminasi Ambigu**: Hilangkan informasi distraktor yang tidak berkorelasi langsung dengan variabel inti.', 2),
    ('00000000-0000-0000-0002-000000000003', 3, '3. Verifikasi Logika & Validasi Batasan', 'Langkah terakhir yang kerap dilewati adalah validasi batas nyata (*sanity check*):
- Apakah satuan hasil sesuai (misalnya kecepatan dalam km/jam, bukan satuan detik)?
- Apakah angka bernilai realistis (misalnya jumlah orang tidak mungkin pecahan atau bernilai negatif)?
- Apakah nilai memenuhi seluruh pertidaksamaan batas yang ditentukan di awal soal?', 1)
ON CONFLICT (material_id, section_number) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    read_time_minutes = EXCLUDED.read_time_minutes;

-- Seed Sections for Material 4 (Metode Belajar)
INSERT INTO material_sections (material_id, section_number, title, content, read_time_minutes)
VALUES
    ('00000000-0000-0000-0002-000000000004', 1, '1. Menaklukkan Kurva Lupa Hermann Ebbinghaus', 'Hermann Ebbinghaus pada tahun 1885 mendokumentasikan fenomena **Kurva Lupa** (*Forgetting Curve*): tanpa tinjauan ulang aktif, otak kita melupakan sekitar 50% informasi dalam 1 jam, dan hingga 70% dalam 24 jam.

Solusi paling efisien bukanlah belajar berjam-jam secara maraton (*cramming*), melainkan **Spaced Repetition** (pengulangan berjeda):
- Pengulangan ke-1: 1 hari setelah belajar (retensi naik ke 100%).
- Pengulangan ke-2: 3 hari kemudian.
- Pengulangan ke-3: 1 minggu kemudian.
- Pengulangan ke-4: 1 bulan kemudian.', 1),
    ('00000000-0000-0000-0002-000000000004', 2, '2. Active Recall vs Ilusi Penguasaan Pasif', 'Membaca ulang teks berkali-kali atau menstabilo buku menciptakan efek psikologis bernama **Ilusi Kompetensi** (*Illusion of Competence*): teks terasa familier di mata, tetapi otak sebenarnya belum menguasai cara memproduksinya dari memori.

**Active Recall** membalik cara ini:
- Tutup buku segera setelah membaca satu subbab.
- Tuliskan intisari konsep di lembar kertas kosong dari ingatanmu (*blurting technique*).
- Buat soal pertanyaan sendiri dan jawab tanpa melihat kunci.', 2),
    ('00000000-0000-0000-0002-000000000004', 3, '3. Implementasi Teknik Feynman 4 Langkah', 'Fisikawan peraih Nobel Richard Feynman memiliki metode ampuh untuk menguji pemahaman sejati:
1. **Pilih Konsep**: Tulis judul topik di bagian atas halaman kosong.
2. **Ajarkan pada Anak Usia 10 Tahun**: Jelaskan konsep tersebut menggunakan kata-kata sederhana tanpa jargon teknis rumit.
3. **Identifikasi Hambatan**: Temukan titik di mana penjelasanmu terhenti, terdengar rumit, atau tidak masuk akal. Ini adalah batas pemahamanmu.
4. **Pelajari Kembali & Sederhanakan Analogi**: Buka kembali referensi untuk memperdalam bagian yang bolong tadi hingga kamu bisa membuat analogi sehari-hari yang jernih.', 1)
ON CONFLICT (material_id, section_number) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    read_time_minutes = EXCLUDED.read_time_minutes;

-- Seed Sections for Material 5 (Berpikir Kritis)
INSERT INTO material_sections (material_id, section_number, title, content, read_time_minutes)
VALUES
    ('00000000-0000-0000-0002-000000000005', 1, '1. Tiga Pilar Skeptisisme Ilmiah yang Sehat', 'Berpikir kritis bukanlah sikap selalu membantah atau sinis, melainkan disiplin intelektual dalam mengevaluasi validitas klaim sebelum menerimanya sebagai fakta.

Tiga pilar fundamental:
- **Keterbukaan terhadap Bukti Baru (*Open-mindedness*)**: Kesediaan mengubah kesimpulan ketika bukti empiris yang lebih sahih ditemukan.
- **Tuntutan Bukti Sebanding (*Extraordinary claims require extraordinary evidence*)**: Klaim luar biasa membutuhkan bukti yang sama kuatnya.
- **Falsifiabilitas (*Karl Popper Principle*)**: Suatu hipotesis harus dapat diuji dengan kondisi di mana hipotesis tersebut berpotensi terbukti salah.', 2),
    ('00000000-0000-0000-0002-000000000005', 2, '2. Menghindari Jebakan Kausalitas vs Korelasi', 'Salah satu kesalahan nalar (*logical fallacy*) paling sering di era banjir data adalah mengasumsikan hubungan sebab-akibat padahal yang terjadi hanyalah korelasi kebetulan (*Cum hoc ergo propter hoc*).

Contoh klasik:
Penjualan es krim meningkat tajam pada bulan Juli; kasus sengatan matahari juga meningkat tajam pada bulan yang sama.
- *Kesimpulan keliru*: Makan es krim menyebabkan sengatan matahari.
- *Fakta*: Ada faktor variabel perancu ketiga (*confounding variable*), yaitu musim panas dengan temperatur udara tinggi yang memengaruhi kedua fenomena secara independen.', 2),
    ('00000000-0000-0000-0002-000000000005', 3, '3. Panduan Praktis Verifikasi Informasi Digital', 'Saat menerima informasi atau klaim di media digital, gunakan metode **Lateral Reading**:
1. Jangan terpaku pada tampilan estetika situs atau akun pembuat konten.
2. Buka tab baru di peramban, telusuri kredibilitas sumber asli dan afiliasi penulisnya.
3. Cari apakah ada konsensus ilmiah atau lembaga verifikasi independen yang telah memeriksa data tersebut.
4. Waspadai bahasa bermuatan emosi tinggi yang sengaja dirancang untuk mematikan nalar kritis.', 1)
ON CONFLICT (material_id, section_number) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    read_time_minutes = EXCLUDED.read_time_minutes;
