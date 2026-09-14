import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const pools = new Map();

/**
 * Configure SSL based on database connection string and environment.
 */
export function getSslConfig(connectionString) {
  if (!connectionString) return false;
  const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  if (isLocalhost && !connectionString.includes('sslmode=require')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

/**
 * Retrieve or instantiate a connection pool for the specified databaseUrl.
 */
export function getPool(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return null;
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: getSslConfig(databaseUrl),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true,
    });

    pool.on('error', () => {});

    pools.set(databaseUrl, pool);
  }
  return pool;
}

/**
 * Cleanly close all active PostgreSQL pools.
 */
export async function closePools() {
  for (const pool of pools.values()) {
    try {
      await pool.end();
    } catch {}
  }
  pools.clear();
}

/**
 * Execute parameterized query returning rows directly.
 */
export async function query(sql, params = [], databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return [];
  const pool = getPool(databaseUrl);
  if (!pool) return [];
  const res = await pool.query(sql, params);
  return res.rows || [];
}

/**
 * Execute SQL via pg driver.
 * Returns stringified rows or formatted output for compatibility with stdout inspections.
 */
export async function runSql(sql, databaseUrl = process.env.DATABASE_URL, params = []) {
  if (!databaseUrl) return '';
  const pool = getPool(databaseUrl);
  if (!pool) return '';

  const res = params && params.length > 0 ? await pool.query(sql, params) : await pool.query(sql);
  if (Array.isArray(res)) {
    return res.map(r => JSON.stringify(r.rows || [])).join('\n');
  }
  if (res && res.rows && res.rows.length > 0) {
    return JSON.stringify(res.rows);
  }
  return '';
}

/**
 * Safely escape string literals for SQL (kept for utility compatibility).
 */
export function escapeSqlString(str) {
  if (typeof str !== 'string') return "''";
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Ensure string is valid UUID format.
 */
export function toUuid(id) {
  if (typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id.trim())) {
    return id.trim();
  }
  return crypto.randomUUID();
}

/**
 * Normalize and validate user ID (supports Clerk user IDs and guest UUIDs).
 */
export function toUserId(id) {
  if (typeof id === 'string' && id.trim()) {
    return id.trim();
  }
  return null;
}

/**
 * Ensure a user record exists in the database.
 */
export async function ensureUserExists(userId, databaseUrl = process.env.DATABASE_URL) {
  const uId = toUserId(userId);
  if (!uId || !databaseUrl) return;
  const pool = getPool(databaseUrl);
  if (!pool) return;
  try {
    const username = uId.startsWith('guest_') ? 'teach4all_guest' : 'teach4all_user';
    await pool.query(
      `INSERT INTO users (id, username, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO NOTHING;`,
      [uId, username]
    );
  } catch {}
}

/**
 * Upsert Clerk user profile info into the database users table.
 */
export async function syncUserToDb(user = {}, databaseUrl = process.env.DATABASE_URL) {
  const userId = typeof user?.id === 'string' ? user.id.trim() : null;
  if (!userId || !databaseUrl) return null;
  const pool = getPool(databaseUrl);
  if (!pool) return null;

  const sql = `
    INSERT INTO users (id, email, name, first_name, last_name, avatar_url, username, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      name = COALESCE(EXCLUDED.name, users.name),
      first_name = COALESCE(EXCLUDED.first_name, users.first_name),
      last_name = COALESCE(EXCLUDED.last_name, users.last_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
      username = COALESCE(EXCLUDED.username, users.username),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;

  try {
    const res = await pool.query(sql, [
      userId,
      user.email || null,
      user.name || null,
      user.firstName || user.first_name || null,
      user.lastName || user.last_name || null,
      user.avatarUrl || user.avatar_url || null,
      user.username || null,
    ]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('Failed to sync user to database:', err.message);
    return null;
  }
}

export const inMemoryConversations = new Map();
export const inMemoryMessages = new Map();

/**
 * Query JSON from PostgreSQL safely via pg driver.
 */
export async function queryJson(sql, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return null;
  const pool = getPool(databaseUrl);
  if (!pool) return null;
  try {
    const res = await pool.query(sql);
    if (!res || !res.rows || res.rows.length === 0) return null;
    const firstRow = res.rows[0];
    const firstKey = Object.keys(firstRow)[0];
    const val = firstRow[firstKey];
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  } catch {
    return null;
  }
}

/**
 * Upsert conversation record into database.
 */
export async function saveConversation({
  id,
  userId,
  title = 'New Conversation',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(id);
  const uId = toUserId(userId);
  const cleanTitle = (title || 'New Conversation').slice(0, 255);

  // Sync to in-memory store
  const existing = inMemoryConversations.get(convId);
  inMemoryConversations.set(convId, {
    id: convId,
    user_id: uId,
    title: cleanTitle,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (databaseUrl) {
    await ensureUserExists(uId, databaseUrl);
    const sql = `
      INSERT INTO conversations (id, user_id, title, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title, updated_at = CURRENT_TIMESTAMP;
    `;
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [convId, uId, cleanTitle]);
      }
      return { id: convId, userId: uId };
    } catch (err) {
      return { id: convId, userId: uId, error: err.message };
    }
  }

  return { id: convId, userId: uId };
}

/**
 * Upsert message record into database.
 */
export async function saveMessage({
  id,
  conversationId,
  userId,
  role = 'user',
  content = '',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const msgId = toUuid(id);
  const convId = toUuid(conversationId);
  const uId = toUserId(userId);
  const safeRole = ['user', 'assistant', 'system'].includes(role) ? role : 'user';

  // Sync to in-memory store
  if (!inMemoryMessages.has(convId)) inMemoryMessages.set(convId, new Map());
  const existing = inMemoryMessages.get(convId).get(msgId);
  inMemoryMessages.get(convId).set(msgId, {
    id: msgId,
    conversation_id: convId,
    user_id: uId,
    role: safeRole,
    content: content || '',
    created_at: existing?.created_at || new Date().toISOString(),
  });
  const inMemConv = inMemoryConversations.get(convId);
  if (inMemConv) {
    inMemConv.updated_at = new Date().toISOString();
  }

  if (databaseUrl) {
    await ensureUserExists(uId, databaseUrl);
    const sql = `
      INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE
      SET content = EXCLUDED.content;
    `;
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [msgId, convId, uId, safeRole, content || '']);
        await pool.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1;', [convId]);
      }
      return { id: msgId, conversationId: convId };
    } catch (err) {
      return { id: msgId, conversationId: convId, error: err.message };
    }
  }

  return { id: msgId, conversationId: convId };
}

/**
 * Fetch list of conversations for a user (lazy loading metadata).
 */
export async function getConversations({
  userId,
  limit = 50,
  offset = 0,
  query = '',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const uId = toUserId(userId);
  const numLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const numOffset = Math.max(0, Number(offset) || 0);
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';

  if (databaseUrl) {
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        let sql;
        let params;
        if (trimmedQuery) {
          sql = `
            SELECT c.id, c.user_id, c.title,
              GREATEST(c.updated_at, c.created_at, COALESCE((SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = c.id), c.updated_at)) AS updated_at,
              c.created_at
            FROM conversations c
            WHERE c.user_id = $1
              AND (
                c.title ILIKE $2
                OR EXISTS (
                  SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE $2
                )
              )
            ORDER BY GREATEST(c.updated_at, c.created_at, COALESCE((SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.conversation_id = c.id), c.updated_at)) DESC
            LIMIT $3 OFFSET $4;
          `;
          params = [uId, `%${trimmedQuery}%`, numLimit, numOffset];
        } else {
          sql = `
            SELECT c.id, c.user_id, c.title,
              GREATEST(c.updated_at, c.created_at, COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.updated_at)) AS updated_at,
              c.created_at
            FROM conversations c
            WHERE c.user_id = $1
            ORDER BY GREATEST(c.updated_at, c.created_at, COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.updated_at)) DESC
            LIMIT $2 OFFSET $3;
          `;
          params = [uId, numLimit, numOffset];
        }
        const res = await pool.query(sql, params);
        const rows = res.rows || [];
        for (const item of rows) {
          inMemoryConversations.set(item.id, item);
        }
        return rows;
      }
    } catch {
      // ignore
    }
  }

  // In-memory fallback
  let list = Array.from(inMemoryConversations.values()).filter(c => c.user_id === uId);
  if (trimmedQuery) {
    const qLower = trimmedQuery.toLowerCase();
    list = list.filter(c => {
      if (c.title && c.title.toLowerCase().includes(qLower)) return true;
      const msgs = inMemoryMessages.get(c.id);
      if (msgs) {
        for (const m of msgs.values()) {
          if (m.content && m.content.toLowerCase().includes(qLower)) return true;
        }
      }
      return false;
    });
  }

  const getLatestInteractionTime = (c) => {
    let t = new Date(c.updated_at || c.created_at || 0).getTime();
    const msgs = inMemoryMessages.get(c.id);
    if (msgs) {
      for (const m of msgs.values()) {
        const mt = new Date(m.created_at || 0).getTime();
        if (mt > t) t = mt;
      }
    }
    return t;
  };

  return list
    .sort((a, b) => getLatestInteractionTime(b) - getLatestInteractionTime(a))
    .slice(numOffset, numOffset + numLimit);
}

/**
 * Fetch messages for a single conversation on demand (lazy loading chat history).
 */
export async function getMessages({
  conversationId,
  userId,
  limit = 100,
  offset = 0,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(conversationId);
  const uId = toUserId(userId);
  const numLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const numOffset = Math.max(0, Number(offset) || 0);

  if (databaseUrl) {
    try {
      const sql = `
        SELECT id, conversation_id, user_id, role, content, created_at
        FROM messages
        WHERE conversation_id = $1 AND user_id = $2
        ORDER BY created_at ASC
        LIMIT $3 OFFSET $4;
      `;
      const pool = getPool(databaseUrl);
      if (pool) {
        const res = await pool.query(sql, [convId, uId, numLimit, numOffset]);
        const rows = res.rows || [];
        if (!inMemoryMessages.has(convId)) inMemoryMessages.set(convId, new Map());
        for (const msg of rows) {
          inMemoryMessages.get(convId).set(msg.id, msg);
        }
        return rows;
      }
    } catch {
      // ignore
    }
  }

  // In-memory fallback
  const convMap = inMemoryMessages.get(convId);
  if (!convMap) return [];
  return Array.from(convMap.values())
    .filter(m => m.user_id === uId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(numOffset, numOffset + numLimit);
}

/**
 * Delete a conversation and its messages.
 */
export async function deleteConversation({
  conversationId,
  userId,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(conversationId);
  const uId = toUserId(userId);

  inMemoryConversations.delete(convId);
  inMemoryMessages.delete(convId);

  if (databaseUrl) {
    const sql = `DELETE FROM conversations WHERE id = $1 AND user_id = $2;`;
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [convId, uId]);
      }
    } catch {
      // ignore
    }
  }
  return { success: true };
}

/**
 * Update conversation title in database.
 */
export async function updateConversationTitle({
  conversationId,
  userId,
  title,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(conversationId);
  const uId = toUserId(userId);
  const cleanTitle = (title || 'New Conversation').slice(0, 255);

  const existing = inMemoryConversations.get(convId);
  if (existing) {
    existing.title = cleanTitle;
    existing.updated_at = new Date().toISOString();
  }

  if (databaseUrl) {
    const sql = `UPDATE conversations SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3;`;
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [cleanTitle, convId, uId]);
      }
    } catch {
      // ignore
    }
  }
  return { success: true, title: cleanTitle };
}

/**
 * Delete a specific message by ID from database and memory.
 */
export async function deleteMessage(id, { databaseUrl = process.env.DATABASE_URL } = {}) {
  const msgId = toUuid(id);
  if (!msgId) return { success: false };

  for (const convMap of inMemoryMessages.values()) {
    if (convMap.has(msgId)) {
      convMap.delete(msgId);
      break;
    }
  }

  if (databaseUrl) {
    try {
      const sql = `DELETE FROM messages WHERE id = $1;`;
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [msgId]);
      }
    } catch {
      // ignore
    }
  }
  return { success: true };
}

/**
 * Manages streaming conversation persistence to PostgreSQL.
 *
 * Characteristics:
 * - Persists conversation and user message at start.
 * - Streams assistant tokens: throttles periodic updates during generation.
 * - Guarantees final atomic write on stream completion or client abort.
 * - Completely non-blocking: never delays HTTP SSE stream chunks.
 */
export class ConversationStreamWriter {
  constructor({
    conversationId,
    userId,
    title = 'New Conversation',
    userMessage,
    assistantMessageId,
    databaseUrl = process.env.DATABASE_URL,
    throttleMs = 1500,
  } = {}) {
    this.conversationId = toUuid(conversationId);
    this.userId = toUserId(userId);
    this.title = title;
    this.userMessage = userMessage;
    this.assistantMessageId = toUuid(assistantMessageId);
    this.databaseUrl = databaseUrl;
    this.throttleMs = throttleMs;

    this.accumulatedContent = '';
    this.lastWrittenContent = '';
    this.lastWriteTime = 0;
    this.writing = false;
    this.pendingFlush = false;
    this.finished = false;
  }

  /**
   * Initialize conversation and user message in DB.
   */
  async init() {
    if (!this.databaseUrl) return;

    // 1. Ensure conversation exists
    await saveConversation({
      id: this.conversationId,
      userId: this.userId,
      title: this.title,
      databaseUrl: this.databaseUrl,
    });

    // 2. Persist user message if provided
    if (this.userMessage && this.userMessage.text) {
      await saveMessage({
        id: this.userMessage.id || crypto.randomUUID(),
        conversationId: this.conversationId,
        userId: this.userId,
        role: this.userMessage.role || 'user',
        content: this.userMessage.text,
        databaseUrl: this.databaseUrl,
      });
    }

    // 3. Create initial empty assistant message placeholder
    await saveMessage({
      id: this.assistantMessageId,
      conversationId: this.conversationId,
      userId: this.userId,
      role: 'assistant',
      content: '',
      databaseUrl: this.databaseUrl,
    });
  }

  /**
   * Called on every SSE token chunk received.
   */
  writeChunk(chunkText) {
    if (this.finished || !chunkText) return;
    this.accumulatedContent += chunkText;

    const now = Date.now();
    if (now - this.lastWriteTime >= this.throttleMs && !this.writing) {
      this._flushToDb();
    } else {
      this.pendingFlush = true;
    }
  }

  /**
   * Internal async flush to database.
   */
  async _flushToDb() {
    if (!this.databaseUrl || this.writing) return;
    const contentToWrite = this.accumulatedContent;
    if (contentToWrite === this.lastWrittenContent) {
      this.pendingFlush = false;
      return;
    }

    this.writing = true;
    this.lastWriteTime = Date.now();

    try {
      await saveMessage({
        id: this.assistantMessageId,
        conversationId: this.conversationId,
        userId: this.userId,
        role: 'assistant',
        content: contentToWrite,
        databaseUrl: this.databaseUrl,
      });
      this.lastWrittenContent = contentToWrite;
    } catch {
      // ignore transient db errors during live streaming
    } finally {
      this.writing = false;
      if (this.pendingFlush && !this.finished) {
        this.pendingFlush = false;
        // Schedule next throttled flush if pending
        setTimeout(() => this._flushToDb(), this.throttleMs).unref?.();
      }
    }
  }

  /**
   * Called when stream finishes successfully.
   */
  async finish(finalContent) {
    this.finished = true;
    const text = finalContent !== undefined ? finalContent : this.accumulatedContent;
    this.accumulatedContent = text;

    if (!this.databaseUrl) return;

    // Final definitive write
    await saveMessage({
      id: this.assistantMessageId,
      conversationId: this.conversationId,
      userId: this.userId,
      role: 'assistant',
      content: text,
      databaseUrl: this.databaseUrl,
    });
    this.lastWrittenContent = text;
  }

  /**
   * Called if connection aborts or is interrupted.
   */
  async abort() {
    this.finished = true;
    if (!this.databaseUrl) return;

    try {
      if (this.accumulatedContent) {
        await saveMessage({
          id: this.assistantMessageId,
          conversationId: this.conversationId,
          userId: this.userId,
          role: 'assistant',
          content: this.accumulatedContent,
          databaseUrl: this.databaseUrl,
        });
      } else {
        await deleteMessage(this.assistantMessageId, { databaseUrl: this.databaseUrl });
      }
    } catch {}
  }
}

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

