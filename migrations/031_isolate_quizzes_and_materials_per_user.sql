-- Migration: 031_isolate_quizzes_and_materials_per_user.sql
-- Description: Add user_id indexes and scoped unique constraints for multi-user isolation

-- 1. Create indexes on user_id for quizzes and materials
CREATE INDEX IF NOT EXISTS idx_quizzes_user_id ON public.quizzes(user_id);
CREATE INDEX IF NOT EXISTS idx_materials_user_id ON public.materials(user_id);

-- 2. Drop global unique constraints on slug and replace with per-user unique index
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_slug_key;
ALTER TABLE public.materials DROP CONSTRAINT IF EXISTS materials_slug_key;

DROP INDEX IF EXISTS uq_quizzes_user_slug;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quizzes_user_slug ON public.quizzes(user_id, slug) WHERE slug IS NOT NULL;

DROP INDEX IF EXISTS uq_materials_user_slug;
CREATE UNIQUE INDEX IF NOT EXISTS uq_materials_user_slug ON public.materials(user_id, slug) WHERE slug IS NOT NULL;
