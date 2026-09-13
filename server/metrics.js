import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getRedisClient } from './redis.js';
import { getActiveEnv } from './logger.js';

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
  }

  get env() {
    return getActiveEnv();
  }

  getRedis() {
    if (this.redisClient) return this.redisClient;
    return getRedisClient(this.redisUrl);
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
   * Record HTTP request count and latency.
   * Atomically increments Redis hash to handle Vercel serverless fan-out across lambdas.
   */
  recordHttpRequest({ endpoint = '/api/chat', method = 'GET', status = 200, durationMs = 0 }) {
    const cleanEndpoint = endpoint.split('?')[0];
    const statusStr = String(status);
    const activeEnv = this.env;

    // 1. Record atomic counter in Redis across fanned-out Vercel instances
    const redis = this.getRedis();
    if (redis) {
      const redisField = `http_requests_total{endpoint=${cleanEndpoint},method=${method},status=${statusStr},env=${activeEnv}}`;
      redis.hincrby(REDIS_METRICS_KEY, redisField, 1).catch(() => {});
    }

    // 2. Record instantaneous latency gauge in local memory
    if (durationMs > 0) {
      this.record('http_request_duration_ms', durationMs, {
        unit: 'ms',
        description: 'Duration of HTTP requests in milliseconds',
        attributes: { endpoint: cleanEndpoint, method, status: statusStr },
      });
    }

    // 3. Record instantaneous request hit
    this.record('http_requests_count', 1, {
      unit: '1',
      description: 'Single HTTP request event',
      attributes: { endpoint: cleanEndpoint, method, status: statusStr },
    });
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
    const cleanEndpoint = endpoint.split('?')[0];
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
   * Flush all aggregated metrics to Grafana Cloud OTLP Gateway.
   * Reads fanned-out Redis counters and local data points.
   */
  async flush() {
    if (this.flushing) return;
    if (process.env.NODE_ENV === 'test' && !this.forceSendInTest) return;

    this.flushing = true;
    const pointsToSend = this.localDataPoints.splice(0, this.localDataPoints.length);

    try {
      const activeEnv = this.env;
      const timeUnixNano = String(BigInt(Date.now()) * 1000000n);
      const metricsList = [];

      // 1. Group local data points by metric name
      const groupedByName = new Map();
      for (const pt of pointsToSend) {
        if (!groupedByName.has(pt.name)) {
          groupedByName.set(pt.name, { unit: pt.unit, description: pt.description, points: [] });
        }
        const g = groupedByName.get(pt.name);
        const dataPoint = {
          timeUnixNano: pt.timeUnixNano,
          attributes: toOtlpMetricAttributes(pt.attributes),
        };
        if (pt.isInteger) {
          dataPoint.asInt = Math.round(pt.value);
        } else {
          dataPoint.asDouble = pt.value;
        }
        g.points.push(dataPoint);
      }

      for (const [name, g] of groupedByName.entries()) {
        metricsList.push({
          name,
          unit: g.unit,
          description: g.description,
          gauge: {
            dataPoints: g.points,
          },
        });
      }

      // 2. Read global fanned-out cumulative counters from Redis
      const redis = this.getRedis();
      if (redis) {
        try {
          const rawHash = await redis.hgetall(REDIS_METRICS_KEY);
          if (rawHash && typeof rawHash === 'object') {
            const redisGrouped = new Map();

            for (const [field, countStr] of Object.entries(rawHash)) {
              const count = parseInt(countStr, 10);
              if (isNaN(count)) continue;

              const { name, attributes } = parseMetricKey(field);
              if (!redisGrouped.has(name)) {
                redisGrouped.set(name, []);
              }

              redisGrouped.get(name).push({
                asInt: count,
                timeUnixNano,
                attributes: toOtlpMetricAttributes({
                  ...attributes,
                  env: attributes.env || activeEnv,
                }),
              });
            }

            for (const [name, dataPoints] of redisGrouped.entries()) {
              metricsList.push({
                name,
                unit: '1',
                description: `Global cumulative ${name} aggregated across Vercel instances via Redis`,
                gauge: {
                  dataPoints,
                },
              });
            }
          }
        } catch {
          // Non-blocking fallback if Redis read fails
        }
      }

      if (metricsList.length === 0) return;

      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: this.serviceName } },
                { key: 'deployment.environment', value: { stringValue: activeEnv } },
                { key: 'env', value: { stringValue: activeEnv } },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: 'teach4all-metrics', version: '0.1.0' },
                metrics: metricsList,
              },
            ],
          },
        ],
      };

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
