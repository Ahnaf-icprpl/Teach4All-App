export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const CHAT_API_URL = './api/chat';
export const TITLE_API_URL = './api/title';
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
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.conversationTitle ? { conversationTitle: options.conversationTitle } : {}),
      ...(options.userMessageId ? { userMessageId: options.userMessageId } : {}),
      ...(options.assistantMessageId ? { assistantMessageId: options.assistantMessageId } : {}),
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
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
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
