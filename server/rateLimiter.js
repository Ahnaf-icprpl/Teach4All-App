import { query } from './db.js';

/**
 * In-memory rate-limiter store.
 * High-performance, zero-latency rate-limiting without Redis or PostgreSQL overhead on request path.
 */
export const inMemoryStore = new Map();
const inMemoryConfigCache = new Map();

export function clearRateLimitStore() {
  inMemoryStore.clear();
  inMemoryConfigCache.clear();
}

// Periodic cleanup of expired in-memory buckets every 60s
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of inMemoryStore.entries()) {
    if (record.resetAt <= now) {
      inMemoryStore.delete(key);
    }
  }
  for (const [key, record] of inMemoryConfigCache.entries()) {
    if (record.expiresAt <= now) {
      inMemoryConfigCache.delete(key);
    }
  }
}, 60000);

if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

/**
 * Resolves the true client IP address with priority for Vercel Edge Network,
 * Cloudflare, and standard reverse proxy forwarding headers.
 */
export function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const headers = req.headers || {};

  // 1. Cloudflare connecting IP / True-Client-IP (highest precedence for CF-proxied traffic)
  const cfIp = headers['cf-connecting-ip'] || headers['true-client-ip'];
  if (cfIp) {
    const raw = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 2. Vercel trusted edge client IP header
  const vercelForwarded = headers['x-vercel-forwarded-for'];
  if (vercelForwarded) {
    const raw = Array.isArray(vercelForwarded) ? vercelForwarded[0] : vercelForwarded;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 3. Standard reverse proxy real IP (Traefik, Nginx, Caddy)
  const realIp = headers['x-real-ip'] || headers['x-client-ip'];
  if (realIp) {
    const raw = Array.isArray(realIp) ? realIp[0] : realIp;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 4. Standard X-Forwarded-For (filter out loopback if a public/external IP exists in the chain)
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    if (typeof raw === 'string') {
      const parts = raw.split(',').map(s => s.trim().replace(/^::ffff:/, '')).filter(Boolean);
      const publicIp = parts.find(p => p !== '127.0.0.1' && p !== '::1' && p !== 'localhost' && !p.startsWith('127.'));
      if (publicIp) return publicIp;
      if (parts[0]) return parts[0];
    }
  }

  // 5. Express trusted proxy IP (when app.set('trust proxy', true) is active)
  if (req.ip) {
    const clean = String(req.ip).replace(/^::ffff:/, '').trim();
    if (clean && clean !== '127.0.0.1' && clean !== '::1') return clean;
  }

  // 6. Socket/connection remote address fallback
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (remote) {
    return String(remote).replace(/^::ffff:/, '').trim();
  }

  return '127.0.0.1';
}

/**
 * Extracts Vercel / Cloudflare edge location metadata for enhanced observability.
 */
export function getClientLocation(req) {
  if (!req || !req.headers) return null;
  const h = req.headers;
  const country = h['x-vercel-ip-country'] || h['cf-ipcountry'] || null;
  const city = h['x-vercel-ip-city'] || null;
  const region = h['x-vercel-ip-country-region'] || null;
  if (!country && !city && !region) return null;
  return { country, city, region };
}

/**
 * Resolves client user ID from headers, request body, or URL query parameters.
 */
export function getClientUserId(req, body = null) {
  if (!req) return null;
  if (req.user && typeof req.user.id === 'string' && req.user.id.trim()) {
    return req.user.id.trim();
  }
  if (typeof req.userId === 'string' && req.userId.trim()) {
    return req.userId.trim();
  }
  const headers = req.headers || {};
  const headerUser = headers['x-user-id'] || headers['x-consumer-id'] || headers['x-guest-id'];
  if (typeof headerUser === 'string' && headerUser.trim()) {
    return headerUser.trim();
  }
  if (body && typeof body.userId === 'string' && body.userId.trim()) {
    return body.userId.trim();
  }
  if (req.body && typeof req.body.userId === 'string' && req.body.userId.trim()) {
    return req.body.userId.trim();
  }
  try {
    const rawUrl = req.url || '/';
    const parsed = new URL(rawUrl, 'http://localhost');
    const qUser = parsed.searchParams.get('userId') || parsed.searchParams.get('user_id');
    if (qUser && qUser.trim()) {
      return qUser.trim();
    }
  } catch {}
  return null;
}

/**
 * Checks rate limit for client IP and optional client User ID.
 * Authoritative in-memory tracking with window-based TTL.
 */
export async function checkRateLimit({
  endpoint = '/api/chat',
  clientIp = '127.0.0.1',
  userId = null,
  limit = 120,
  userLimit = null,
  windowSeconds = 60,
} = {}) {
  const sanitizedIp = String(clientIp || '127.0.0.1').replace(/[^a-zA-Z0-9:._-]/g, '');
  const now = Date.now();

  // 1. IP Rate Limiting
  const ipKey = `ratelimit:ip:${endpoint}:${sanitizedIp}`;
  let ipRecord = inMemoryStore.get(ipKey);
  if (!ipRecord || ipRecord.resetAt <= now) {
    ipRecord = { count: 1, resetAt: now + windowSeconds * 1000 };
    inMemoryStore.set(ipKey, ipRecord);
  } else {
    ipRecord.count += 1;
  }
  const ipRemaining = Math.max(0, limit - ipRecord.count);
  const ipResetSeconds = Math.max(1, Math.ceil((ipRecord.resetAt - now) / 1000));
  const ipAllowed = ipRecord.count <= limit;

  // 2. User Rate Limiting (if userId is provided)
  const effectiveUserLimit = userLimit !== null && userLimit !== undefined ? Number(userLimit) : limit;
  let userAllowed = true;
  let userRemaining = effectiveUserLimit;
  let userResetSeconds = windowSeconds;
  let userCount = 0;

  if (userId && typeof userId === 'string' && userId.trim()) {
    const sanitizedUser = String(userId.trim()).replace(/[^a-zA-Z0-9:._-]/g, '');
    const userKey = `ratelimit:user:${endpoint}:${sanitizedUser}`;
    let userRecord = inMemoryStore.get(userKey);
    if (!userRecord || userRecord.resetAt <= now) {
      userRecord = { count: 1, resetAt: now + windowSeconds * 1000 };
      inMemoryStore.set(userKey, userRecord);
    } else {
      userRecord.count += 1;
    }
    userCount = userRecord.count;
    userRemaining = Math.max(0, effectiveUserLimit - userRecord.count);
    userResetSeconds = Math.max(1, Math.ceil((userRecord.resetAt - now) / 1000));
    userAllowed = userRecord.count <= effectiveUserLimit;
  }

  const allowed = ipAllowed && userAllowed;
  const remaining = Math.min(ipRemaining, userRemaining);
  const resetSeconds = !allowed
    ? (!ipAllowed ? ipResetSeconds : userResetSeconds)
    : Math.max(ipResetSeconds, userResetSeconds);

  let limitType = 'ip';
  let message = `Rate limit exceeded. Retry in ${resetSeconds}s.`;
  if (!userAllowed) {
    limitType = 'user';
    message = `Rate limit exceeded for user. Retry in ${userResetSeconds}s.`;
  } else if (!ipAllowed) {
    limitType = 'ip';
    message = `Rate limit exceeded. Retry in ${ipResetSeconds}s.`;
  }

  return {
    allowed,
    current: !userAllowed ? userCount : ipRecord.count,
    limit: !userAllowed ? effectiveUserLimit : limit,
    remaining,
    resetSeconds,
    source: 'memory',
    limitType,
    message,
    ip: {
      allowed: ipAllowed,
      current: ipRecord.count,
      limit,
      remaining: ipRemaining,
      resetSeconds: ipResetSeconds,
    },
    user: userId ? {
      allowed: userAllowed,
      current: userCount,
      limit: effectiveUserLimit,
      remaining: userRemaining,
      resetSeconds: userResetSeconds,
    } : null,
  };
}

export function applyRateLimitHeaders(res, rateInfo) {
  if (!res || !rateInfo || res.headersSent) return;
  const set = (key, val) => {
    if (res.headersSent) return;
    if (typeof res.setHeader === 'function') {
      res.setHeader(key, String(val));
    } else if (res.headers) {
      res.headers[key] = String(val);
    }
  };

  set('X-RateLimit-Limit', rateInfo.limit);
  set('X-RateLimit-Remaining', rateInfo.remaining);
  set('X-RateLimit-Reset', rateInfo.resetSeconds);
  if (rateInfo.ip) {
    set('X-RateLimit-Limit-IP', rateInfo.ip.limit);
    set('X-RateLimit-Remaining-IP', rateInfo.ip.remaining);
  }
  if (rateInfo.user) {
    set('X-RateLimit-Limit-User', rateInfo.user.limit);
    set('X-RateLimit-Remaining-User', rateInfo.user.remaining);
  }
}

function sendRateLimitResponse(res, statusCode, headers, payload) {
  if (res.headersSent) {
    try { res.end(payload); } catch {}
    return;
  }
  if (typeof res.writeHead === 'function') {
    res.writeHead(statusCode, headers);
    res.end(payload);
    return;
  }
  if (typeof res.status === 'function') res.status(statusCode);
  if (typeof res.setHeader === 'function') {
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, String(v));
    }
  }
  if (typeof res.send === 'function') {
    res.send(payload);
  } else if (typeof res.end === 'function') {
    res.end(payload);
  }
}

/**
 * Retrieves endpoint configuration policy from PostgreSQL with in-memory caching.
 * Authoritative source: endpoint_rate_limits table.
 * Reads rate_limit_per_ip, rate_limit_per_user, burst_limit, window_seconds.
 */
export async function getEndpointConfig(endpoint = '/api/chat', {
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const now = Date.now();
  const cached = inMemoryConfigCache.get(endpoint);
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  let config = { rateLimitPerIp: 120, rateLimitPerUser: 60, rateLimitPerGuest: 2, burstLimit: 25, windowSeconds: 60 };
  if (databaseUrl) {
    try {
      const rows = await query(
        `SELECT rate_limit_per_ip, rate_limit_per_user, rate_limit_per_guest, burst_limit, window_seconds FROM endpoint_rate_limits WHERE endpoint = $1 OR endpoint = '*' ORDER BY (endpoint = '*') ASC LIMIT 1;`,
        [endpoint],
        databaseUrl
      );
      if (rows && rows[0]) {
        config = {
          rateLimitPerIp: Number(rows[0].rate_limit_per_ip) || 120,
          rateLimitPerUser: Number(rows[0].rate_limit_per_user) || 60,
          rateLimitPerGuest: rows[0].rate_limit_per_guest !== undefined && rows[0].rate_limit_per_guest !== null
            ? Number(rows[0].rate_limit_per_guest)
            : 2,
          burstLimit: Number(rows[0].burst_limit) || 25,
          windowSeconds: Number(rows[0].window_seconds) || 60,
        };
      }
    } catch {
      // ignore db errors, fallback to defaults
    }
  }

  inMemoryConfigCache.set(endpoint, {
    config,
    expiresAt: now + 60000,
  });

  return config;
}

/**
 * Universal rate limit enforcer for all endpoints.
 * Checks both per-IP and per-user limits, applies response headers, and sends 429 when exceeded.
 * Returns true if allowed, false if blocked (and responds with 429).
 */
export async function enforceRateLimit(req, res, endpoint, serverEnv = {}, options = {}) {
  const resolvedEndpoint = endpoint || (req?.baseUrl ? `${req.baseUrl}${req.path}` : (req?.originalUrl || req?.url || '/').split('?')[0]);

  const clientIp = getClientIp(req);
  const userId = options.userId || getClientUserId(req, options.body);
  const databaseUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;

  const config = await getEndpointConfig(resolvedEndpoint, { databaseUrl });

  // 1. Check guest account message limit before requiring login
  const isGuest = Boolean(req?.isGuest || (typeof userId === 'string' && userId.startsWith('guest_')));
  if (isGuest && resolvedEndpoint === '/api/chat') {
    const guestLimit = serverEnv.RATE_LIMIT_PER_GUEST !== undefined
      ? Number(serverEnv.RATE_LIMIT_PER_GUEST)
      : (config.rateLimitPerGuest !== undefined ? Number(config.rateLimitPerGuest) : 2);

    if (guestLimit > 0) {
      let guestMsgCount = 0;
      if (databaseUrl && userId) {
        try {
          const countRows = await query(
            `SELECT COUNT(*)::int AS count FROM messages WHERE user_id = $1 AND role = 'user';`,
            [userId],
            databaseUrl
          );
          if (countRows && countRows[0] && countRows[0].count !== undefined) {
            guestMsgCount = Number(countRows[0].count);
          }
        } catch {}
      }
      const memKey = `ratelimit:guest:lifetime:${userId}`;
      const memRec = inMemoryStore.get(memKey);
      const effectiveGuestCount = Math.max(guestMsgCount, memRec?.count || 0);

      if (effectiveGuestCount >= guestLimit) {
        const guestMsg = `Batas akun tamu tercapai (maksimal ${guestLimit} pesan). Silakan masuk ke akun Anda untuk melanjutkan percakapan — setelah masuk tetap gratis!`;
        const payload = JSON.stringify({
          error: {
            message: guestMsg,
            code: 'GUEST_LIMIT_REACHED',
            requireLogin: true,
            limit: guestLimit,
          },
        });
        sendRateLimitResponse(res, 429, {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit-Guest': String(guestLimit),
          'X-RateLimit-Remaining-Guest': '0',
        }, payload);
        return false;
      }
      inMemoryStore.set(memKey, { count: effectiveGuestCount + 1, resetAt: Date.now() + 86400000 });
      if (typeof res.setHeader === 'function' && !res.headersSent) {
        res.setHeader('X-RateLimit-Limit-Guest', String(guestLimit));
        res.setHeader('X-RateLimit-Remaining-Guest', String(Math.max(0, guestLimit - (effectiveGuestCount + 1))));
      }
    }
  }

  const limit = serverEnv.RATE_LIMIT !== undefined
    ? serverEnv.RATE_LIMIT
    : (serverEnv.RATE_LIMIT_PER_IP !== undefined ? serverEnv.RATE_LIMIT_PER_IP : config.rateLimitPerIp);

  const userLimit = serverEnv.RATE_LIMIT_PER_USER !== undefined
    ? serverEnv.RATE_LIMIT_PER_USER
    : (serverEnv.RATE_LIMIT !== undefined ? serverEnv.RATE_LIMIT : config.rateLimitPerUser);

  const windowSeconds = serverEnv.WINDOW_SECONDS !== undefined
    ? serverEnv.WINDOW_SECONDS
    : config.windowSeconds;

  const rateInfo = await checkRateLimit({
    endpoint: resolvedEndpoint,
    clientIp,
    userId,
    limit,
    userLimit,
    windowSeconds,
  });

  applyRateLimitHeaders(res, rateInfo);

  if (!rateInfo.allowed) {
    const payload = JSON.stringify({
      error: {
        message: rateInfo.message || `Rate limit exceeded. Retry in ${rateInfo.resetSeconds}s.`,
      },
    });
    sendRateLimitResponse(res, 429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateInfo.resetSeconds),
    }, payload);
    return false;
  }

  return true;
}

/**
 * Express middleware for declarative route-level rate limiting.
 */
export function rateLimitMiddleware(serverEnv = {}, endpointOverride = null) {
  return async function rateLimiter(req, res, next) {
    const targetEndpoint = endpointOverride || (req?.baseUrl ? `${req.baseUrl}${req.path}` : (req?.originalUrl || req?.url || '/').split('?')[0]);
    const allowed = await enforceRateLimit(req, res, targetEndpoint, serverEnv);
    if (allowed && typeof next === 'function') {
      next();
    }
  };
}
