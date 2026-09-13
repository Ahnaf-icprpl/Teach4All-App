-- Migration: 007_create_chat_prompts.sql
-- Create chat_prompts table with icon and color, and seed 10 premade prompts.

CREATE TABLE IF NOT EXISTS chat_prompts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    detail VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    icon VARCHAR(50) NOT NULL DEFAULT 'bulb',
    color VARCHAR(50) NOT NULL DEFAULT 'amber',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_prompts_id ON chat_prompts(id);

DROP TRIGGER IF EXISTS trg_chat_prompts_updated_at ON chat_prompts;
CREATE TRIGGER trg_chat_prompts_updated_at
    BEFORE UPDATE ON chat_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- Seed 10 premade prompts
INSERT INTO chat_prompts (id, title, detail, prompt, icon, color) VALUES
    (1, 'Jelaskan sederhana', 'Pahami konsep penting', 'Jelaskan proses fotosintesis secara sederhana beserta contoh dalam kehidupan sehari-hari.', 'bulb', 'amber'),
    (2, 'Buat rencana belajar', 'Langkah kecil, hasil nyata', 'Bantu saya membuat rencana belajar sederhana untuk minggu ini.', 'plan', 'blue'),
    (3, 'Inspirasi ide kreatif', 'Kembangkan imajinasi Anda', 'Berikan ide cerita kreatif atau topik menarik untuk memicu ide saya.', 'spark', 'purple'),
    (4, 'Pecahkan masalah', 'Satu langkah demi satu langkah', 'Tunjukkan langkah demi langkah cara menyelesaikan masalah atau soal ini.', 'book', 'green'),
    (5, 'Kuis interaktif', 'Uji pemahaman topik', 'Buatkan saya kuis 5 soal pilihan ganda tentang tata surya beserta kunci jawabannya.', 'spark', 'amber'),
    (6, 'Ringkasan materi', 'Poin utama terstruktur', 'Buatkan ringkasan materi inti tentang revolusi industri dan dampaknya.', 'book', 'blue'),
    (7, 'Belajar kosakata', 'Perluas pemahaman bahasa', 'Ajarkan saya 5 kosakata bahasa Inggris penting dalam dunia sains beserta contoh kalimatnya.', 'globe', 'purple'),
    (8, 'Analogi dunia nyata', 'Konsep rumit jadi mudah', 'Jelaskan bagaimana cara kerja internet menggunakan analogi kantor pos atau jalan raya.', 'bulb', 'green'),
    (9, 'Eksperimen sains', 'Praktik langsung di rumah', 'Berikan satu ide eksperimen sains sederhana yang aman dilakukan di rumah beserta penjelasannya.', 'leaf', 'amber'),
    (10, 'Kritik & evaluasi', 'Latih berpikir kritis', 'Bagaimana cara melatih kemampuan berpikir kritis saat membaca berita atau informasi di media sosial?', 'search', 'blue')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    detail = EXCLUDED.detail,
    prompt = EXCLUDED.prompt,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    updated_at = CURRENT_TIMESTAMP;

-- Reset sequence to avoid conflict on future inserts
SELECT setval(pg_get_serial_sequence('chat_prompts', 'id'), coalesce(max(id), 1)) FROM chat_prompts;
