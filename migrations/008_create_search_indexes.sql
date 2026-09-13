-- Migration: 008_create_search_indexes.sql
-- Create trigram extension and GIN indexes for fast text searching on conversations title and messages content.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_conversations_title_trgm ON conversations USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON messages USING gin (content gin_trgm_ops);
