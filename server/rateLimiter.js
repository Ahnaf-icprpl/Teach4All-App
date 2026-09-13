import { getRedisClient } from './redis.js';
import { query } from './db.js';

/**
 * In-memory fallback rate-limiter in case Redis is unavailable or unconfigured.
 * Prevents hammering PostgreSQL while guaranteeing high-throughput availability.
 */
const inMemoryStore = new Map();

// Periodic cleanup of expired in-memory buckets every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of inMemoryStore.entries()) {
    if (record.resetAt <= now) {
      inMemoryStore.delete(key);
    }
  }
}, 60000).unref();

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
 * Lua script for atomic sliding/fixed window rate-limiting in Redis.
 * Increments request count and attaches TTL on the first request of the window.
 */
const RATE_LIMIT_LUA = `
local current = redis.call("INCR", KEYS[1])
if tonumber(current) == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

/**
 * Checks rate limit for a client IP and endpoint.
 *
 * High volume architecture:
 * 1. Never writes to PostgreSQL on individual requests.
 * 2. Uses atomic Redis operations (sub-millisecond in-memory execution).
 * 3. Gracefully falls back to in-memory store if Redis is unavailable.
 */
export async function checkRateLimit({
  endpoint = '/api/chat',
  clientIp = '127.0.0.1',
  limit = 120, // 120 requests per IP per window (matching migration 002)
  windowSeconds = 60,
  redisUrl = process.env.REDIS_URL,
  redisClient = getRedisClient(redisUrl),
} = {}) {
  const sanitizedIp = String(clientIp || '127.0.0.1').replace(/[^a-zA-Z0-9:._-]/g, '');
  const key = `ratelimit:${endpoint}:${sanitizedIp}`;

  if (redisClient) {
    try {
      const [count, ttl] = await redisClient.eval(RATE_LIMIT_LUA, 1, key, windowSeconds);
      const current = Number(count);
      const remaining = Math.max(0, limit - current);
      const allowed = current <= limit;

      return {
        allowed,
        current,
        limit,
        remaining,
        resetSeconds: Math.max(1, Number(ttl)),
        source: 'redis',
      };
    } catch {
      // If Redis call errors, seamlessly fall through to memory fallback
    }
  }

  // In-memory fallback
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
    source: 'memory-fallback',
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
 * Retrieves endpoint configuration policy from PostgreSQL with Redis caching.
 * Authoritative source: endpoint_rate_limits table.
 * Caches in Redis for 300 seconds to ensure 0 database round-trips on hot requests.
 */
export async function getEndpointConfig(endpoint = '/api/chat', {
  databaseUrl = process.env.DATABASE_URL,
  redisClient = getRedisClient(),
} = {}) {
  // 1. Check Redis cache first (sub-millisecond, zero DB queries)
  if (redisClient) {
    try {
      const cached = await redisClient.get(`ratelimit:config:${endpoint}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore cache errors
    }
  }

  // 2. Query PostgreSQL authoritative configuration if databaseUrl is available
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

  // Cache policy in Redis for 300 seconds so hot requests make 0 DB round-trips
  if (redisClient) {
    try {
      await redisClient.set(`ratelimit:config:${endpoint}`, JSON.stringify(config), 'EX', 300);
    } catch {}
  }

  return config;
}

/**
 * Ephemeral request metrics tracking in Redis (zero DB writes).
 */
export async function recordRequestMetric(clientIp, endpoint = '/api/chat', { redisClient = getRedisClient() } = {}) {
  if (!redisClient) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    await redisClient.hincrby(`ratelimit:metrics:${today}`, `${endpoint}`, 1);
  } catch {
    // ignore metrics errors under high volume
  }
}
