import { getClientIp } from './rateLimiter.js';
import { logger, truncateText } from './logger.js';

function readJsonBody(req, maxBytes = 50000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function handleErrorLogRequest(req, res, serverEnv = {}) {
  const method = req.method || 'GET';
  const clientIp = getClientIp(req);

  if (method !== 'POST') {
    logger.warn('Method not allowed on /api/log-error', {
      endpoint: '/api/log-error',
      method,
      client_ip: clientIp,
    });
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const status = err.message === 'Payload Too Large' ? 413 : 400;
    logger.warn('Failed to parse error log payload', {
      endpoint: '/api/log-error',
      client_ip: clientIp,
      status,
      error: err.message,
    });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message } }));
    return;
  }

  const {
    type = 'unknown_client_error',
    message,
    stack,
    source,
    lineno,
    colno,
    path,
    href,
    referrer,
    userAgent,
  } = body;

  const meta = {
    endpoint: '/api/log-error',
    client_ip: clientIp,
    error_type: truncateText(String(type || ''), 100),
    path: truncateText(String(path || href || ''), 300),
    referrer: truncateText(String(referrer || ''), 300),
    user_agent: truncateText(String(userAgent || req.headers['user-agent'] || ''), 300),
  };

  if (source) meta.source = truncateText(String(source), 200);
  if (lineno) meta.lineno = Number(lineno);
  if (colno) meta.colno = Number(colno);
  if (stack) meta.stack = truncateText(String(stack), 800);

  if (type === 'not_found') {
    logger.warn(`Client 404: Not Found at ${meta.path || 'unknown'}`, meta);
  } else {
    logger.error(`Client Error: ${truncateText(String(message || 'Unknown runtime error'), 300)}`, {
      ...meta,
      message: truncateText(String(message || ''), 300),
    });
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}
