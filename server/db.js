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
  const safeTitle = escapeSqlString((title || 'New Conversation').slice(0, 255));

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
    // Non-fatal: log and return
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
