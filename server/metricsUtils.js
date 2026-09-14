import { getClientIp } from './rateLimiter.js';

/**
 * Convert key-value object into OpenTelemetry attribute list.
 */
export function toOtlpMetricAttributes(attrs = {}) {
  return Object.entries(attrs)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, value]) => ({
      key,
      value: {
        stringValue: String(value),
      },
    }));
}

/**
 * Parse compact metric key with tags, e.g.
 * "http_requests_total{endpoint=/api/chat,status=200,method=POST}"
 */
export function parseMetricKey(rawKey) {
  const match = rawKey.match(/^([^{]+)(?:\{([^}]+)\})?$/);
  if (!match) return { name: rawKey, attributes: {} };

  const name = match[1];
  const tagStr = match[2];
  const attributes = {};

  if (tagStr) {
    for (const pair of tagStr.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx !== -1) {
        const k = pair.slice(0, eqIdx).trim();
        const v = pair.slice(eqIdx + 1).trim();
        attributes[k] = v;
      }
    }
  }

  return { name, attributes };
}

/**
 * Classify user-agent into a low-cardinality category to prevent label explosion.
 */
export function classifyUserAgent(ua = '') {
  if (!ua || typeof ua !== 'string') return 'unknown';
  const lower = ua.toLowerCase();
  if (lower.includes('bot') || lower.includes('crawl') || lower.includes('spider') || lower.includes('slurp')) {
    return 'bot';
  }
  if (lower.includes('curl') || lower.includes('wget') || lower.includes('httpie') || lower.includes('postman')) {
    return 'tool';
  }
  if (lower.includes('mozilla') || lower.includes('chrome') || lower.includes('safari') || lower.includes('firefox') || lower.includes('edge')) {
    return 'browser';
  }
  return 'other';
}

/**
 * Compute percentile from a sorted array of numbers.
 */
export function calculatePercentile(sortedValues, percentile = 95) {
  if (!sortedValues || sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

/**
 * Extract comprehensive request and error metadata from parameters or request/response objects.
 */
export function extractRequestMetadata({
  endpoint = '/api/chat',
  method = 'GET',
  status = 200,
  durationMs = 0,
  req = null,
  res = null,
  clientIp = null,
  country = null,
  userAgent = null,
  requestBytes = 0,
  responseBytes = 0,
} = {}) {
  const resolvedMethod = (req?.method || method || 'GET').toUpperCase();
  const rawUrl = req?.url || endpoint || '/api/chat';
  const cleanEndpoint = (rawUrl.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const statusCode = Number(res?.statusCode || status) || 200;
  const statusStr = String(statusCode);
  const statusClass = `${Math.floor(statusCode / 100)}xx`;

  const isError = statusCode >= 400;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const isServerError = statusCode >= 500;

  let errorType = 'none';
  if (statusCode === 429) {
    errorType = 'rate_limited';
  } else if (isServerError) {
    errorType = 'server_error';
  } else if (isClientError) {
    errorType = 'client_error';
  }

  const resolvedCountry =
    country ||
    req?.headers?.['x-vercel-ip-country'] ||
    req?.headers?.['cf-ipcountry'] ||
    'unknown';

  const resolvedIp = clientIp || (req ? getClientIp(req) : 'unknown');
  const resolvedUa = userAgent || req?.headers?.['user-agent'] || '';
  const clientCategory = classifyUserAgent(resolvedUa);

  const reqBytes =
    Number(requestBytes) ||
    parseInt(req?.headers?.['content-length'] || '0', 10) ||
    0;

  const resBytes =
    Number(responseBytes) ||
    parseInt(res?.getHeader?.('content-length') || res?.getHeader?.('Content-Length') || '0', 10) ||
    0;

  const duration = Math.max(0, Number(durationMs) || 0);

  return {
    endpoint: cleanEndpoint,
    method: resolvedMethod,
    status: statusCode,
    statusStr,
    statusClass,
    isError,
    isClientError,
    isServerError,
    errorType,
    durationMs: duration,
    country: resolvedCountry,
    clientIp: resolvedIp,
    clientCategory,
    requestBytes: reqBytes,
    responseBytes: resBytes,
  };
}

/**
 * Increment in-memory cumulative and rate window counters.
 */
export function recordCumulativeMetrics(meta, activeEnv, inMemoryCounters, inMemoryRateBuckets) {
  if (inMemoryCounters && typeof inMemoryCounters.set === 'function') {
    const incr = (field, val = 1) => {
      inMemoryCounters.set(field, (inMemoryCounters.get(field) || 0) + val);
    };
    incr(`http_requests_total{endpoint=${meta.endpoint},method=${meta.method},status=${meta.statusStr},status_class=${meta.statusClass},env=${activeEnv}}`);
    if (meta.isError) {
      incr(`http_requests_errors_total{endpoint=${meta.endpoint},status=${meta.statusStr},error_type=${meta.errorType},env=${activeEnv}}`);
    }
    if (meta.isClientError) {
      incr(`http_requests_client_errors_total{endpoint=${meta.endpoint},status=${meta.statusStr},env=${activeEnv}}`);
    }
    if (meta.isServerError) {
      incr(`http_requests_server_errors_total{endpoint=${meta.endpoint},status=${meta.statusStr},env=${activeEnv}}`);
    }
    if (!meta.isError) {
      incr(`http_requests_success_total{endpoint=${meta.endpoint},method=${meta.method},env=${activeEnv}}`);
    }
    if (meta.country && meta.country !== 'unknown') {
      incr(`http_requests_by_country_total{country=${meta.country},env=${activeEnv}}`);
    }
    if (meta.requestBytes > 0) {
      incr(`http_request_bytes_total{endpoint=${meta.endpoint},env=${activeEnv}}`, meta.requestBytes);
    }
    if (meta.responseBytes > 0) {
      incr(`http_response_bytes_total{endpoint=${meta.endpoint},env=${activeEnv}}`, meta.responseBytes);
    }
    if (inMemoryRateBuckets && typeof inMemoryRateBuckets.set === 'function') {
      const minuteBucket = Math.floor(Date.now() / 60000);
      let bucket = inMemoryRateBuckets.get(minuteBucket);
      if (!bucket) {
        bucket = {};
        inMemoryRateBuckets.set(minuteBucket, bucket);
      }
      bucket.total = (bucket.total || 0) + 1;
      if (meta.isError) bucket.errors = (bucket.errors || 0) + 1;
      if (meta.isClientError) bucket.errors_4xx = (bucket.errors_4xx || 0) + 1;
      if (meta.isServerError) bucket.errors_5xx = (bucket.errors_5xx || 0) + 1;
      bucket[`ep:${meta.endpoint}:total`] = (bucket[`ep:${meta.endpoint}:total`] || 0) + 1;
      if (meta.isError) bucket[`ep:${meta.endpoint}:errors`] = (bucket[`ep:${meta.endpoint}:errors`] || 0) + 1;
    }
  }
}

/**
 * Backward compatible wrapper for recordCumulativeMetrics.
 */
export function recordRedisMetrics(redis, meta, activeEnv, options = {}, inMemoryCounters = null, inMemoryRateBuckets = null) {
  if (redis && redis instanceof Map) {
    recordCumulativeMetrics(meta, activeEnv, redis, options);
    return;
  }
  recordCumulativeMetrics(meta, activeEnv, inMemoryCounters, inMemoryRateBuckets);
}

/**
 * Manages in-memory sliding window statistics and concurrency tracking.
 */
export class MetricsWindowTracker {
  constructor() {
    this.activeRequests = 0;
    this.activeByEndpoint = new Map();
    this.resetWindow();
  }

  resetWindow() {
    this.windowStart = Date.now();
    this.requestCount = 0;
    this.errorCount = 0;
    this.clientErrorCount = 0;
    this.serverErrorCount = 0;
    this.durationSum = 0;
    this.durations = [];
    this.requestBytesSum = 0;
    this.responseBytesSum = 0;
    this.endpointStats = new Map();
  }

  startRequest(endpoint = '/') {
    const cleanEndpoint = (endpoint.split('?')[0] || '/').replace(/\/+$/, '') || '/';
    this.activeRequests = Math.max(0, this.activeRequests + 1);
    this.activeByEndpoint.set(
      cleanEndpoint,
      (this.activeByEndpoint.get(cleanEndpoint) || 0) + 1
    );

    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      const current = this.activeByEndpoint.get(cleanEndpoint) || 1;
      if (current <= 1) {
        this.activeByEndpoint.delete(cleanEndpoint);
      } else {
        this.activeByEndpoint.set(cleanEndpoint, current - 1);
      }
    };
  }

  recordRequest(meta) {
    this.requestCount += 1;
    this.durationSum += meta.durationMs;
    if (this.durations.length < 500) {
      this.durations.push(meta.durationMs);
    }
    this.requestBytesSum += meta.requestBytes;
    this.responseBytesSum += meta.responseBytes;

    if (meta.isError) this.errorCount += 1;
    if (meta.isClientError) this.clientErrorCount += 1;
    if (meta.isServerError) this.serverErrorCount += 1;

    if (!this.endpointStats.has(meta.endpoint)) {
      this.endpointStats.set(meta.endpoint, { count: 0, errors: 0, clientErrors: 0, serverErrors: 0 });
    }
    const ep = this.endpointStats.get(meta.endpoint);
    ep.count += 1;
    if (meta.isError) ep.errors += 1;
    if (meta.isClientError) ep.clientErrors += 1;
    if (meta.isServerError) ep.serverErrors += 1;
  }

  computeWindowStats(now = Date.now()) {
    const elapsedSec = Math.max((now - this.windowStart) / 1000, 0.001);
    const count = this.requestCount;
    const errors = this.errorCount;
    const clientErrors = this.clientErrorCount;
    const serverErrors = this.serverErrorCount;

    const requestRatePerSec = count / elapsedSec;
    const requestRatePerMin = (count / elapsedSec) * 60;
    const errorRatePercentage = count > 0 ? (errors / count) * 100 : 0;
    const errorRateRatio = count > 0 ? errors / count : 0;
    const clientErrorRatePercentage = count > 0 ? (clientErrors / count) * 100 : 0;
    const serverErrorRatePercentage = count > 0 ? (serverErrors / count) * 100 : 0;

    const sortedDurations = [...this.durations].sort((a, b) => a - b);
    const durationAvgMs = count > 0 ? this.durationSum / count : 0;
    const durationMinMs = sortedDurations.length ? sortedDurations[0] : 0;
    const durationMaxMs = sortedDurations.length ? sortedDurations[sortedDurations.length - 1] : 0;
    const durationP95Ms = calculatePercentile(sortedDurations, 95);

    const endpoints = {};
    for (const [ep, data] of this.endpointStats.entries()) {
      endpoints[ep] = {
        count: data.count,
        errors: data.errors,
        requestRatePerSec: data.count / elapsedSec,
        errorRatePercentage: data.count > 0 ? (data.errors / data.count) * 100 : 0,
      };
    }

    return {
      count,
      errors,
      clientErrors,
      serverErrors,
      requestRatePerSec,
      requestRatePerMin,
      errorRatePercentage,
      errorRateRatio,
      clientErrorRatePercentage,
      serverErrorRatePercentage,
      durationAvgMs,
      durationMinMs,
      durationMaxMs,
      durationP95Ms,
      requestBytesAvg: count > 0 ? this.requestBytesSum / count : 0,
      endpoints,
      activeRequests: this.activeRequests,
    };
  }
}
