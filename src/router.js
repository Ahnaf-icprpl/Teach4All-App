function getEnv(key) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.env?.[key]) {
      return import.meta.env[key];
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process?.env?.[key]) {
      return process.env[key];
    }
  } catch {}
  return '';
}

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const STORAGE_KEY = 'teach4all.openrouter-key.v1';
export const TIMEOUT_MS = 35000;

export function getModel() {
  return getEnv('OPENROUTER_MODEL') || DEFAULT_MODEL;
}

export function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export function getApiKey(storage) {
  try {
    const storedKey = storage?.getItem(STORAGE_KEY) || '';
    if (storedKey.trim()) return storedKey.trim();
  } catch {}
  return getEnv('OPENROUTER_API_KEY') || '';
}

export function setApiKey(storage, key) {
  try {
    if (key && key.trim()) {
      storage?.setItem(STORAGE_KEY, key.trim());
    } else {
      storage?.removeItem(STORAGE_KEY);
    }
    return '';
  } catch {
    return 'Your browser is blocking storage access. The API key will not persist.';
  }
}

export async function sendMessage(messages, apiKey, onChunk) {
  const effectiveKey = (apiKey || getApiKey()).trim();

  if (!effectiveKey) {
    throw new Error('OpenRouter API key is required. Add it in Settings or configure your .env file.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const formattedMessages = [
    {
      role: 'system',
      content: 'You are Teach4All, an encouraging, accessible learning companion. Explain ideas clearly, provide intuitive examples, and help users learn step by step.',
    },
    ...messages
      .filter(m => m && m.text && m.text.trim())
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text.trim(),
      })),
  ];

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'http://localhost',
        'X-Title': 'Teach4All',
      },
      body: JSON.stringify({
        model: getModel(),
        messages: formattedMessages,
        stream: true,
      }),
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

      if (response.status === 401) {
        if (isPlaceholderKey(effectiveKey)) {
          throw new Error('Placeholder API key in use. Please enter your actual OpenRouter API key in Settings or .env.');
        }
        throw new Error(serverMessage ? `OpenRouter authentication error: ${serverMessage}` : 'Invalid OpenRouter API key. Check Settings or .env file.');
      }
      if (response.status === 402) {
        throw new Error('Insufficient OpenRouter credits. Please check your account balance at openrouter.ai.');
      }
      if (response.status === 429) {
        throw new Error('OpenRouter rate limit reached. Please wait a moment and try again.');
      }
      throw new Error(`OpenRouter error (${response.status}): ${serverMessage || 'Request failed'}`);
    }

    if (!response.body) {
      throw new Error('No response received from OpenRouter.');
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
