import crypto from 'node:crypto';
import { toUuid, toUserId } from './dbCore.js';
import { saveConversation, saveMessage, deleteMessage } from './dbConversations.js';

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
