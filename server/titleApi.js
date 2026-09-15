import {
  checkRateLimit,
  getClientIp,
  getClientLocation,
  getClientUserId,
  applyRateLimitHeaders,
  getEndpointConfig,
  enforceRateLimit,
} from './rateLimiter.js';
import { saveConversation } from './db.js';
import {
  formatTitleMessages,
  cleanTitle,
  generateOfflineTitle,
  TITLE_SYSTEM_PROMPT,
} from '../prompts/titlePrompt.js';
import {
  getConversationProvider,
  setConversationProvider,
  buildProviderRoutingPayload,
  extractProvider,
} from './providerCache.js';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const DEFAULT_TITLE_TEMPERATURE = 0.85;
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export { cleanTitle, generateOfflineTitle, TITLE_SYSTEM_PROMPT };

function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export async function handleTitleRequest(req, res, serverEnv = {}) {
  const clientIp = getClientIp(req);

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  // Attach stream listeners immediately so events are not missed during async rate-limiting
  const bodyPromise = (req.body !== undefined && req.body !== null)
    ? Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    : new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
          if (data.length > 5e5) reject(new Error('Payload Too Large'));
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });

  // In-memory rate limiting against PostgreSQL endpoint policy
  if (!(await enforceRateLimit(req, res, '/api/title', serverEnv))) {
    return;
  }

  let parsed = req.body;
  if (parsed === undefined || parsed === null || (typeof parsed !== 'object' && typeof parsed !== 'string')) {
    let bodyStr = '';
    try {
      bodyStr = await bodyPromise;
      parsed = JSON.parse(bodyStr || '{}');
    } catch (err) {
      const status = err.message === 'Payload Too Large' ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }
  } else if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      return;
    }
  }

  const { messages, conversationId } = parsed;
  const effectiveUserId = req.userId || req.headers?.['x-user-id'] || req.headers?.['x-guest-id'] || parsed?.userId;

  if (!effectiveUserId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'User ID is required.' } }));
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'messages array is required' } }));
    return;
  }

  const firstUserMsg = messages.find(m => m && (m.role === 'user'));
  const firstUserText = firstUserMsg ? (firstUserMsg.text || firstUserMsg.content || '') : '';
  const fallbackTitle = generateOfflineTitle(firstUserText);

  const apiKey = (serverEnv.OPENROUTER_API_KEY !== undefined
    ? serverEnv.OPENROUTER_API_KEY
    : (process.env.OPENROUTER_API_KEY || '')).trim();
  const model = (serverEnv.OPENROUTER_MODEL !== undefined
    ? serverEnv.OPENROUTER_MODEL
    : (process.env.OPENROUTER_MODEL || DEFAULT_MODEL)).trim();
  const temperature = Number(
    serverEnv.TITLE_TEMPERATURE !== undefined
      ? serverEnv.TITLE_TEMPERATURE
      : (process.env.TITLE_TEMPERATURE || DEFAULT_TITLE_TEMPERATURE)
  );

  const startTime = Date.now();
  let finalTitle = fallbackTitle;
  let usedSource = 'fallback';

  const cachedProvider = conversationId ? await getConversationProvider(conversationId) : null;
  const providerRouting = buildProviderRoutingPayload(conversationId, cachedProvider);

  if (apiKey && !isPlaceholderKey(apiKey)) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const upstream = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://teach4all.local',
          'X-Title': 'Teach4All Title Generator',
          'X-Forwarded-For': clientIp,
          'X-Real-IP': clientIp,
          ...(conversationId ? { 'X-Session-Id': conversationId } : {}),
        },
        body: JSON.stringify({
          model,
          messages: formatTitleMessages(messages),
          max_tokens: 25,
          temperature,
          user: effectiveUserId || clientIp,
          ...providerRouting,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (upstream.ok) {
        let detectedProvider = extractProvider(upstream.headers) || cachedProvider;
        if (conversationId && detectedProvider) {
          setConversationProvider(conversationId, detectedProvider).catch(() => {});
        }
        const json = await upstream.json();
        if (conversationId && !detectedProvider && json?.provider) {
          detectedProvider = extractProvider(null, json);
          if (detectedProvider) {
            setConversationProvider(conversationId, detectedProvider).catch(() => {});
          }
        }
        const rawContent = json?.choices?.[0]?.message?.content;
        finalTitle = cleanTitle(rawContent, fallbackTitle);
        usedSource = 'llm';
      }
    } catch (err) {
      // Gracefully fall back to deterministic title on upstream error or timeout
      finalTitle = fallbackTitle;
    }
  }

  // If conversationId is provided, update PostgreSQL DB record
  if (conversationId) {
    const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
    saveConversation({
      id: conversationId,
      userId: effectiveUserId,
      title: finalTitle,
      databaseUrl,
    }).catch(() => {});
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ title: finalTitle }));
}
