export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const CHAT_API_URL = './api/chat';
export const CHAT_STATUS_API_URL = './api/chat/status';
export const CHAT_STREAM_API_URL = './api/chat/stream';
export const TITLE_API_URL = './api/title';
export const CONVERSATIONS_API_URL = './api/conversations';
export const MESSAGES_API_URL = './api/messages';
export const TIMEOUT_MS = 15 * 60 * 1000;
import { cleanTitle, generateOfflineTitle, formatTitleMessages, TITLE_SYSTEM_PROMPT } from './prompts/titlePrompt.js';
import { getEffectiveUserId, getAuthHeaders } from './auth.js';
import { t } from './uiTexts.js';
export { cleanTitle, generateOfflineTitle, formatTitleMessages, TITLE_SYSTEM_PROMPT, getEffectiveUserId, getAuthHeaders };

export function getModel() {
  return DEFAULT_MODEL;
}

export function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export async function readSseStream(responseBody, onChunk, options = {}, initialText = '') {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = initialText;

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
      if (data === '[DONE]') break;

      try {
        const json = JSON.parse(data);
        if (json.type === 'quiz_status' && json.status === 'building') {
          if (typeof options.onStatus === 'function') {
            options.onStatus('building_quiz');
          }
          continue;
        }
        if (json.type === 'material_status' && json.status === 'building') {
          if (typeof options.onStatus === 'function') {
            options.onStatus('building_material');
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
      } catch {}
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
}

export async function fetchChatStatus(conversationId) {
  if (!conversationId) return { active: false, status: 'none' };
  try {
    const res = await fetch(`${CHAT_STATUS_API_URL}?conversationId=${encodeURIComponent(conversationId)}`, {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) return { active: false, status: 'none' };
    return await res.json();
  } catch {
    return { active: false, status: 'none' };
  }
}

export async function subscribeToChatStream(conversationId, onChunk, options = {}) {
  if (!conversationId) return '';
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${CHAT_STREAM_API_URL}?conversationId=${encodeURIComponent(conversationId)}`, {
      headers: { ...getAuthHeaders() },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return '';
    return await readSseStream(res.body, onChunk, options, options.initialText || '');
  } catch (err) {
    if (err.name === 'AbortError') return '';
    throw err;
  }
}

export async function sendMessage(messages, onChunk, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages are required.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const payload = {
      messages,
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
        ...getAuthHeaders(),
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
      throw new Error(t('router_no_response'));
    }

    return await readSseStream(response.body, onChunk, options);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      if (options.signal?.aborted) {
        throw new Error(t('router_request_cancelled'));
      }
      throw new Error(t('router_request_timed_out'));
    }
    throw error;
  }
}

export async function generateTitle(messages, options = {}) {
  const firstUserMsg = Array.isArray(messages) ? messages.find(m => m && m.role === 'user') : null;
  const rawText = firstUserMsg ? (firstUserMsg.text || firstUserMsg.content || '') : '';
  const fallbackTitle = generateOfflineTitle(rawText);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const recentMessages = Array.isArray(messages)
      ? messages.slice(-4).map(m => ({ role: m.role, content: (m.content || m.text || '').trim() })).filter(m => m.content)
      : [];
    const payload = {
      messages: recentMessages,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    };

    const response = await fetch(TITLE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
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

export async function fetchConversations({ limit = 20, offset = 0, query = '' } = {}) {
  let url = `${CONVERSATIONS_API_URL}?limit=${limit}&offset=${offset}`;
  if (query && typeof query === 'string' && query.trim()) {
    url += `&q=${encodeURIComponent(query.trim())}`;
  }
  const response = await fetch(url, {
    headers: { ...getAuthHeaders() },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch conversations (${response.status})`);
  }
  return response.json();
}

export async function searchConversationsApi(query, { limit = 50, offset = 0 } = {}) {
  return fetchConversations({ limit, offset, query });
}

export async function fetchMessages(conversationId, { limit = 100, offset = 0 } = {}) {
  const url = `${MESSAGES_API_URL}?conversationId=${encodeURIComponent(conversationId)}&limit=${limit}&offset=${offset}`;
  const response = await fetch(url, {
    headers: { ...getAuthHeaders() },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch messages (${response.status})`);
  }
  return response.json();
}

export async function deleteConversationApi(conversationId) {
  const url = `${CONVERSATIONS_API_URL}?id=${encodeURIComponent(conversationId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete conversation (${response.status})`);
  }
  return response.json();
}

export async function renameConversationApi(conversationId, title) {
  const response = await fetch(CONVERSATIONS_API_URL, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ id: conversationId, title }),
  });
  if (!response.ok) {
    throw new Error(`Failed to rename conversation (${response.status})`);
  }
  return response.json();
}
