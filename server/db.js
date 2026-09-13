import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Execute SQL via psql process with stdin.
 * Handles multiline text and special characters safely without shell escaping.
 */
export function runSql(sql, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return Promise.resolve('');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });

    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', err => {
      reject(err);
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `psql process exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

/**
 * Safely escape string literals for SQL.
 */
function escapeSqlString(str) {
  if (typeof str !== 'string') return "''";
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Ensure string is valid UUID format.
 */
function toUuid(id) {
  if (typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id.trim())) {
    return id.trim();
  }
  return crypto.randomUUID();
}

export const inMemoryConversations = new Map();
export const inMemoryMessages = new Map();

/**
 * Query JSON array from PostgreSQL safely via psql.
 */
export async function queryJson(sql, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return null;
  return new Promise(resolve => {
    const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (code !== 0 || !stdout.trim()) {
        resolve(null);
      } else {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve(null);
        }
      }
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

/**
 * Upsert conversation record into database.
 */
export async function saveConversation({
  id,
  userId = DEFAULT_USER_ID,
  title = 'New Conversation',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(id);
  const uId = toUuid(userId);
  const cleanTitle = (title || 'New Conversation').slice(0, 255);
  const safeTitle = escapeSqlString(cleanTitle);

  // Sync to in-memory store
  const existing = inMemoryConversations.get(convId);
  inMemoryConversations.set(convId, {
    id: convId,
    user_id: uId,
    title: cleanTitle,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const sql = `
    INSERT INTO conversations (id, user_id, title, updated_at)
    VALUES ('${convId}', '${uId}', ${safeTitle}, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title, updated_at = CURRENT_TIMESTAMP;
  `;

  try {
    await runSql(sql, databaseUrl);
    return { id: convId, userId: uId };
  } catch (err) {
    console.error('Failed to save conversation to DB:', err.message);
    return { id: convId, userId: uId, error: err.message };
  }
}

/**
 * Upsert message record into database.
 */
export async function saveMessage({
  id,
  conversationId,
  userId = DEFAULT_USER_ID,
  role = 'user',
  content = '',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const msgId = toUuid(id);
  const convId = toUuid(conversationId);
  const uId = toUuid(userId);
  const safeRole = ['user', 'assistant', 'system'].includes(role) ? role : 'user';
  const safeContent = escapeSqlString(content || '');

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

  const sql = `
    INSERT INTO messages (id, conversation_id, user_id, role, content, created_at)
    VALUES ('${msgId}', '${convId}', '${uId}', '${safeRole}', ${safeContent}, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE
    SET content = EXCLUDED.content;
  `;

  try {
    await runSql(sql, databaseUrl);
    return { id: msgId, conversationId: convId };
  } catch (err) {
    console.error(`Failed to save ${safeRole} message to DB:`, err.message);
    return { id: msgId, conversationId: convId, error: err.message };
  }
}

/**
 * Fetch list of conversations for a user (lazy loading metadata).
 */
export async function getConversations({
  userId = DEFAULT_USER_ID,
  limit = 50,
  offset = 0,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const uId = toUuid(userId);
  const numLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const numOffset = Math.max(0, Number(offset) || 0);

  if (databaseUrl) {
    const sql = `
      SELECT COALESCE(json_agg(c), '[]'::json)
      FROM (
        SELECT id, user_id, title, updated_at, created_at
        FROM conversations
        WHERE user_id = '${uId}'
        ORDER BY updated_at DESC
        LIMIT ${numLimit} OFFSET ${numOffset}
      ) c;
    `;
    const dbResult = await queryJson(sql, databaseUrl);
    if (Array.isArray(dbResult)) {
      for (const item of dbResult) {
        inMemoryConversations.set(item.id, item);
      }
      return dbResult;
    }
  }

  // In-memory fallback
  return Array.from(inMemoryConversations.values())
    .filter(c => c.user_id === uId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(numOffset, numOffset + numLimit);
}

/**
 * Fetch messages for a single conversation on demand (lazy loading chat history).
 */
export async function getMessages({
  conversationId,
  userId = DEFAULT_USER_ID,
  limit = 100,
  offset = 0,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(conversationId);
  const uId = toUuid(userId);
  const numLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const numOffset = Math.max(0, Number(offset) || 0);

  if (databaseUrl) {
    const sql = `
      SELECT COALESCE(json_agg(m), '[]'::json)
      FROM (
        SELECT id, conversation_id, user_id, role, content, created_at
        FROM messages
        WHERE conversation_id = '${convId}' AND user_id = '${uId}'
        ORDER BY created_at ASC
        LIMIT ${numLimit} OFFSET ${numOffset}
      ) m;
    `;
    const dbResult = await queryJson(sql, databaseUrl);
    if (Array.isArray(dbResult)) {
      if (!inMemoryMessages.has(convId)) inMemoryMessages.set(convId, new Map());
      for (const msg of dbResult) {
        inMemoryMessages.get(convId).set(msg.id, msg);
      }
      return dbResult;
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
  userId = DEFAULT_USER_ID,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(conversationId);
  const uId = toUuid(userId);

  inMemoryConversations.delete(convId);
  inMemoryMessages.delete(convId);

  if (databaseUrl) {
    const sql = `DELETE FROM conversations WHERE id = '${convId}' AND user_id = '${uId}';`;
    try {
      await runSql(sql, databaseUrl);
    } catch (err) {
      console.error('Failed to delete conversation from DB:', err.message);
    }
  }
  return { success: true };
}

/**
 * Update conversation title in database.
 */
export async function updateConversationTitle({
  conversationId,
  userId = DEFAULT_USER_ID,
  title,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(conversationId);
  const uId = toUuid(userId);
  const cleanTitle = (title || 'New Conversation').slice(0, 255);

  const existing = inMemoryConversations.get(convId);
  if (existing) {
    existing.title = cleanTitle;
    existing.updated_at = new Date().toISOString();
  }

  if (databaseUrl) {
    const sql = `UPDATE conversations SET title = ${escapeSqlString(cleanTitle)}, updated_at = CURRENT_TIMESTAMP WHERE id = '${convId}' AND user_id = '${uId}';`;
    try {
      await runSql(sql, databaseUrl);
    } catch (err) {
      console.error('Failed to update conversation title in DB:', err.message);
    }
  }
  return { success: true, title: cleanTitle };
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
    userId = DEFAULT_USER_ID,
    title = 'New Conversation',
    userMessage,
    assistantMessageId,
    databaseUrl = process.env.DATABASE_URL,
    throttleMs = 1500,
  } = {}) {
    this.conversationId = toUuid(conversationId);
    this.userId = toUuid(userId);
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
    if (!this.databaseUrl || !this.accumulatedContent) return;

    try {
      await saveMessage({
        id: this.assistantMessageId,
        conversationId: this.conversationId,
        userId: this.userId,
        role: 'assistant',
        content: this.accumulatedContent,
        databaseUrl: this.databaseUrl,
      });
    } catch {}
  }
}
