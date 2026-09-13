export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const CHAT_API_URL = './api/chat';
export const TITLE_API_URL = './api/title';
export const CONVERSATIONS_API_URL = './api/conversations';
export const MESSAGES_API_URL = './api/messages';
export const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
export const TIMEOUT_MS = 35000;
import { cleanTitle, generateOfflineTitle, formatTitleMessages, TITLE_SYSTEM_PROMPT } from './prompts/titlePrompt.js';
export { cleanTitle, generateOfflineTitle, formatTitleMessages, TITLE_SYSTEM_PROMPT };

export function getModel() {
  return DEFAULT_MODEL;
}

export function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export async function sendMessage(messages, onChunk, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages are required.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const payload = {
      messages,
      userId: options.userId || TEST_USER_ID,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.conversationTitle ? { conversationTitle: options.conversationTitle } : {}),
      ...(options.userMessageId ? { userMessageId: options.userMessageId } : {}),
      ...(options.assistantMessageId ? { assistantMessageId: options.assistantMessageId } : {}),
      ...(options.webSearch !== undefined ? { webSearch: options.webSearch } : {}),
    };

    const response = await fetch(CHAT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let serverMessage = '';
      try {
        const errorJson = await response.json();
        serverMessage = errorJson?.error?.message || '';
      } catch {
        try {
          const rawText = await response.text();
          serverMessage = rawText.slice(0, 150);
        } catch {}
      }

      throw new Error(serverMessage || `Server error (${response.status})`);
    }

    if (!response.body) {
      throw new Error('No response received from server.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          if (json.type === 'quiz_status' && json.status === 'building') {
            if (typeof options.onStatus === 'function') {
              options.onStatus('building_quiz');
            }
            continue;
          }
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (typeof onChunk === 'function') {
              onChunk(fullText);
            }
          }
        } catch {
          // Ignore partial or unparseable JSON
        }
      }
    }

    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6);
      if (data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (typeof onChunk === 'function') {
              onChunk(fullText);
            }
          }
        } catch {}
      }
    }

    return fullText;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw error;
  }
}

export async function generateTitle(messages, options = {}) {
  const firstUserMsg = Array.isArray(messages) ? messages.find(m => m && m.role === 'user') : null;
  const rawText = firstUserMsg ? (firstUserMsg.text || firstUserMsg.content || '') : '';
  const fallbackTitle = generateOfflineTitle(rawText);

  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return fallbackTitle;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const payload = {
      messages,
      userId: options.userId || TEST_USER_ID,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    };

    const response = await fetch(TITLE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return fallbackTitle;
    }

    const data = await response.json();
    return cleanTitle(data?.title, fallbackTitle);
  } catch {
    return fallbackTitle;
  }
}

export async function fetchConversations({ userId = TEST_USER_ID, limit = 20, offset = 0, query = '' } = {}) {
  let url = `${CONVERSATIONS_API_URL}?userId=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`;
  if (query && typeof query === 'string' && query.trim()) {
    url += `&q=${encodeURIComponent(query.trim())}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch conversations (${response.status})`);
  }
  return response.json();
}

export async function searchConversationsApi(query, { userId = TEST_USER_ID, limit = 50, offset = 0 } = {}) {
  return fetchConversations({ userId, limit, offset, query });
}

export async function fetchMessages(conversationId, { userId = TEST_USER_ID, limit = 100, offset = 0 } = {}) {
  const url = `${MESSAGES_API_URL}?conversationId=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch messages (${response.status})`);
  }
  return response.json();
}

export async function deleteConversationApi(conversationId, { userId = TEST_USER_ID } = {}) {
  const url = `${CONVERSATIONS_API_URL}?id=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}`;
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Failed to delete conversation (${response.status})`);
  }
  return response.json();
}

export async function renameConversationApi(conversationId, title, { userId = TEST_USER_ID } = {}) {
  const response = await fetch(CONVERSATIONS_API_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: conversationId, title, userId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to rename conversation (${response.status})`);
  }
  return response.json();
}
