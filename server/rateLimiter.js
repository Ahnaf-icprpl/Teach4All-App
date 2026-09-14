import { query } from './db.js';

/**
 * In-memory rate-limiter store.
 * High-performance, zero-latency rate-limiting without Redis or PostgreSQL overhead.
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
 *
 * Header Priority:
 * 1. x-vercel-forwarded-for (Vercel Edge Network verified client IP; cannot be spoofed)
 * 2. cf-connecting-ip (Cloudflare verified client IP)
 * 3. x-real-ip (Standard reverse proxy client IP)
 * 4. x-forwarded-for (First IP in proxy chain)
 * 5. Direct socket connection remoteAddress (normalized)
 */
export function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const headers = req.headers || {};

  // 1. Vercel trusted edge client IP header
  const vercelForwarded = headers['x-vercel-forwarded-for'];
  if (vercelForwarded) {
    const raw = Array.isArray(vercelForwarded) ? vercelForwarded[0] : vercelForwarded;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 2. Cloudflare connecting IP
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp) {
    const raw = Array.isArray(cfIp) ? cfIp[0] : cfIp;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 3. Standard reverse proxy real IP
  const realIp = headers['x-real-ip'];
  if (realIp) {
    const raw = Array.isArray(realIp) ? realIp[0] : realIp;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 4. Standard X-Forwarded-For (first entry in comma-separated chain)
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
    if (ip) return ip.replace(/^::ffff:/, '');
  }

  // 5. Socket/connection remote address fallback
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (remote) {
    return remote.replace(/^::ffff:/, '');
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
 * Checks rate limit for a client IP and endpoint completely in-memory.
 */
export async function checkRateLimit({
  endpoint = '/api/chat',
  clientIp = '127.0.0.1',
  limit = 120,
  windowSeconds = 60,
} = {}) {
  const sanitizedIp = String(clientIp || '127.0.0.1').replace(/[^a-zA-Z0-9:._-]/g, '');
  const key = `ratelimit:${endpoint}:${sanitizedIp}`;

  const now = Date.now();
  let record = inMemoryStore.get(key);
  if (!record || record.resetAt <= now) {
    record = { count: 1, resetAt: now + windowSeconds * 1000 };
    inMemoryStore.set(key, record);
  } else {
    record.count += 1;
  }

  const remaining = Math.max(0, limit - record.count);
  const resetSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  const allowed = record.count <= limit;

  return {
    allowed,
    current: record.count,
    limit,
    remaining,
    resetSeconds,
    source: 'memory',
  };
}

export function applyRateLimitHeaders(res, rateInfo) {
  if (!res || !rateInfo) return;
  const set = (key, val) => {
    if (typeof res.setHeader === 'function') {
      res.setHeader(key, String(val));
    } else if (res.headers) {
      res.headers[key] = String(val);
    }
  };

  set('X-RateLimit-Limit', rateInfo.limit);
  set('X-RateLimit-Remaining', rateInfo.remaining);
  set('X-RateLimit-Reset', rateInfo.resetSeconds);
}

/**
 * Retrieves endpoint configuration policy from PostgreSQL with in-memory caching.
 * Authoritative source: endpoint_rate_limits table.
 * Caches in memory for 300 seconds to ensure 0 database round-trips on hot requests.
 */
export async function getEndpointConfig(endpoint = '/api/chat', {
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const now = Date.now();
  const cached = inMemoryConfigCache.get(endpoint);
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  let config = { rateLimitPerIp: 120, burstLimit: 25, windowSeconds: 60 };
  if (databaseUrl) {
    try {
      const rows = await query(
        `SELECT rate_limit_per_ip, burst_limit, window_seconds FROM endpoint_rate_limits WHERE endpoint = $1 OR endpoint = '*' ORDER BY (endpoint = '*') ASC LIMIT 1;`,
        [endpoint],
        databaseUrl
      );
      if (rows && rows[0]) {
        config = {
          rateLimitPerIp: Number(rows[0].rate_limit_per_ip) || 120,
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
    expiresAt: now + 300000,
  });

  return config;
}
