import {
  toUserId,
  ensureUserExists,
  getPool,
  query,
} from './dbCore.js';

/**
 * Retrieve list of quizzes with question count aggregation for a specific user.
 */
export async function getQuizzes({ userId, search, query: qSearch, category, limit = 50, offset = 0, databaseUrl } = {}) {
  const uId = toUserId(userId);
  const params = [uId];
  let where = 'WHERE q.is_published = true AND q.user_id = $1';
  if (category) {
    params.push(category);
    where += ` AND q.category = $${params.length}`;
  }
  const searchQuery = (search || qSearch || '').trim();
  if (searchQuery) {
    params.push(`%${searchQuery}%`);
    const sParam = `$${params.length}`;
    where += ` AND (
      q.title ILIKE ${sParam}
      OR q.category ILIKE ${sParam}
      OR q.summary ILIKE ${sParam}
      OR q.prompt ILIKE ${sParam}
      OR EXISTS (
        SELECT 1 FROM quiz_questions qq2
        WHERE qq2.quiz_id = q.id
          AND (qq2.question_text ILIKE ${sParam} OR qq2.explanation ILIKE ${sParam})
      )
    )`;
  }
  params.push(limit, offset);
  const sql = `
    SELECT
      q.id, q.title, q.slug, q.category, q.summary, q.difficulty,
      q.icon, q.color, q.prompt, q.is_solved, q.created_at, q.updated_at,
      COUNT(qq.id)::int AS question_count
    FROM quizzes q
    LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
    ${where}
    GROUP BY q.id
    ORDER BY q.created_at ASC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `;
  return query(sql, params, databaseUrl);
}

/**
 * Retrieve quiz by ID including all ordered questions (scoped by user).
 */
export async function getQuizById(id, { userId, databaseUrl } = {}) {
  if (!id) return null;
  const uId = toUserId(userId);
  const quizRows = await query('SELECT * FROM quizzes WHERE id = $1 AND user_id = $2', [id, uId], databaseUrl);
  if (!quizRows.length) return null;
  const quiz = quizRows[0];
  const questions = await query(
    'SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY question_number ASC',
    [id],
    databaseUrl
  );
  return { ...quiz, questions };
}

export async function setQuizSolvedStatus(id, isSolved = true, { userId, databaseUrl } = {}) {
  if (!id) return null;
  const uId = toUserId(userId);
  const rows = await query(
    'UPDATE quizzes SET is_solved = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *;',
    [Boolean(isSolved), id, uId],
    databaseUrl
  );
  return rows[0] || null;
}

/**
 * Insert a new quiz with its nested questions atomically.
 */
export async function createQuiz(quiz, questions = [], { databaseUrl } = {}) {
  const qList = Array.isArray(questions) && questions.length > 0
    ? questions
    : (Array.isArray(quiz?.questions) ? quiz.questions : []);
  const pool = getPool(databaseUrl || quiz?.databaseUrl);
  if (!pool) return null;
  const client = await pool.connect();
  try {
    const dbUrl = databaseUrl || quiz?.databaseUrl;
    if (quiz.userId) {
      await ensureUserExists(quiz.userId, dbUrl);
    }
    await client.query('BEGIN');
    const qRes = await client.query(
      `INSERT INTO quizzes (id, user_id, conversation_id, title, slug, category, summary, difficulty, icon, color, prompt, is_published, is_solved)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *;`,
      [
        quiz.id || null,
        quiz.userId ? toUserId(quiz.userId) : null,
        quiz.conversationId || null,
        quiz.title,
        quiz.slug || null,
        quiz.category || 'Umum',
        quiz.summary || '',
        quiz.difficulty || 'medium',
        quiz.icon || 'bulb',
        quiz.color || 'blue',
        quiz.prompt || '',
        quiz.isPublished ?? true,
        Boolean(quiz.isSolved ?? quiz.is_solved ?? false),
      ]
    );
    const newQuiz = qRes.rows[0];
    const insertedQuestions = [];
    for (let i = 0; i < qList.length; i++) {
      const q = qList[i];
      const rawOptions = Array.isArray(q.options) ? q.options : [];
      const normalizedOptions = rawOptions.map((opt, idx) => {
        if (opt && typeof opt === 'object' && typeof opt.text === 'string') {
          return { id: typeof opt.id === 'number' ? opt.id : idx, text: opt.text };
        }
        return { id: idx, text: String(opt || '') };
      });
      let ans = q.correctAnswer ?? q.correct_answer ?? 0;
      if (typeof ans === 'string' && /^[A-Za-z]$/.test(ans.trim())) {
        const charIdx = ans.trim().toUpperCase().charCodeAt(0) - 65;
        if (charIdx >= 0 && charIdx < normalizedOptions.length) {
          ans = charIdx;
        }
      }
      ans = parseInt(ans, 10);
      if (isNaN(ans) || ans < 0 || ans >= (normalizedOptions.length || 1)) ans = 0;

      const qqRes = await client.query(
        `INSERT INTO quiz_questions (quiz_id, question_number, question_text, question_type, options, correct_answer, explanation, points, is_solved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *;`,
        [
          newQuiz.id,
          q.questionNumber || q.question_number || i + 1,
          q.questionText || q.question_text,
          q.questionType || q.question_type || 'multiple_choice',
          JSON.stringify(normalizedOptions),
          String(ans),
          q.explanation || '',
          q.points ?? 10,
          Boolean(q.isSolved ?? q.is_solved ?? false),
        ]
      );
      insertedQuestions.push(qqRes.rows[0]);
    }
    await client.query('COMMIT');
    return { ...newQuiz, questions: insertedQuestions };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieve list of learning materials with section count aggregation for a specific user.
 */
export async function getMaterials({ userId, search, query: qSearch, category, limit = 50, offset = 0, databaseUrl } = {}) {
  const uId = toUserId(userId);
  const params = [uId];
  let where = 'WHERE m.is_published = true AND m.user_id = $1';
  if (category) {
    params.push(category);
    where += ` AND m.category = $${params.length}`;
  }
  const searchQuery = (search || qSearch || '').trim();
  if (searchQuery) {
    params.push(`%${searchQuery}%`);
    const sParam = `$${params.length}`;
    where += ` AND (
      m.title ILIKE ${sParam}
      OR m.category ILIKE ${sParam}
      OR m.summary ILIKE ${sParam}
      OR m.prompt ILIKE ${sParam}
      OR EXISTS (
        SELECT 1 FROM material_sections ms2
        WHERE ms2.material_id = m.id
          AND (ms2.title ILIKE ${sParam} OR ms2.content ILIKE ${sParam})
      )
    )`;
  }
  params.push(limit, offset);
  const sql = `
    SELECT
      m.id, m.title, m.slug, m.category, m.summary, m.estimated_read_time,
      m.difficulty, m.icon, m.color, m.prompt, m.is_solved, m.is_completed,
      m.created_at, m.updated_at,
      COUNT(ms.id)::int AS section_count,
      COUNT(ms.id)::int AS part_count
    FROM materials m
    LEFT JOIN material_sections ms ON ms.material_id = m.id
    ${where}
    GROUP BY m.id
    ORDER BY m.created_at ASC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `;
  return query(sql, params, databaseUrl);
}

/**
 * Retrieve learning material by ID including all ordered sections (scoped by user).
 */
export async function getMaterialById(id, { userId, databaseUrl } = {}) {
  if (!id) return null;
  const uId = toUserId(userId);
  const matRows = await query('SELECT * FROM materials WHERE id = $1 AND user_id = $2', [id, uId], databaseUrl);
  if (!matRows.length) return null;
  const material = matRows[0];
  const sections = await query(
    'SELECT * FROM material_sections WHERE material_id = $1 ORDER BY section_number ASC',
    [id],
    databaseUrl
  );
  return { ...material, sections };
}

/**
 * Update the is_solved / is_completed status of a material (scoped by user).
 */
export async function setMaterialSolvedStatus(id, isSolved = true, { userId, databaseUrl } = {}) {
  if (!id) return null;
  const uId = toUserId(userId);
  const val = Boolean(isSolved);
  const rows = await query(
    'UPDATE materials SET is_solved = $1, is_completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *;',
    [val, id, uId],
    databaseUrl
  );
  return rows[0] || null;
}

/**
 * Insert a new material with its nested sections atomically.
 */
export async function createMaterial(material, sections = [], { databaseUrl } = {}) {
  const sList = Array.isArray(sections) && sections.length > 0
    ? sections
    : (Array.isArray(material?.sections) ? material.sections : []);
  const pool = getPool(databaseUrl || material?.databaseUrl);
  if (!pool) return null;
  const client = await pool.connect();
  try {
    const dbUrl = databaseUrl || material?.databaseUrl;
    if (material.userId) {
      await ensureUserExists(material.userId, dbUrl);
    }
    await client.query('BEGIN');
    const isSolvedVal = Boolean(material.isSolved ?? material.is_solved ?? material.isCompleted ?? material.is_completed ?? false);
    const mRes = await client.query(
      `INSERT INTO materials (id, user_id, conversation_id, title, slug, category, summary, estimated_read_time, difficulty, icon, color, prompt, is_published, is_solved, is_completed)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *;`,
      [
        material.id || null,
        material.userId ? toUserId(material.userId) : null,
        material.conversationId || null,
        material.title,
        material.slug || null,
        material.category || 'Umum',
        material.summary || '',
        material.estimatedReadTime || material.estimated_read_time || 5,
        material.difficulty || 'beginner',
        material.icon || 'book',
        material.color || 'green',
        material.prompt || '',
        material.isPublished ?? true,
        isSolvedVal,
        isSolvedVal,
      ]
    );
    const newMat = mRes.rows[0];
    const insertedSections = [];
    for (let i = 0; i < sList.length; i++) {
      const s = sList[i];
      const sRes = await client.query(
        `INSERT INTO material_sections (material_id, section_number, title, content, read_time_minutes, is_completed)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *;`,
        [
          newMat.id,
          s.sectionNumber || s.section_number || i + 1,
          s.title,
          s.content,
          s.readTimeMinutes || s.read_time_minutes || 2,
          Boolean(s.isCompleted ?? s.is_completed ?? false),
        ]
      );
      insertedSections.push(sRes.rows[0]);
    }
    await client.query('COMMIT');
    return { ...newMat, sections: insertedSections };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
