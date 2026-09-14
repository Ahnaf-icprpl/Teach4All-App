-- Migration: 035_alter_users_username_nullable.sql
-- Drop NOT NULL constraint on users.username to support OAuth users without explicit username
ALTER TABLE public.users ALTER COLUMN username DROP NOT NULL;
