import { metrics } from '@opentelemetry/api';
import { enforceRateLimit } from './rateLimiter.js';

const meter = metrics.getMeter('teach4all');

/**
 * OpenTelemetry Counter for total HTTP requests.
 */
export const httpRequestsTotal = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests processed by the server',
});

/**
 * OpenTelemetry Histogram for HTTP request duration in seconds.
 */
export const httpRequestDurationSeconds = meter.createHistogram('http_request_duration_seconds', {
  description: 'Duration of HTTP requests in seconds',
  unit: 's',
});

/**
 * OpenTelemetry UpDownCounter for currently active in-flight HTTP requests.
 */
export const httpRequestsInFlight = meter.createUpDownCounter('http_requests_in_flight', {
  description: 'Current number of active in-flight HTTP requests',
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
 * Express middleware to record in-flight requests, counts, and response latency via OTLP metrics.
 */
export function metricsMiddleware(req, res, next) {
  const method = req.method || 'GET';
  httpRequestsInFlight.add(1, { method });

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    httpRequestsInFlight.add(-1, { method });

    const endTime = process.hrtime.bigint();
    const durationSec = Number(endTime - startTime) / 1e9;
    const route = normalizeMetricRoute(req.baseUrl ? `${req.baseUrl}${req.path}` : (req.originalUrl || req.url || '/'));
    const statusCode = String(res.statusCode || 200);

    httpRequestsTotal.add(1, { method, route, status_code: statusCode });
    httpRequestDurationSeconds.record(durationSec, { method, route, status_code: statusCode });
  });

  next();
}

/**
 * Handler for GET /metrics endpoint.
 * Enforces rate limiting and reports OTLP metrics export status.
 */
export async function handleMetricsRequest(req, res, serverEnv = {}) {
  if (!(await enforceRateLimit(req, res, '/metrics', serverEnv))) {
    return;
  }

  const message = '# OpenTelemetry metrics active. Metrics are exported via OTLP gateway.\n';
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  if (typeof res.status === 'function') {
    res.status(200).send(message);
  } else if (typeof res.writeHead === 'function') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(message);
  } else if (typeof res.end === 'function') {
    res.end(message);
  }
}

export default metricsMiddleware;

