import crypto from 'node:crypto';
import {
  toUuid,
  toUserId,
  ensureUserExists,
  getPool,
  inMemoryConversations,
  inMemoryMessages,
} from './dbCore.js';

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
      SET conversation_id = EXCLUDED.conversation_id,
          user_id = EXCLUDED.user_id,
          role = EXCLUDED.role,
          content = EXCLUDED.content;
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

export { ConversationStreamWriter } from './conversationStreamWriter.js';
