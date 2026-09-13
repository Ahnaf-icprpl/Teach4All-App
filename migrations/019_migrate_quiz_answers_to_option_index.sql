-- ============================================================
-- Migration 019: Migrate Quiz Answers to Option Index / ID
-- Eliminates legacy ABCD matching: options now contain explicit
-- { "id": 0, "text": "..." } and correct_answer stores the 0-based index.
-- ============================================================

DO $$
DECLARE
    r RECORD;
    v_opts JSONB;
    v_new_opts JSONB;
    v_elem JSONB;
    v_idx INTEGER;
    v_correct_idx INTEGER;
    v_raw_correct TEXT;
    v_text TEXT;
BEGIN
    FOR r IN SELECT id, options, correct_answer FROM quiz_questions LOOP
        v_opts := r.options;
        v_raw_correct := trim(COALESCE(r.correct_answer, ''));
        v_new_opts := '[]'::jsonb;
        v_correct_idx := -1;

        FOR v_idx IN 0 .. (jsonb_array_length(v_opts) - 1) LOOP
            v_elem := v_opts->v_idx;
            IF jsonb_typeof(v_elem) = 'object' THEN
                v_text := COALESCE(v_elem->>'text', v_elem->>'label', '');
                IF upper(COALESCE(v_elem->>'key', '')) = upper(v_raw_correct) THEN
                    v_correct_idx := v_idx;
                ELSIF lower(v_text) = lower(v_raw_correct) THEN
                    v_correct_idx := v_idx;
                ELSIF v_elem->>'id' = v_raw_correct THEN
                    v_correct_idx := v_idx;
                END IF;
            ELSE
                v_text := v_elem #>> '{}';
                IF lower(v_text) = lower(v_raw_correct) THEN
                    v_correct_idx := v_idx;
                END IF;
            END IF;

            v_new_opts := v_new_opts || jsonb_build_object('id', v_idx, 'text', v_text);
        END LOOP;

        IF v_correct_idx = -1 THEN
            IF v_raw_correct ~ '^\d+$' AND (v_raw_correct::integer) >= 0 AND (v_raw_correct::integer) < jsonb_array_length(v_new_opts) THEN
                v_correct_idx := v_raw_correct::integer;
            ELSE
                v_correct_idx := 0;
            END IF;
        END IF;

        UPDATE quiz_questions
        SET options = v_new_opts,
            correct_answer = v_correct_idx::text
        WHERE id = r.id;
    END LOOP;
END $$;
