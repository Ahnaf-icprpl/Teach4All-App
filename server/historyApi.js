import {
  checkRateLimit,
  getClientIp,
  applyRateLimitHeaders,
  enforceRateLimit,
} from './rateLimiter.js';
import {
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
  const effectiveUserId = req.userId || req.headers?.['x-user-id'] || req.headers?.['x-guest-id'] || parsedUrl.searchParams.get('userId');

  if (!effectiveUserId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'User ID is required.' } }));
    return;
  }

  if (!(await enforceRateLimit(req, res, '/api/conversations', serverEnv))) {
    return;
  }

  if (method === 'GET') {
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
    const query = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || '';

    try {
      const conversations = await getConversations({ userId: effectiveUserId, limit, offset, query, databaseUrl });
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

    if (!id) {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}');
        id = parsed.id || parsed.conversationId;
      } catch {}
    }

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'id is required' } }));
      return;
    }

    try {
      await deleteConversation({ conversationId: id, userId: effectiveUserId, databaseUrl });
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
      const { id, conversationId, title } = JSON.parse(body || '{}');
      const targetId = id || conversationId;

      if (!targetId || !title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'id and title are required' } }));
        return;
      }

      const result = await updateConversationTitle({ conversationId: targetId, userId: effectiveUserId, title, databaseUrl });
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
  const effectiveUserId = req.userId || req.headers?.['x-user-id'] || req.headers?.['x-guest-id'] || parsedUrl.searchParams.get('userId');

  if (!effectiveUserId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'User ID is required.' } }));
    return;
  }

  if (!(await enforceRateLimit(req, res, '/api/messages', serverEnv))) {
    return;
  }

  const conversationId = parsedUrl.searchParams.get('conversationId') || parsedUrl.searchParams.get('id');
  const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
  const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

  if (!conversationId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'conversationId is required' } }));
    return;
  }

  try {
    const messages = await getMessages({ conversationId, userId: effectiveUserId, limit, offset, databaseUrl });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message || 'Database error' } }));
  }
}
