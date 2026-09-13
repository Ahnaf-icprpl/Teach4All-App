import crypto from 'node:crypto';
import pg from 'pg';
import { logger } from './logger.js';

const { Pool } = pg;

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

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

    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client:', err.message);
    });

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
  userId = DEFAULT_USER_ID,
  title = 'New Conversation',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const convId = toUuid(id);
  const uId = toUuid(userId);
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
      logger.error('Failed to save conversation to DB', { conversation_id: convId, error: err.message });
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
  userId = DEFAULT_USER_ID,
  role = 'user',
  content = '',
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const msgId = toUuid(id);
  const convId = toUuid(conversationId);
  const uId = toUuid(userId);
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

  if (databaseUrl) {
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
      }
      return { id: msgId, conversationId: convId };
    } catch (err) {
      logger.error(`Failed to save ${safeRole} message to DB`, { message_id: msgId, conversation_id: convId, error: err.message });
      return { id: msgId, conversationId: convId, error: err.message };
    }
  }

  return { id: msgId, conversationId: convId };
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
    try {
      const sql = `
        SELECT id, user_id, title, updated_at, created_at
        FROM conversations
        WHERE user_id = $1
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3;
      `;
      const pool = getPool(databaseUrl);
      if (pool) {
        const res = await pool.query(sql, [uId, numLimit, numOffset]);
        const rows = res.rows || [];
        for (const item of rows) {
          inMemoryConversations.set(item.id, item);
        }
        return rows;
      }
    } catch (err) {
      console.error('Failed to get conversations from DB:', err.message);
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
    } catch (err) {
      console.error('Failed to get messages from DB:', err.message);
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
    const sql = `DELETE FROM conversations WHERE id = $1 AND user_id = $2;`;
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [convId, uId]);
      }
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
    const sql = `UPDATE conversations SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3;`;
    try {
      const pool = getPool(databaseUrl);
      if (pool) {
        await pool.query(sql, [cleanTitle, convId, uId]);
      }
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
