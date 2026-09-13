import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getRedisClient } from './redis.js';
import { getActiveEnv } from './logger.js';
import {
  toOtlpMetricAttributes,
  parseMetricKey,
  extractRequestMetadata,
  recordRedisMetrics,
  MetricsWindowTracker,
} from './metricsUtils.js';
import {
  formatLocalMetrics,
  formatRedisMetrics,
  recordCalculatedGauges,
  buildOtlpResourcePayload,
} from './metricsFormatter.js';

export { toOtlpMetricAttributes, parseMetricKey };

try {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key.startsWith('GRAFANA_') && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch {}

export const DEFAULT_METRICS_INSTANCE_ID = '1828340';
export const DEFAULT_METRICS_API_KEY = process.env.GRAFANA_METRICS_API_KEY || '';
export const DEFAULT_METRICS_URL =
  process.env.GRAFANA_METRICS_URL ||
  'https://otlp-gateway-prod-ap-southeast-2.grafana.net/otlp/v1/metrics';
export const DEFAULT_SERVICE_NAME = 'teach4all';

const REDIS_METRICS_KEY = 'teach4all:metrics:counters';
const REDIS_RATE_PREFIX = 'teach4all:metrics:rate:';

export class GrafanaMetrics {
  constructor({
    instanceId = process.env.GRAFANA_METRICS_INSTANCE_ID || process.env.GRAFANA_INSTANCE_ID || DEFAULT_METRICS_INSTANCE_ID,
    apiKey = process.env.GRAFANA_METRICS_API_KEY || DEFAULT_METRICS_API_KEY,
    metricsUrl = process.env.GRAFANA_METRICS_URL || DEFAULT_METRICS_URL,
    serviceName = process.env.GRAFANA_SERVICE_NAME || DEFAULT_SERVICE_NAME,
    redisUrl = process.env.REDIS_URL,
    redisClient = null,
    flushIntervalMs = 5000,
    forceSendInTest = false,
  } = {}) {
    this.instanceId = instanceId;
    this.apiKey = apiKey;
    this.metricsUrl = metricsUrl;
    this.serviceName = serviceName;
    this.redisUrl = redisUrl;
    this.redisClient = redisClient;
    this.flushIntervalMs = flushIntervalMs;
    this.forceSendInTest = forceSendInTest;

    this.localDataPoints = [];
    this.flushTimer = null;
    this.flushing = false;
    this.windowTracker = new MetricsWindowTracker();
  }

  get env() {
    return getActiveEnv();
  }

  getRedis() {
    if (this.redisClient) return this.redisClient;
    return getRedisClient(this.redisUrl);
  }

  /**
   * Track concurrent in-flight request lifecycle.
   */
  startRequest({ endpoint = '/', method = 'GET', req = null } = {}) {
    const rawUrl = req?.url || endpoint || '/';
    const cleanEndpoint = (rawUrl.split('?')[0] || '/').replace(/\/+$/, '') || '/';
    const endWindow = this.windowTracker.startRequest(cleanEndpoint);

    this.record('http_active_requests', this.windowTracker.activeRequests, {
      unit: '1',
      description: 'Concurrent active in-flight HTTP requests',
      attributes: { endpoint: cleanEndpoint },
    });

    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      endWindow();
      this.record('http_active_requests', this.windowTracker.activeRequests, {
        unit: '1',
        description: 'Concurrent active in-flight HTTP requests',
        attributes: { endpoint: cleanEndpoint },
      });
    };
  }

  /**
   * Enqueue a local instantaneous metric (e.g. latency gauge).
   */
  record(name, value, { unit = '1', description = '', attributes = {} } = {}) {
    const timeUnixNano = String(BigInt(Date.now()) * 1000000n);
    const num = Number(value);
    const isInteger = Number.isInteger(num);

    const point = {
      name,
      unit,
      description,
      timeUnixNano,
      value: num,
      isInteger,
      attributes: {
        ...attributes,
        env: attributes.env || this.env,
      },
    };

    this.localDataPoints.push(point);
    this.scheduleFlush();
  }

  /**
   * Record HTTP request count, errors, error rate, latency, and data sizes.
   * Atomically increments Redis hash to handle Vercel serverless fan-out across lambdas.
   */
  recordHttpRequest(options = {}) {
    const meta = extractRequestMetadata(options);

    // 1. Record into window tracker for local rate & error calculations
    this.windowTracker.recordRequest(meta);

    // 2. Record atomic counters in Redis across fanned-out instances
    recordRedisMetrics(this.getRedis(), meta, this.env, {
      metricsKey: REDIS_METRICS_KEY,
      ratePrefix: REDIS_RATE_PREFIX,
    });

    // 3. Record instantaneous latency gauge in local memory
    if (meta.durationMs > 0) {
      this.record('http_request_duration_ms', meta.durationMs, {
        unit: 'ms',
        description: 'Duration of HTTP requests in milliseconds',
        attributes: {
          endpoint: meta.endpoint,
          method: meta.method,
          status: meta.statusStr,
          status_class: meta.statusClass,
          is_error: String(meta.isError),
          error_type: meta.errorType,
        },
      });
    }

    // 4. Record single HTTP request hit event with rich request info
    const reqAttrs = {
      endpoint: meta.endpoint,
      method: meta.method,
      status: meta.statusStr,
      status_class: meta.statusClass,
      is_error: String(meta.isError),
      error_type: meta.errorType,
      client_category: meta.clientCategory,
    };
    if (meta.country && meta.country !== 'unknown') {
      reqAttrs.country = meta.country;
    }
    this.record('http_requests_count', 1, {
      unit: '1',
      description: 'Single HTTP request event',
      attributes: reqAttrs,
    });

    // 5. Record error event if request resulted in error
    if (meta.isError) {
      this.record('http_request_errors', 1, {
        unit: '1',
        description: 'Single HTTP error event',
        attributes: {
          endpoint: meta.endpoint,
          method: meta.method,
          status: meta.statusStr,
          status_class: meta.statusClass,
          error_type: meta.errorType,
        },
      });
    }

    // 6. Record payload sizes if available
    if (meta.requestBytes > 0) {
      this.record('http_request_bytes', meta.requestBytes, {
        unit: 'By',
        description: 'Incoming HTTP request payload size in bytes',
        attributes: { endpoint: meta.endpoint, method: meta.method },
      });
    }
    if (meta.responseBytes > 0) {
      this.record('http_response_bytes', meta.responseBytes, {
        unit: 'By',
        description: 'Outgoing HTTP response payload size in bytes',
        attributes: { endpoint: meta.endpoint, method: meta.method },
      });
    }
  }

  /**
   * Record chat completion streaming metrics (chunks and bytes transferred).
   */
  recordStreamMetric({ chunks = 0, bytes = 0, model = 'default', durationMs = 0 }) {
    const redis = this.getRedis();
    const activeEnv = this.env;

    if (redis) {
      if (chunks > 0) {
        redis.hincrby(REDIS_METRICS_KEY, `chat_stream_chunks_total{model=${model},env=${activeEnv}}`, chunks).catch(() => {});
      }
      if (bytes > 0) {
        redis.hincrby(REDIS_METRICS_KEY, `chat_stream_bytes_total{model=${model},env=${activeEnv}}`, bytes).catch(() => {});
      }
    }

    if (chunks > 0) {
      this.record('chat_stream_chunks', chunks, {
        unit: '1',
        description: 'Stream chunks delivered in chat completion',
        attributes: { model },
      });
    }

    if (bytes > 0) {
      this.record('chat_stream_bytes', bytes, {
        unit: 'By',
        description: 'Bytes streamed in chat completion',
        attributes: { model },
      });
    }

    if (durationMs > 0) {
      this.record('chat_stream_duration_ms', durationMs, {
        unit: 'ms',
        description: 'Total stream generation latency in milliseconds',
        attributes: { model },
      });
    }
  }

  /**
   * Record rate limit violations (HTTP 429).
   */
  recordRateLimitHit({ endpoint = '/api/chat' }) {
    const cleanEndpoint = (endpoint.split('?')[0] || '/api/chat').replace(/\/+$/, '') || '/api/chat';
    const redis = this.getRedis();
    const activeEnv = this.env;

    if (redis) {
      redis.hincrby(REDIS_METRICS_KEY, `ratelimit_blocked_total{endpoint=${cleanEndpoint},env=${activeEnv}}`, 1).catch(() => {});
    }

    this.record('ratelimit_blocked_total', 1, {
      unit: '1',
      description: 'Total rate limit rejections',
      attributes: { endpoint: cleanEndpoint },
    });
  }

  /**
   * Record client-side reported errors.
   */
  recordClientError({ type = 'unknown', path = '/' }) {
    const redis = this.getRedis();
    const activeEnv = this.env;

    if (redis) {
      redis.hincrby(REDIS_METRICS_KEY, `client_errors_total{type=${type},env=${activeEnv}}`, 1).catch(() => {});
    }

    this.record('client_errors_total', 1, {
      unit: '1',
      description: 'Client error reported',
      attributes: { type, path },
    });
  }

  scheduleFlush() {
    if (process.env.NODE_ENV === 'test' && !this.forceSendInTest) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  /**
   * Calculates rate gauges and aggregates local and Redis metrics into an OTLP metrics list.
   */
  async buildMetricsList() {
    const redis = this.getRedis();
    const activeEnv = this.env;
    const timeUnixNano = String(BigInt(Date.now()) * 1000000n);

    let rateHash = null;
    if (redis) {
      try {
        const minuteBucket = Math.floor(Date.now() / 60000);
        rateHash = await redis.hgetall(`${REDIS_RATE_PREFIX}${minuteBucket}`);
      } catch {}
    }

    const localStats = this.windowTracker.computeWindowStats();
    recordCalculatedGauges(this, localStats, rateHash);
    this.windowTracker.resetWindow();

    const pointsToSend = this.localDataPoints.splice(0, this.localDataPoints.length);
    const localMetrics = formatLocalMetrics(pointsToSend);

    let redisMetrics = [];
    if (redis) {
      try {
        const rawHash = await redis.hgetall(REDIS_METRICS_KEY);
        redisMetrics = formatRedisMetrics(rawHash, activeEnv, timeUnixNano);
      } catch {}
    }

    return [...localMetrics, ...redisMetrics];
  }

  /**
   * Flush all aggregated metrics to Grafana Cloud OTLP Gateway.
   * Reads fanned-out Redis counters and local data points.
   */
  async flush() {
    if (this.flushing) return;
    if (process.env.NODE_ENV === 'test' && !this.forceSendInTest) return;

    this.flushing = true;

    try {
      const activeEnv = this.env;
      const metricsList = await this.buildMetricsList();
      if (metricsList.length === 0) return;

      const payload = buildOtlpResourcePayload({
        serviceName: this.serviceName,
        activeEnv,
        metrics: metricsList,
      });

      const authPair = `${this.instanceId}:${this.apiKey}`;
      const encoded = Buffer.from(authPair).toString('base64');

      await fetch(this.metricsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${encoded}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Do not crash the application on metrics network failure
    } finally {
      this.flushing = false;
    }
  }
}

export const metrics = new GrafanaMetrics();
