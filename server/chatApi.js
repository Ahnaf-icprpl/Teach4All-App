import {
  checkRateLimit,
  getClientIp,
  applyRateLimitHeaders,
  recordRequestMetric,
} from './rateLimiter.js';
import { getRedisClient } from './redis.js';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function isPlaceholderKey(key) {
  if (!key || typeof key !== 'string') return true;
  const trimmed = key.trim();
  return !trimmed || trimmed.toLowerCase().includes('placeholder');
}

export function getSystemPrompt() {
  return 'You are Teach4All, an encouraging, accessible learning companion. Explain ideas clearly, provide intuitive examples, and help users learn step by step.';
}

export function formatMessages(messages) {
  return [
    { role: 'system', content: getSystemPrompt() },
    ...messages
      .filter(m => m && m.text && m.text.trim())
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text.trim(),
      })),
  ];
}

export async function handleChatRequest(req, res, serverEnv = {}) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  // Check rate limit via Redis (high-throughput in-memory check without touching PostgreSQL)
  const clientIp = getClientIp(req);
  const rateLimit = serverEnv.RATE_LIMIT !== undefined ? serverEnv.RATE_LIMIT : 120;
  const redisUrl = serverEnv.REDIS_URL || process.env.REDIS_URL;
  const redisClient = getRedisClient(redisUrl);

  const rateInfo = await checkRateLimit({
    endpoint: '/api/chat',
    clientIp,
    limit: rateLimit,
    windowSeconds: 60,
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
        message: `Rate limit exceeded. Too many requests. Please wait ${rateInfo.resetSeconds}s before retrying.`,
        retryAfter: rateInfo.resetSeconds,
      },
    }));
    return;
  }

  // Record ephemeral request metric into Redis (zero DB writes)
  recordRequestMetric(clientIp, '/api/chat', { redisClient });

  const apiKey = (process.env.OPENROUTER_API_KEY || serverEnv.OPENROUTER_API_KEY || '').trim();
  const model = (process.env.OPENROUTER_MODEL || serverEnv.OPENROUTER_MODEL || DEFAULT_MODEL).trim();

  if (!apiKey || isPlaceholderKey(apiKey)) {
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

  const { messages } = parsed;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'messages array is required' } }));
    return;
  }

  const formattedMessages = formatMessages(messages);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const upstream = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://teach4all.local',
        'X-Title': 'Teach4All',
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
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

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: userMsg } }));
      return;
    }

    if (!upstream.body) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'No response body from OpenRouter.' } }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Server proxy error communicating with OpenRouter.' } }));
    }
  }
}

export function createChatMiddleware(serverEnv = {}) {
  return async (req, res, next) => {
    const url = req.url ? req.url.split('?')[0] : '';
    if (url === '/api/chat' || url === '/api/chat/') {
      try {
        await handleChatRequest(req, res, serverEnv);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error.' } }));
        }
      }
      return;
    }
    if (next) next();
  };
}
