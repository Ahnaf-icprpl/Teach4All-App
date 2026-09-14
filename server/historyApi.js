import {
  checkRateLimit,
  getClientIp,
  applyRateLimitHeaders,
} from './rateLimiter.js';
import {
  DEFAULT_USER_ID,
  getConversations,
  getMessages,
  deleteConversation,
  updateConversationTitle,
} from './db.js';

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
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
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;

  const rateInfo = await checkRateLimit({
    endpoint: '/api/conversations',
    clientIp,
    limit: 120,
    windowSeconds: 60,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    });
    res.end(JSON.stringify({
      error: { message: `Rate limit exceeded. Retry in ${rateInfo.resetSeconds}s.` },
    }));
    return;
  }

  if (method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId') || DEFAULT_USER_ID;
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
    const query = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || '';

    try {
      const conversations = await getConversations({ userId, limit, offset, query, databaseUrl });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        conversations,
        hasMore: conversations.length === limit,
        limit,
        offset,
      }));
    } catch (err) {
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
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'id is required' } }));
      return;
    }

    try {
      await deleteConversation({ conversationId: id, userId, databaseUrl });
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
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'id and title are required' } }));
        return;
      }

      const result = await updateConversationTitle({ conversationId: targetId, userId, title, databaseUrl });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
}

export async function handleMessagesRequest(req, res, serverEnv = {}) {
  const method = req.method || 'GET';
  const clientIp = getClientIp(req);

  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;

  const rateInfo = await checkRateLimit({
    endpoint: '/api/messages',
    clientIp,
    limit: 120,
    windowSeconds: 60,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    });
    res.end(JSON.stringify({
      error: { message: `Rate limit exceeded. Retry in ${rateInfo.resetSeconds}s.` },
    }));
    return;
  }

  const conversationId = parsedUrl.searchParams.get('conversationId') || parsedUrl.searchParams.get('id');
  const userId = parsedUrl.searchParams.get('userId') || DEFAULT_USER_ID;
  const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
  const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

  if (!conversationId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'conversationId is required' } }));
    return;
  }

  try {
    const messages = await getMessages({ conversationId, userId, limit, offset, databaseUrl });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
  }
}
