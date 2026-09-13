import {
  checkRateLimit,
  getClientIp,
  getClientLocation,
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
import {
  getConversationProvider,
  setConversationProvider,
  buildProviderRoutingPayload,
  extractProvider,
} from './providerCache.js';
import { logger, logDevRequest } from './logger.js';

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
  logDevRequest(req, '/api/title');

  if (req.method !== 'POST') {
    logger.warn('Method Not Allowed on /api/title', { endpoint: '/api/title', method: req.method, client_ip: clientIp });
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
    logger.warn('Title rate limit exceeded', {
      endpoint: '/api/title',
      client_ip: clientIp,
      retry_after: rateInfo.resetSeconds,
    });
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
    const status = err.message === 'Payload Too Large' ? 413 : 400;
    logger.warn('Title request body reading error', {
      endpoint: '/api/title',
      client_ip: clientIp,
      status,
      error: err.message,
    });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyStr || '{}');
  } catch {
    logger.warn('Invalid JSON in title request body', { endpoint: '/api/title', client_ip: clientIp });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
    return;
  }

  const { messages, conversationId, userId } = parsed;

  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn('Title request missing messages array', { endpoint: '/api/title', client_ip: clientIp });
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

  const cachedProvider = conversationId ? await getConversationProvider(conversationId, { redisClient }) : null;
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
          user: userId || clientIp,
          ...providerRouting,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (upstream.ok) {
        let detectedProvider = extractProvider(upstream.headers) || cachedProvider;
        if (conversationId && detectedProvider) {
          setConversationProvider(conversationId, detectedProvider, { redisClient }).catch(() => {});
        }
        const json = await upstream.json();
        if (conversationId && !detectedProvider && json?.provider) {
          detectedProvider = extractProvider(null, json);
          if (detectedProvider) {
            setConversationProvider(conversationId, detectedProvider, { redisClient }).catch(() => {});
          }
        }
        const rawContent = json?.choices?.[0]?.message?.content;
        finalTitle = cleanTitle(rawContent, fallbackTitle);
        usedSource = 'llm';
      }
    } catch (err) {
      // Gracefully fall back to deterministic title on upstream error or timeout
      logger.warn('Title generation LLM call failed, using fallback', {
        endpoint: '/api/title',
        conversation_id: conversationId,
        client_ip: clientIp,
        error: err.message,
      });
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

  const clientLoc = getClientLocation(req);
  logger.info('Title generated successfully', {
    endpoint: '/api/title',
    conversation_id: conversationId,
    client_ip: clientIp,
    ...(clientLoc?.country ? { client_country: clientLoc.country } : {}),
    ...(clientLoc?.city ? { client_city: clientLoc.city } : {}),
    title: finalTitle,
    prompt: firstUserText,
    model,
    source: usedSource,
    duration_ms: Date.now() - startTime,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ title: finalTitle }));
}
