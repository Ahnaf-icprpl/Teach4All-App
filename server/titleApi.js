import {
  checkRateLimit,
  getClientIp,
  applyRateLimitHeaders,
  recordRequestMetric,
  getEndpointConfig,
} from './rateLimiter.js';
import { getRedisClient } from './redis.js';
import { saveConversation, DEFAULT_USER_ID } from './db.js';
import {
  formatTitleMessages,
  cleanTitle,
  generateOfflineTitle,
  TITLE_SYSTEM_PROMPT,
} from '../prompts/titlePrompt.js';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export { cleanTitle, generateOfflineTitle, TITLE_SYSTEM_PROMPT };

function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export async function handleTitleRequest(req, res, serverEnv = {}) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  // Attach stream listeners immediately so events are not missed during async rate-limiting
  const bodyPromise = new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5e5) reject(new Error('Payload Too Large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  // Rate limiting check via Redis
  const clientIp = getClientIp(req);
  const redisUrl = serverEnv.REDIS_URL || process.env.REDIS_URL;
  const redisClient = getRedisClient(redisUrl);
  const config = await getEndpointConfig('/api/title', { redisClient });
  const rateLimit = serverEnv.RATE_LIMIT !== undefined ? serverEnv.RATE_LIMIT : config.rateLimitPerIp;
  const windowSeconds = serverEnv.WINDOW_SECONDS !== undefined ? serverEnv.WINDOW_SECONDS : config.windowSeconds;

  const rateInfo = await checkRateLimit({
    endpoint: '/api/title',
    clientIp,
    limit: rateLimit,
    windowSeconds,
    redisClient,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    });
    res.end(JSON.stringify({
      error: {
        message: `Rate limit exceeded. Please wait ${rateInfo.resetSeconds}s before retrying.`,
        retryAfter: rateInfo.resetSeconds,
      },
    }));
    return;
  }

  recordRequestMetric(clientIp, '/api/title', { redisClient });

  let bodyStr = '';
  try {
    bodyStr = await bodyPromise;
  } catch (err) {
    res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyStr || '{}');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
    return;
  }

  const { messages, conversationId, userId } = parsed;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'messages array is required' } }));
    return;
  }

  const firstUserMsg = messages.find(m => m && (m.role === 'user'));
  const firstUserText = firstUserMsg ? (firstUserMsg.text || firstUserMsg.content || '') : '';
  const fallbackTitle = generateOfflineTitle(firstUserText);

  const apiKey = (process.env.OPENROUTER_API_KEY || serverEnv.OPENROUTER_API_KEY || '').trim();
  const model = (process.env.OPENROUTER_MODEL || serverEnv.OPENROUTER_MODEL || DEFAULT_MODEL).trim();

  let finalTitle = fallbackTitle;

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
        },
        body: JSON.stringify({
          model,
          messages: formatTitleMessages(messages),
          max_tokens: 25,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (upstream.ok) {
        const json = await upstream.json();
        const rawContent = json?.choices?.[0]?.message?.content;
        finalTitle = cleanTitle(rawContent, fallbackTitle);
      }
    } catch {
      // Gracefully fall back to deterministic title on upstream error or timeout
      finalTitle = fallbackTitle;
    }
  }

  // If conversationId is provided, update PostgreSQL DB record
  if (conversationId) {
    const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
    saveConversation({
      id: conversationId,
      userId: userId || DEFAULT_USER_ID,
      title: finalTitle,
      databaseUrl,
    }).catch(() => {});
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ title: finalTitle }));
}
