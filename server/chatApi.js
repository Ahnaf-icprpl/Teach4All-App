import {
  checkRateLimit,
  getClientIp,
  getClientLocation,
  applyRateLimitHeaders,
  recordRequestMetric,
  getEndpointConfig,
} from './rateLimiter.js';
import { getRedisClient } from './redis.js';
import { getSystemPrompt, injectSystemPrompt } from '../prompts/systemPrompt.js';
import { ConversationStreamWriter, DEFAULT_USER_ID } from './db.js';
import { handleTitleRequest } from './titleApi.js';
import { handleConversationsRequest, handleMessagesRequest } from './historyApi.js';
import {
  getConversationProvider,
  setConversationProvider,
  buildProviderRoutingPayload,
  extractProvider,
} from './providerCache.js';
import { handleErrorLogRequest } from './errorApi.js';
import { handleUiTextsRequest, handleChatPromptsRequest } from './uiTextsApi.js';
import { logger, logDevRequest } from './logger.js';
import { metrics } from './metrics.js';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export {
  getSystemPrompt,
  handleTitleRequest,
  handleConversationsRequest,
  handleMessagesRequest,
  getConversationProvider,
  setConversationProvider,
  buildProviderRoutingPayload,
  extractProvider,
  handleErrorLogRequest,
  handleUiTextsRequest,
  handleChatPromptsRequest,
};

export function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export function formatMessages(messages) {
  return injectSystemPrompt(messages);
}

export async function handleChatRequest(req, res, serverEnv = {}) {
  const clientIp = getClientIp(req);
  logDevRequest(req, '/api/chat');

  if (req.method !== 'POST') {
    logger.warn('Method Not Allowed on /api/chat', { endpoint: '/api/chat', method: req.method, client_ip: clientIp });
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  // Check rate limit via Redis (high-throughput in-memory check without touching PostgreSQL)
  const redisUrl = serverEnv.REDIS_URL || process.env.REDIS_URL;
  const redisClient = getRedisClient(redisUrl);
  const config = await getEndpointConfig('/api/chat', { redisClient });
  const rateLimit = serverEnv.RATE_LIMIT !== undefined ? serverEnv.RATE_LIMIT : config.rateLimitPerIp;
  const windowSeconds = serverEnv.WINDOW_SECONDS !== undefined ? serverEnv.WINDOW_SECONDS : config.windowSeconds;

  const rateInfo = await checkRateLimit({
    endpoint: '/api/chat',
    clientIp,
    limit: rateLimit,
    windowSeconds,
    redisClient,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    metrics.recordRateLimitHit({ endpoint: '/api/chat' });
    logger.warn('Chat rate limit exceeded', {
      endpoint: '/api/chat',
      client_ip: clientIp,
      retry_after: rateInfo.resetSeconds,
    });
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    });
    res.end(JSON.stringify({
      error: {
        message: `Rate limit exceeded. Too many requests. Please wait ${rateInfo.resetSeconds}s before retrying.`,
        retryAfter: rateInfo.resetSeconds,
      },
    }));
    return;
  }

  // Record ephemeral request metric into Redis (zero DB writes)
  recordRequestMetric(clientIp, '/api/chat', { redisClient });

  const apiKey = (serverEnv.OPENROUTER_API_KEY !== undefined
    ? serverEnv.OPENROUTER_API_KEY
    : (process.env.OPENROUTER_API_KEY || '')).trim();
  const model = (serverEnv.OPENROUTER_MODEL !== undefined
    ? serverEnv.OPENROUTER_MODEL
    : (process.env.OPENROUTER_MODEL || DEFAULT_MODEL)).trim();

  if (!apiKey || isPlaceholderKey(apiKey)) {
    logger.warn('OpenRouter API key is unconfigured or placeholder', { endpoint: '/api/chat' });
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'OpenRouter API key is not configured on the server. Please set OPENROUTER_API_KEY in the server environment.',
      },
    }));
    return;
  }

  let bodyStr = '';
  try {
    bodyStr = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 1e6) reject(new Error('Payload Too Large'));
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  } catch (err) {
    const status = err.message === 'Payload Too Large' ? 413 : 400;
    logger.warn('Chat request body reading error', {
      endpoint: '/api/chat',
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
    logger.warn('Invalid JSON in chat request body', { endpoint: '/api/chat', client_ip: clientIp });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
    return;
  }

  const {
    messages,
    conversationId,
    conversationTitle,
    userMessageId,
    assistantMessageId,
    userId,
  } = parsed;

  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn('Chat request missing messages array', { endpoint: '/api/chat', client_ip: clientIp });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'messages array is required' } }));
    return;
  }

  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const lastUserMsg = messages.slice().reverse().find(m => m && m.role === 'user');
  const streamWriter = new ConversationStreamWriter({
    conversationId,
    userId: userId || DEFAULT_USER_ID,
    title: conversationTitle || (lastUserMsg ? (lastUserMsg.text || lastUserMsg.content || '').slice(0, 60) : 'New Conversation'),
    userMessage: lastUserMsg ? {
      id: userMessageId || lastUserMsg.id,
      role: 'user',
      text: lastUserMsg.text || lastUserMsg.content,
    } : null,
    assistantMessageId,
    databaseUrl,
  });

  // Non-blocking initialization of conversation and user message in DB
  streamWriter.init().catch(() => {});

  const startTime = Date.now();
  const promptText = lastUserMsg ? (lastUserMsg.text || lastUserMsg.content || '') : '';
  const cachedProvider = conversationId ? await getConversationProvider(conversationId, { redisClient }) : null;
  const providerRouting = buildProviderRoutingPayload(conversationId, cachedProvider);

  const clientLoc = getClientLocation(req);
  logger.info('Chat stream requested', {
    endpoint: '/api/chat',
    conversation_id: conversationId,
    client_ip: clientIp,
    ...(clientLoc?.country ? { client_country: clientLoc.country } : {}),
    ...(clientLoc?.city ? { client_city: clientLoc.city } : {}),
    model,
    prompt: promptText,
    messages_count: messages.length,
    cached_provider: cachedProvider || 'none',
  });

  const formattedMessages = formatMessages(messages);
  const controller = new AbortController();
  req.on('close', () => {
    controller.abort();
    streamWriter.abort().catch(() => {});
  });

  try {
    const upstream = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://teach4all.local',
        'X-Title': 'Teach4All',
        'X-Forwarded-For': clientIp,
        'X-Real-IP': clientIp,
        ...(conversationId ? { 'X-Session-Id': conversationId } : {}),
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        user: userId || clientIp,
        ...providerRouting,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      let errorMsg = '';
      try {
        const errJson = await upstream.json();
        errorMsg = errJson?.error?.message || '';
      } catch {
        try {
          const raw = await upstream.text();
          errorMsg = raw.slice(0, 150);
        } catch {}
      }

      const status = upstream.status;
      let userMsg = `Upstream error (${status})`;
      if (status === 401) {
        userMsg = 'Server authentication error with OpenRouter. Check server API key configuration.';
      } else if (status === 402) {
        userMsg = 'Insufficient OpenRouter credits on server account.';
      } else if (status === 429) {
        userMsg = 'OpenRouter rate limit reached. Please wait a moment and try again.';
      } else if (errorMsg) {
        userMsg = `OpenRouter error (${status}): ${errorMsg}`;
      }

      logger.error('OpenRouter upstream error', {
        endpoint: '/api/chat',
        status,
        model,
        conversation_id: conversationId,
        client_ip: clientIp,
        duration_ms: Date.now() - startTime,
        error: errorMsg || userMsg,
      });

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: userMsg } }));
      return;
    }

    if (!upstream.body) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'No response body from OpenRouter.' } }));
      return;
    }

    let detectedProvider = extractProvider(upstream.headers) || cachedProvider;
    if (conversationId && detectedProvider) {
      setConversationProvider(conversationId, detectedProvider, { redisClient }).catch(() => {});
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(detectedProvider ? { 'X-Provider': detectedProvider } : {}),
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let chunkCount = 0;
    let bytesStreamed = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        if (value) bytesStreamed += value.length;
        res.write(value);

        // Stream text deltas to DB asynchronously
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            if (conversationId && !detectedProvider && json.provider) {
              detectedProvider = extractProvider(null, json);
              if (detectedProvider) {
                setConversationProvider(conversationId, detectedProvider, { redisClient }).catch(() => {});
              }
            }
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              streamWriter.writeChunk(delta);
            }
          } catch {}
        }
      }

      if (sseBuffer.trim().startsWith('data: ')) {
        const data = sseBuffer.trim().slice(6);
        if (data !== '[DONE]') {
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              streamWriter.writeChunk(delta);
            }
          } catch {}
        }
      }

      await streamWriter.finish();
      const streamDurationMs = Date.now() - startTime;
      metrics.recordStreamMetric({
        chunks: chunkCount,
        bytes: bytesStreamed,
        model,
        durationMs: streamDurationMs,
      });
      logger.info('Chat completion stream finished', {
        endpoint: '/api/chat',
        conversation_id: conversationId,
        client_ip: clientIp,
        provider: detectedProvider,
        model,
        duration_ms: streamDurationMs,
        chunks_count: chunkCount,
        bytes_streamed: bytesStreamed,
      });
    } finally {
      res.end();
    }
  } catch (err) {
    if (controller.signal.aborted) {
      logger.info('Chat request aborted by client', {
        endpoint: '/api/chat',
        conversation_id: conversationId,
        client_ip: clientIp,
        duration_ms: Date.now() - startTime,
        chunks_count: chunkCount,
      });
      return;
    }
    logger.error('Unhandled proxy error in chatApi', {
      endpoint: '/api/chat',
      client_ip: clientIp,
      duration_ms: Date.now() - startTime,
      error: err.message,
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Server proxy error communicating with OpenRouter.' } }));
    }
  }
}

async function dispatchApi(handler, req, res, serverEnv, routeName) {
  try {
    await handler(req, res, serverEnv);
  } catch (err) {
    logger.error(`Unhandled error in ${routeName} middleware`, { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal server error.' } }));
    }
  }
}

export function createChatMiddleware(serverEnv = {}) {
  return async (req, res, next) => {
    const isDev = (serverEnv.ENV || serverEnv.env || process.env.ENV || process.env.env || '').toLowerCase() === 'development' || logger.isDev();
    const clientIp = getClientIp(req);
    const start = Date.now();
    const url = req.url ? req.url.split('?')[0] : '';
    const fullUrl = req.url || '/';
    const method = req.method || 'GET';

    if (isDev) {
      logger.info(`Incoming ${method} ${fullUrl}`, {
        dev_trace: true,
        method,
        url: fullUrl,
        client_ip: clientIp,
        user_agent: req.headers['user-agent'] || '',
      });
    }

    const endTracking = metrics.startRequest({ endpoint: url || fullUrl, method, req });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      endTracking();
      metrics.recordHttpRequest({ endpoint: url || fullUrl, method, status: res.statusCode, durationMs, req, res });
      metrics.flush().catch(() => {});
      if (isDev) {
        logger.info(`Completed ${method} ${fullUrl} -> ${res.statusCode} (${durationMs}ms)`, {
          dev_trace: true,
          method,
          url: fullUrl,
          status: res.statusCode,
          duration_ms: durationMs,
          client_ip: clientIp,
        });
      }
    });

    if (url === '/api/chat' || url === '/api/chat/') {
      return dispatchApi(handleChatRequest, req, res, serverEnv, '/api/chat');
    }
    if (url === '/api/title' || url === '/api/title/') {
      return dispatchApi(handleTitleRequest, req, res, serverEnv, '/api/title');
    }
    if (url === '/api/conversations' || url === '/api/conversations/') {
      return dispatchApi(handleConversationsRequest, req, res, serverEnv, '/api/conversations');
    }
    if (url === '/api/messages' || url === '/api/messages/') {
      return dispatchApi(handleMessagesRequest, req, res, serverEnv, '/api/messages');
    }
    if (url === '/api/log-error' || url === '/api/log-error/') {
      return dispatchApi(handleErrorLogRequest, req, res, serverEnv, '/api/log-error');
    }
    if (url === '/api/ui-texts' || url === '/api/ui-texts/') {
      return dispatchApi(handleUiTextsRequest, req, res, serverEnv, '/api/ui-texts');
    }
    if (url === '/api/chat-prompts' || url === '/api/chat-prompts/') {
      return dispatchApi(handleChatPromptsRequest, req, res, serverEnv, '/api/chat-prompts');
    }
    if (url.startsWith('/api/')) {
      logger.warn('API endpoint not found (404)', { endpoint: url, method, client_ip: clientIp });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Route ${url} not found` } }));
      return;
    }
    if (next) next();
  };
}
