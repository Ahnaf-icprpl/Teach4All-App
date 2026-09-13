import {
  checkRateLimit,
  getClientIp,
  applyRateLimitHeaders,
  recordRequestMetric,
} from './rateLimiter.js';
import { getRedisClient } from './redis.js';
import {
  DEFAULT_USER_ID,
  getConversations,
  getMessages,
  deleteConversation,
  updateConversationTitle,
} from './db.js';
import { logger, logDevRequest } from './logger.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5e5) reject(new Error('Payload Too Large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function handleConversationsRequest(req, res, serverEnv = {}) {
  const method = req.method || 'GET';
  const clientIp = getClientIp(req);
  logDevRequest(req, '/api/conversations', { method });
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;

  // Rate limiting check via Redis
  const redisUrl = serverEnv.REDIS_URL || process.env.REDIS_URL;
  const redisClient = getRedisClient(redisUrl);

  const rateInfo = await checkRateLimit({
    endpoint: '/api/conversations',
    clientIp,
    limit: 120,
    windowSeconds: 60,
    redisClient,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    logger.warn('Conversations rate limit exceeded', {
      endpoint: '/api/conversations',
      client_ip: clientIp,
      retry_after: rateInfo.resetSeconds,
    });
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    });
    res.end(JSON.stringify({
      error: { message: `Rate limit exceeded. Retry in ${rateInfo.resetSeconds}s.` },
    }));
    return;
  }

  recordRequestMetric(clientIp, '/api/conversations', { redisClient });

  if (method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId') || DEFAULT_USER_ID;
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

    try {
      const conversations = await getConversations({ userId, limit, offset, databaseUrl });
      logger.info('Fetched conversations list', {
        endpoint: '/api/conversations',
        client_ip: clientIp,
        user_id: userId,
        count: conversations.length,
        limit,
        offset,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversations }));
    } catch (err) {
      logger.error('Failed to fetch conversations from DB', {
        endpoint: '/api/conversations',
        client_ip: clientIp,
        user_id: userId,
        error: err.message,
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
    }
    return;
  }

  if (method === 'DELETE') {
    let id = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('conversationId');
    let userId = parsedUrl.searchParams.get('userId') || DEFAULT_USER_ID;

    if (!id) {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}');
        id = parsed.id || parsed.conversationId;
        if (parsed.userId) userId = parsed.userId;
      } catch {}
    }

    if (!id) {
      logger.warn('Missing conversation id in DELETE /api/conversations', {
        endpoint: '/api/conversations',
        client_ip: clientIp,
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'id is required' } }));
      return;
    }

    try {
      await deleteConversation({ conversationId: id, userId, databaseUrl });
      logger.info('Deleted conversation', {
        endpoint: '/api/conversations',
        conversation_id: id,
        user_id: userId,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
    }
    return;
  }

  if (method === 'PATCH') {
    try {
      const body = await readBody(req);
      const { id, conversationId, title, userId = DEFAULT_USER_ID } = JSON.parse(body || '{}');
      const targetId = id || conversationId;

      if (!targetId || !title) {
        logger.warn('Missing id or title in PATCH /api/conversations', {
          endpoint: '/api/conversations',
          client_ip: clientIp,
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'id and title are required' } }));
        return;
      }

      const result = await updateConversationTitle({ conversationId: targetId, userId, title, databaseUrl });
      logger.info('Updated conversation title', {
        endpoint: '/api/conversations',
        conversation_id: targetId,
        title,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
    }
    return;
  }

  logger.warn('Method Not Allowed on /api/conversations', {
    endpoint: '/api/conversations',
    method,
    client_ip: clientIp,
  });
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
}

export async function handleMessagesRequest(req, res, serverEnv = {}) {
  const method = req.method || 'GET';
  const clientIp = getClientIp(req);
  logDevRequest(req, '/api/messages');

  if (method !== 'GET') {
    logger.warn('Method Not Allowed on /api/messages', {
      endpoint: '/api/messages',
      method,
      client_ip: clientIp,
    });
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;

  const redisUrl = serverEnv.REDIS_URL || process.env.REDIS_URL;
  const redisClient = getRedisClient(redisUrl);

  const rateInfo = await checkRateLimit({
    endpoint: '/api/messages',
    clientIp,
    limit: 120,
    windowSeconds: 60,
    redisClient,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    logger.warn('Messages rate limit exceeded', {
      endpoint: '/api/messages',
      client_ip: clientIp,
      retry_after: rateInfo.resetSeconds,
    });
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    });
    res.end(JSON.stringify({
      error: { message: `Rate limit exceeded. Retry in ${rateInfo.resetSeconds}s.` },
    }));
    return;
  }

  recordRequestMetric(clientIp, '/api/messages', { redisClient });

  const conversationId = parsedUrl.searchParams.get('conversationId') || parsedUrl.searchParams.get('id');
  const userId = parsedUrl.searchParams.get('userId') || DEFAULT_USER_ID;
  const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
  const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

  if (!conversationId) {
    logger.warn('Missing conversationId in GET /api/messages', {
      endpoint: '/api/messages',
      client_ip: clientIp,
    });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'conversationId is required' } }));
    return;
  }

  try {
    const messages = await getMessages({ conversationId, userId, limit, offset, databaseUrl });
    logger.info('Fetched messages for conversation', {
      endpoint: '/api/messages',
      client_ip: clientIp,
      conversation_id: conversationId,
      user_id: userId,
      count: messages.length,
      limit,
      offset,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
  } catch (err) {
    logger.error('Failed to fetch messages from DB', {
      endpoint: '/api/messages',
      client_ip: clientIp,
      conversation_id: conversationId,
      error: err.message,
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
  }
}
