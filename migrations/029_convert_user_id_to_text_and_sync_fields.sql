-- Migration: 029_convert_user_id_to_text_and_sync_fields.sql
-- 1. Drop foreign key constraints referencing users(id)
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_user_id_fkey;
ALTER TABLE public.materials DROP CONSTRAINT IF EXISTS materials_user_id_fkey;

-- 2. Alter column types from UUID to TEXT
ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE public.conversations ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE public.messages ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE public.quizzes ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE public.materials ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- 3. Re-create foreign key constraints referencing users(id)
ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.messages
    ADD CONSTRAINT messages_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.quizzes
    ADD CONSTRAINT quizzes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.materials
    ADD CONSTRAINT materials_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- 4. Add profile sync columns to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 5. Trigger for maintaining updated_at on users table
DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- 6. Supporting index on email
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
