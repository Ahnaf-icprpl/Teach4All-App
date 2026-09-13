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
import { handleQuizzesRequest } from './quizzesApi.js';
import { handleMaterialsRequest } from './materialsApi.js';
import { logger, logDevRequest } from './logger.js';
import { metrics } from './metrics.js';
import { buildWebSearchPlugin, buildWebSearchTool, isWebSearchRequested } from './webSearch.js';
import { buildQuizTool, accumulateToolCalls, handleCompletedToolCalls } from './quizTool.js';
import { createChatMiddleware, dispatchApi } from './chatMiddleware.js';

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
  handleQuizzesRequest,
  handleMaterialsRequest,
  buildWebSearchPlugin,
  buildWebSearchTool,
  isWebSearchRequested,
  createChatMiddleware,
  dispatchApi,
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
    webSearch,
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

  const enableSearch = isWebSearchRequested(webSearch);
  const webPlugin = enableSearch ? buildWebSearchPlugin(serverEnv) : null;
  const quizTool = buildQuizTool(serverEnv);

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
    web_search: enableSearch ? (webPlugin?.engine || 'parallel') : 'disabled',
    tools_count: 1,
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
        tools: [quizTool],
        ...(webPlugin ? { plugins: [webPlugin] } : {}),
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
    let accumulatedText = '';
    const accumulatedToolCalls = {};
    const citations = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        if (value) bytesStreamed += value.length;

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
              accumulatedText += delta;
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
              streamWriter.writeChunk(delta);
            }
            const toolCallsDelta = json.choices?.[0]?.delta?.tool_calls;
            if (toolCallsDelta) {
              accumulateToolCalls(accumulatedToolCalls, toolCallsDelta);
            }
            const anns = json.choices?.[0]?.delta?.annotations || [];
            for (const ann of anns) {
              if (ann?.type === 'url_citation' && ann.url_citation?.url) {
                if (!citations.some(c => c.url === ann.url_citation.url)) {
                  citations.push(ann.url_citation);
                }
              }
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
              accumulatedText += delta;
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
              streamWriter.writeChunk(delta);
            }
            const toolCallsDelta = json.choices?.[0]?.delta?.tool_calls;
            if (toolCallsDelta) {
              accumulateToolCalls(accumulatedToolCalls, toolCallsDelta);
            }
            const anns = json.choices?.[0]?.delta?.annotations || [];
            for (const ann of anns) {
              if (ann?.type === 'url_citation' && ann.url_citation?.url) {
                if (!citations.some(c => c.url === ann.url_citation.url)) {
                  citations.push(ann.url_citation);
                }
              }
            }
          } catch {}
        }
      }

      if (Object.keys(accumulatedToolCalls).length > 0) {
        await handleCompletedToolCalls({
          toolCallsMap: accumulatedToolCalls,
          serverEnv,
          userId,
          clientIp,
          conversationId,
          formattedMessages,
          streamWriter,
          res,
          controller,
          apiKey,
          model,
          providerRouting,
        });
      }

      if (citations.length > 0 && !accumulatedText.includes('http')) {
        const sourcesBlock = '\n\n**Sumber:**\n' + citations.map(c => `- [${c.title || c.url}](${c.url})`).join('\n');
        accumulatedText += sourcesBlock;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: sourcesBlock } }] })}\n\n`);
        streamWriter.writeChunk(sourcesBlock);
      }

      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
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


