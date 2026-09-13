-- Migration: 017_add_copy_prompt_ui_text.sql
-- Add UI text key for copying user prompts in chat.

INSERT INTO ui_texts (key, value)
VALUES
    ('chat_copy_prompt_aria', 'Salin prompt')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
