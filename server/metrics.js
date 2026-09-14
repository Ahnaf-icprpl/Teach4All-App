import crypto from 'node:crypto';
import client from 'prom-client';

// Initialize default system and Node.js process metrics
client.collectDefaultMetrics({
  register: client.register,
  timeout: 5000,
});

// Custom HTTP request counter
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed by the server',
  labelNames: ['method', 'route', 'status_code'],
});

// Custom HTTP request duration histogram
export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// In-flight HTTP requests gauge
export const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Current number of active in-flight HTTP requests',
  labelNames: ['method'],
});

/**
 * Normalizes URL path to reduce metric cardinality.
 */
export function normalizeMetricRoute(path = '/') {
  if (!path || typeof path !== 'string') return '/';
  const clean = path.split('?')[0];

  return clean
    .replace(/\/[0-9a-fA-F-]{36}(?=\/|$)/g, '/:uuid')
    .replace(/\/guest_[a-zA-Z0-9_-]+(?=\/|$)/g, '/:guestId')
    .replace(/\/user_[a-zA-Z0-9_-]+(?=\/|$)/g, '/:userId')
    .replace(/\/sess_[a-zA-Z0-9_-]+(?=\/|$)/g, '/:sessionId')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeCompare(a = '', b = '') {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Retrieves configured metrics credentials from environment.
 */
export function getMetricsCredentials(serverEnv = {}) {
  const token = (
    serverEnv.PROMETHEUS_METRICS_TOKEN ||
    serverEnv.METRICS_TOKEN ||
    serverEnv.METRICS_BEARER_TOKEN ||
    process.env.PROMETHEUS_METRICS_TOKEN ||
    process.env.METRICS_TOKEN ||
    process.env.METRICS_BEARER_TOKEN ||
    ''
  ).trim();

  const username = (
    serverEnv.PROMETHEUS_METRICS_USER ||
    serverEnv.METRICS_USER ||
    process.env.PROMETHEUS_METRICS_USER ||
    process.env.METRICS_USER ||
    ''
  ).trim();

  const password = (
    serverEnv.PROMETHEUS_METRICS_PASSWORD ||
    serverEnv.METRICS_PASSWORD ||
    serverEnv.METRICS_PASS ||
    process.env.PROMETHEUS_METRICS_PASSWORD ||
    process.env.METRICS_PASSWORD ||
    process.env.METRICS_PASS ||
    ''
  ).trim();

  return { token, username, password };
}

/**
 * Verifies request authentication against credentials in environment.
 */
export function verifyMetricsAuth(req, serverEnv = {}) {
  const creds = getMetricsCredentials(serverEnv);
  const hasTokenConfig = Boolean(creds.token);
  const hasBasicConfig = Boolean(creds.username && creds.password);

  // If no credentials are configured
  if (!hasTokenConfig && !hasBasicConfig) {
    const isProd = (serverEnv.ENV || serverEnv.env || process.env.ENV || process.env.NODE_ENV) === 'production';
    if (!isProd) return true; // Allow in development
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';

  // 1. Check Bearer Token
  if (hasTokenConfig) {
    if (authHeader.startsWith('Bearer ')) {
      const incomingToken = authHeader.slice(7).trim();
      if (timingSafeCompare(incomingToken, creds.token)) return true;
    }
    const xToken = req.headers?.['x-metrics-token'] || req.headers?.['x-prometheus-token'];
    if (typeof xToken === 'string' && timingSafeCompare(xToken.trim(), creds.token)) {
      return true;
    }
  }

  // 2. Check HTTP Basic Authentication
  if (hasBasicConfig && authHeader.startsWith('Basic ')) {
    try {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx !== -1) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        if (timingSafeCompare(u, creds.username) && timingSafeCompare(p, creds.password)) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

/**
 * Express middleware to record in-flight requests, counts, and response latency.
 */
export function metricsMiddleware(req, res, next) {
  const method = req.method || 'GET';
  httpRequestsInFlight.inc({ method });

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    httpRequestsInFlight.dec({ method });

    const endTime = process.hrtime.bigint();
    const durationSec = Number(endTime - startTime) / 1e9;
    const route = normalizeMetricRoute(req.baseUrl ? `${req.baseUrl}${req.path}` : (req.originalUrl || req.url || '/'));
    const statusCode = String(res.statusCode || 200);

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationSec);
  });

  next();
}

/**
 * Handler for GET /metrics endpoint.
 */
export async function handleMetricsRequest(req, res, serverEnv = {}) {
  if (!verifyMetricsAuth(req, serverEnv)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Prometheus Metrics", Bearer error="invalid_token"');
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).send('# 401 Unauthorized: Invalid or missing metrics credentials.\n');
    return;
  }

  try {
    res.setHeader('Content-Type', client.register.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const metricsData = await client.register.metrics();
    res.send(metricsData);
  } catch (err) {
    res.status(500).type('text/plain').send(`# Error collecting metrics: ${err.message}\n`);
  }
}
