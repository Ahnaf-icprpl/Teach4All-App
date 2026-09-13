import test from 'node:test';
import assert from 'node:assert';
import { RedisClient } from '../server/redis.js';
import { checkRateLimit, getClientIp, getClientLocation, applyRateLimitHeaders } from '../server/rateLimiter.js';
import { handleChatRequest } from '../server/chatApi.js';
import { EventEmitter } from 'node:events';
import { loadLocalEnv } from '../scripts/migrate.mjs';

loadLocalEnv();
const REDIS_URL = process.env.REDIS_URL || 'redis://default:6pGZA9MN66cmIrZZo00fy8SLaYkPc1rj@river-loss-eggshell-39893.db.redis.io:10237';

test('RedisClient connects and performs atomic rate-limit commands', async () => {
  const client = new RedisClient(REDIS_URL);
  client.connect();

  try {
    const ping = await client.ping();
    assert.strictEqual(ping, 'PONG');

    const testKey = `test:ratelimit:unit:${Date.now()}`;
    const incr1 = await client.incr(testKey);
    assert.strictEqual(incr1, 1);

    const incr2 = await client.incr(testKey);
    assert.strictEqual(incr2, 2);

    await client.del(testKey);
  } finally {
    client.close();
  }
});

test('checkRateLimit accurately tracks request counts and window TTL without DB writes', async () => {
  const client = new RedisClient(REDIS_URL);
  client.connect();

  const testIp = `test-ip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const res1 = await checkRateLimit({
      endpoint: '/api/chat',
      clientIp: testIp,
      limit: 2,
      windowSeconds: 10,
      redisClient: client,
    });

    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.current, 1);
    assert.strictEqual(res1.remaining, 1);
    assert.strictEqual(res1.source, 'redis');

    const res2 = await checkRateLimit({
      endpoint: '/api/chat',
      clientIp: testIp,
      limit: 2,
      windowSeconds: 10,
      redisClient: client,
    });

    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.current, 2);
    assert.strictEqual(res2.remaining, 0);

    // 3rd request should be blocked by rate limit
    const res3 = await checkRateLimit({
      endpoint: '/api/chat',
      clientIp: testIp,
      limit: 2,
      windowSeconds: 10,
      redisClient: client,
    });

    assert.strictEqual(res3.allowed, false);
    assert.strictEqual(res3.current, 3);
    assert.strictEqual(res3.remaining, 0);
  } finally {
    await client.del(`ratelimit:/api/chat:${testIp}`);
    client.close();
  }
});

test('checkRateLimit gracefully falls back to in-memory store if Redis is absent', async () => {
  const testIp = `test-mem-ip-${Date.now()}`;

  const res1 = await checkRateLimit({
    endpoint: '/api/test',
    clientIp: testIp,
    limit: 1,
    windowSeconds: 5,
    redisClient: null,
  });

  assert.strictEqual(res1.allowed, true);
  assert.strictEqual(res1.current, 1);
  assert.strictEqual(res1.source, 'memory-fallback');

  const res2 = await checkRateLimit({
    endpoint: '/api/test',
    clientIp: testIp,
    limit: 1,
    windowSeconds: 5,
    redisClient: null,
  });

  assert.strictEqual(res2.allowed, false);
  assert.strictEqual(res2.current, 2);
});

test('handleChatRequest returns 429 when rate limit is exceeded', async () => {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/chat';
  req.headers = { 'x-forwarded-for': '203.0.113.199' };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(key, val) {
      this.headers[key] = val;
    },
    write(chunk) {
      this.body += chunk;
    },
    end(chunk = '') {
      if (chunk) this.write(chunk);
      this.ended = true;
    },
  };

  process.nextTick(() => {
    req.emit('data', JSON.stringify({ messages: [{ text: 'hi' }] }));
    req.emit('end');
  });

  // Limit = 0 enforces immediate 429
  await handleChatRequest(req, res, {
    RATE_LIMIT: 0,
    OPENROUTER_API_KEY: 'sk-or-dummy',
  });

  assert.strictEqual(res.statusCode, 429);
  assert(res.headers['Retry-After']);
  const parsed = JSON.parse(res.body);
  assert(parsed.error.message.includes('Rate limit exceeded'));
});

test('RedisClient executes set, get, hincrby, and ttl commands', async () => {
  const client = new RedisClient(REDIS_URL);
  client.connect();

  const key = `test:kv:${Date.now()}`;
  try {
    const setRes = await client.set(key, 'hello-world');
    assert.strictEqual(setRes, 'OK');

    const getRes = await client.get(key);
    assert.strictEqual(getRes, 'hello-world');

    await client.expire(key, 30);
    const ttlRes = await client.ttl(key);
    assert(ttlRes > 0 && ttlRes <= 30);

    const hashKey = `test:hash:${Date.now()}`;
    const h1 = await client.hincrby(hashKey, 'counter', 5);
    assert.strictEqual(h1, 5);
    const h2 = await client.hincrby(hashKey, 'counter', 3);
    assert.strictEqual(h2, 8);
    await client.del(hashKey);
  } finally {
    await client.del(key);
    client.close();
  }
});

test('High-Volume: 50 concurrent requests are processed atomically via Redis without DB contention', async () => {
  const client = new RedisClient(REDIS_URL);
  client.connect();

  const burstIp = `burst-ip-${Date.now()}`;
  const key = `ratelimit:/api/chat:${burstIp}`;
  const limit = 20;

  try {
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        checkRateLimit({
          endpoint: '/api/chat',
          clientIp: burstIp,
          limit,
          windowSeconds: 30,
          redisClient: client,
        })
      );
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 50);

    const allowed = results.filter(r => r.allowed);
    const blocked = results.filter(r => !r.allowed);

    assert.strictEqual(allowed.length, limit, `Expected exactly ${limit} allowed requests`);
    assert.strictEqual(blocked.length, 50 - limit, `Expected exactly ${50 - limit} blocked requests`);

    const currentCounts = results.map(r => r.current).sort((a, b) => a - b);
    const uniqueCounts = new Set(currentCounts);
    assert.strictEqual(uniqueCounts.size, 50, 'All 50 concurrent requests must receive unique sequential counts');
    assert.strictEqual(currentCounts[0], 1);
    assert.strictEqual(currentCounts[49], 50);
  } finally {
    await client.del(key);
    client.close();
  }
});

test('getEndpointConfig fetches authoritative DB policy and caches in Redis with zero DB queries on hot path', async () => {
  const { getEndpointConfig, recordRequestMetric } = await import('../server/rateLimiter.js');
  const client = new RedisClient(REDIS_URL);
  client.connect();

  const configKey = 'ratelimit:config:/api/chat';
  try {
    // Clean cache to start fresh
    await client.del(configKey);

    const config1 = await getEndpointConfig('/api/chat', { redisClient: client });
    assert.strictEqual(typeof config1.rateLimitPerIp, 'number');
    assert.strictEqual(config1.rateLimitPerIp, 120);
    assert.strictEqual(config1.windowSeconds, 60);

    // Verify it is now cached in Redis
    const cached = await client.get(configKey);
    assert(cached, 'Policy should be cached in Redis');
    const parsedCache = JSON.parse(cached);
    assert.strictEqual(parsedCache.rateLimitPerIp, 120);

    // Second call reads purely from Redis cache without querying DB
    const config2 = await getEndpointConfig('/api/chat', { redisClient: client, databaseUrl: null });
    assert.deepStrictEqual(config2, config1);

    // Test recordRequestMetric in Redis
    const testIp = '198.51.100.1';
    await recordRequestMetric(testIp, '/api/chat', { redisClient: client });
    const today = new Date().toISOString().slice(0, 10);
    const metricsKey = `ratelimit:metrics:${today}`;
    const stats = await client.hgetall(metricsKey);
    assert(stats, 'Redis metrics hash should exist');
    await client.del(metricsKey);
  } finally {
    await client.del(configKey);
    client.close();
  }
});

test('setConversationProvider and getConversationProvider cache provider in Redis atomically', async () => {
  const {
    getConversationProvider,
    setConversationProvider,
    clearConversationProvider,
  } = await import('../server/providerCache.js');
  const client = new RedisClient(REDIS_URL);
  client.connect();

  const conversationId = `convo-test-${Date.now()}`;
  try {
    // 1. Initial state is null
    const initial = await getConversationProvider(conversationId, { redisClient: client });
    assert.strictEqual(initial, null);

    // 2. Set provider
    const saved = await setConversationProvider(conversationId, 'Google', { redisClient: client, ttlSeconds: 60 });
    assert.strictEqual(saved, 'google');

    // 3. Read back from Redis
    const cached = await getConversationProvider(conversationId, { redisClient: client });
    assert.strictEqual(cached, 'google');

    // 4. Verify directly in Redis key
    const rawVal = await client.get(`teach4all:convo:provider:${conversationId}`);
    assert.strictEqual(rawVal, 'google');

    // 5. Clear provider
    await clearConversationProvider(conversationId, { redisClient: client });
    const afterClear = await getConversationProvider(conversationId, { redisClient: client });
    assert.strictEqual(afterClear, null);
  } finally {
    await clearConversationProvider(conversationId, { redisClient: client });
    client.close();
  }
});

test('getClientIp properly resolves Vercel edge IP forwarding and prevents spoofing', () => {
  // Priority: x-vercel-forwarded-for overrides spoofed x-forwarded-for
  const req1 = {
    headers: {
      'x-vercel-forwarded-for': '198.51.100.42, 10.0.0.1',
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '1.2.3.4',
    },
  };
  assert.strictEqual(getClientIp(req1), '198.51.100.42');

  // IPv6 mapped IPv4 normalization
  const req2 = {
    headers: {},
    socket: { remoteAddress: '::ffff:203.0.113.88' },
  };
  assert.strictEqual(getClientIp(req2), '203.0.113.88');

  // Location resolution from Vercel edge headers
  const req3 = {
    headers: {
      'x-vercel-ip-country': 'ID',
      'x-vercel-ip-city': 'Jakarta',
      'x-vercel-ip-country-region': 'JK',
    },
  };
  const loc = getClientLocation(req3);
  assert.strictEqual(loc.country, 'ID');
  assert.strictEqual(loc.city, 'Jakarta');
});

test('GrafanaMetrics records requests, handles Redis fan-out, and formats OTLP metrics', async () => {
  const { GrafanaMetrics, parseMetricKey, toOtlpMetricAttributes } = await import('../server/metrics.js');

  const parsed = parseMetricKey('http_requests_total{endpoint=/api/chat,status=200,method=POST}');
  assert.strictEqual(parsed.name, 'http_requests_total');
  assert.strictEqual(parsed.attributes.endpoint, '/api/chat');
  assert.strictEqual(parsed.attributes.status, '200');

  const attrs = toOtlpMetricAttributes({ endpoint: '/api/chat', count: 5 });
  assert.strictEqual(attrs.length, 2);
  assert.strictEqual(attrs[0].key, 'endpoint');
  assert.strictEqual(attrs[0].value.stringValue, '/api/chat');

  const client = new RedisClient(REDIS_URL);
  client.connect();

  const metricsInst = new GrafanaMetrics({
    redisClient: client,
    forceSendInTest: false,
  });

  try {
    metricsInst.recordHttpRequest({
      endpoint: '/api/test-metrics',
      method: 'POST',
      status: 200,
      durationMs: 45,
    });

    metricsInst.recordStreamMetric({
      chunks: 5,
      bytes: 250,
      model: 'test-model',
      durationMs: 120,
    });

    metricsInst.recordRateLimitHit({ endpoint: '/api/test-metrics' });
    metricsInst.recordClientError({ type: 'unit_test_err', path: '/test' });

    assert(metricsInst.localDataPoints.length >= 4);

    // Verify atomic increment in Redis for fanning out
    const hash = await client.hgetall('teach4all:metrics:counters');
    assert(hash, 'Redis counters hash should exist');
  } finally {
    client.close();
  }
});


