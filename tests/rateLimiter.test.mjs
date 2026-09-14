import test from 'node:test';
import assert from 'node:assert';
import {
  checkRateLimit,
  getClientIp,
  getClientLocation,
  applyRateLimitHeaders,
  getEndpointConfig,
  clearRateLimitStore,
} from '../server/rateLimiter.js';
import {
  getConversationProvider,
  setConversationProvider,
  clearConversationProvider,
} from '../server/providerCache.js';
import { handleChatRequest } from '../server/chatApi.js';
import { EventEmitter } from 'node:events';

test('checkRateLimit accurately tracks request counts and window TTL in memory without DB writes', async () => {
  clearRateLimitStore();
  const testIp = `test-ip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const res1 = await checkRateLimit({
    endpoint: '/api/chat',
    clientIp: testIp,
    limit: 2,
    windowSeconds: 10,
  });

  assert.strictEqual(res1.allowed, true);
  assert.strictEqual(res1.current, 1);
  assert.strictEqual(res1.remaining, 1);
  assert.strictEqual(res1.source, 'memory');

  const res2 = await checkRateLimit({
    endpoint: '/api/chat',
    clientIp: testIp,
    limit: 2,
    windowSeconds: 10,
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
  });

  assert.strictEqual(res3.allowed, false);
  assert.strictEqual(res3.current, 3);
  assert.strictEqual(res3.remaining, 0);
});

test('handleChatRequest returns 429 when in-memory rate limit is exceeded', async () => {
  clearRateLimitStore();
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/chat';
  const testIp = `test-chat-429-${Date.now()}`;
  req.headers = { 'x-forwarded-for': testIp };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(data = '') {
      this.body = data;
      this.ended = true;
    },
  };

  // Exhaust rate limit with limit = 1
  await handleChatRequest(req, res, { RATE_LIMIT: 1, WINDOW_SECONDS: 60 });
  assert.strictEqual(res.statusCode, 503); // because no API key configured, but allowed through rate limiter

  // Second request exceeds rate limit (limit=1)
  const res2 = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(data = '') {
      this.body = data;
      this.ended = true;
    },
  };

  await handleChatRequest(req, res2, { RATE_LIMIT: 1, WINDOW_SECONDS: 60 });
  assert.strictEqual(res2.statusCode, 429);
  assert(res2.headers['Retry-After']);
  const parsed = JSON.parse(res2.body);
  assert(parsed.error && parsed.error.message.includes('Rate limit exceeded'));
});

test('High-Volume: 50 concurrent requests are processed cleanly in memory', async () => {
  clearRateLimitStore();
  const burstIp = `burst-ip-${Date.now()}`;
  const limit = 20;

  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(
      checkRateLimit({
        endpoint: '/api/chat',
        clientIp: burstIp,
        limit,
        windowSeconds: 30,
      })
    );
  }

  const results = await Promise.all(promises);
  assert.strictEqual(results.length, 50);

  const allowed = results.filter(r => r.allowed);
  const blocked = results.filter(r => !r.allowed);

  assert.strictEqual(allowed.length, limit, `Expected exactly ${limit} allowed requests`);
  assert.strictEqual(blocked.length, 50 - limit, `Expected exactly ${50 - limit} blocked requests`);
});

test('getEndpointConfig caches policy in memory without DB round-trips', async () => {
  clearRateLimitStore();
  const config1 = await getEndpointConfig('/api/chat', { databaseUrl: null });
  assert.strictEqual(typeof config1.rateLimitPerIp, 'number');
  assert.strictEqual(config1.rateLimitPerIp, 120);
  assert.strictEqual(config1.windowSeconds, 60);

  const config2 = await getEndpointConfig('/api/chat', { databaseUrl: null });
  assert.deepStrictEqual(config2, config1);
});

test('setConversationProvider and getConversationProvider cache provider in memory', async () => {
  const conversationId = `convo-test-${Date.now()}`;

  // 1. Initial state is null
  const initial = await getConversationProvider(conversationId);
  assert.strictEqual(initial, null);

  // 2. Set provider
  const saved = await setConversationProvider(conversationId, 'Google', { ttlSeconds: 60 });
  assert.strictEqual(saved, 'google');

  // 3. Read back from memory
  const cached = await getConversationProvider(conversationId);
  assert.strictEqual(cached, 'google');

  // 4. Clear provider
  await clearConversationProvider(conversationId);
  const afterClear = await getConversationProvider(conversationId);
  assert.strictEqual(afterClear, null);
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
