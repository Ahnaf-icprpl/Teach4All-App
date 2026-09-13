import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getClientIp, getClientLocation } from './rateLimiter.js';

/**
 * Grafana Cloud OTLP Logging Client for Teach4All.
 * 
 * Streams structured application logs directly to Grafana Cloud via the
 * OpenTelemetry Protocol (OTLP/HTTP JSON) gateway using zero runtime dependencies.
 */

// Load local .env fallback if not yet loaded in process.env
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
      if ((key.startsWith('GRAFANA_') || key === 'ENV' || key === 'env') && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch {}

/**
 * Resolves current active environment ('production' | 'development').
 * Prioritizes process.env.ENV / process.env.env, normalizing to lowercase,
 * defaulting to 'development'.
 */
export function getActiveEnv() {
  const raw = process.env.ENV || process.env.env;
  if (raw && typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'production' || normalized === 'development') {
      return normalized;
    }
  }
  return 'development';
}

export const DEFAULT_GRAFANA_INSTANCE_ID = '1828340';
export const DEFAULT_GRAFANA_API_KEY = process.env.GRAFANA_API_KEY || '';
export const DEFAULT_GRAFANA_OTLP_URL =
  process.env.GRAFANA_OTLP_URL || 'https://otlp-gateway-prod-ap-southeast-2.grafana.net/otlp/v1/logs';
export const DEFAULT_SERVICE_NAME = 'teach4all';

export const SEVERITY_LEVELS = {
  debug: { text: 'DEBUG', number: 5 },
  info: { text: 'INFO', number: 9 },
  warn: { text: 'WARN', number: 13 },
  error: { text: 'ERROR', number: 17 },
};

export const DEFAULT_MAX_LOG_TEXT_LENGTH = 500;

/**
 * Truncate arbitrary text to prevent massive external payloads (such as large user
 * prompts, file contents, or verbose stack traces) from bloating application logs.
 */
export function truncateText(value, maxLength = DEFAULT_MAX_LOG_TEXT_LENGTH) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}... [truncated]`;
}

/**
 * Recursively sanitizes and truncates external attribute values.
 */
export function sanitizeAttributeValue(value, maxLength = DEFAULT_MAX_LOG_TEXT_LENGTH, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return truncateText(value, maxLength);
  }
  if (typeof value === 'object') {
    if (depth > 2) {
      return truncateText(JSON.stringify(value), maxLength);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 10).map(item => sanitizeAttributeValue(item, maxLength, depth + 1));
    }
    const sanitized = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        sanitized[k] = sanitizeAttributeValue(v, maxLength, depth + 1);
      }
    }
    return sanitized;
  }
  return truncateText(String(value), maxLength);
}

/**
 * Sanitize all attributes by truncating long strings/nested objects.
 */
export function sanitizeAttributes(attrs = {}, maxLength = DEFAULT_MAX_LOG_TEXT_LENGTH) {
  const result = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      result[key] = sanitizeAttributeValue(value, maxLength);
    }
  }
  return result;
}

/**
 * Convert arbitrary JavaScript values into valid OpenTelemetry attribute values.
 */
export function toOtlpValue(value, maxLength = DEFAULT_MAX_LOG_TEXT_LENGTH) {
  if (value === null || value === undefined) return { stringValue: '' };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'object') {
    try {
      return { stringValue: truncateText(JSON.stringify(value), maxLength) };
    } catch {
      return { stringValue: truncateText(String(value), maxLength) };
    }
  }
  return { stringValue: truncateText(String(value), maxLength) };
}

/**
 * Convert key-value pairs into OpenTelemetry KeyValue attribute objects.
 */
export function toOtlpAttributes(attrs = {}, maxLength = DEFAULT_MAX_LOG_TEXT_LENGTH) {
  return Object.entries(attrs)
    .filter(([_, v]) => v !== undefined)
    .map(([key, value]) => ({
      key,
      value: toOtlpValue(value, maxLength),
    }));
}

export class GrafanaLogger {
  constructor({
    instanceId = process.env.GRAFANA_INSTANCE_ID || DEFAULT_GRAFANA_INSTANCE_ID,
    apiKey = process.env.GRAFANA_API_KEY || DEFAULT_GRAFANA_API_KEY,
    otlpUrl = process.env.GRAFANA_OTLP_URL || DEFAULT_GRAFANA_OTLP_URL,
    serviceName = process.env.GRAFANA_SERVICE_NAME || DEFAULT_SERVICE_NAME,
    batchSize = 50,
    flushIntervalMs = 1000,
    enableConsole = process.env.ENABLE_CONSOLE === 'true',
    forceSendInTest = false,
    maxTextLength = Number(process.env.GRAFANA_MAX_TEXT_LENGTH) || DEFAULT_MAX_LOG_TEXT_LENGTH,
    env = null,
  } = {}) {
    this.instanceId = instanceId;
    this.apiKey = apiKey;
    this.otlpUrl = otlpUrl;
    this.serviceName = serviceName;
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.enableConsole = enableConsole;
    this.forceSendInTest = forceSendInTest;
    this.maxTextLength = maxTextLength;
    this._explicitEnv = env;
    this.isServerless = Boolean(
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.SERVERLESS
    );
    this._warnedMissingKey = false;

    this.queue = [];
    this.flushTimer = null;
    this.flushing = false;
  }

  /**
   * Resolves the active environment ('production' | 'development') for this logger instance.
   */
  get env() {
    if (this._explicitEnv) {
      return String(this._explicitEnv).trim().toLowerCase();
    }
    return getActiveEnv();
  }

  isDev() {
    return this.env === 'development';
  }

  /**
   * Schedule throttled background batch flush.
   */
  scheduleFlush() {
    if (process.env.NODE_ENV === 'test' && !this.forceSendInTest) return;
    if (this.flushTimer || this.queue.length === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  /**
   * Enqueue a structured log entry and forward to Grafana Cloud.
   */
  log(level, message, attributes = {}, { immediate = false } = {}) {
    const sev = SEVERITY_LEVELS[level?.toLowerCase()] || SEVERITY_LEVELS.info;
    const nowUnixNano = String(BigInt(Date.now()) * 1000000n);
    const activeEnv = this.env;

    const safeMessage = truncateText(message, this.maxTextLength);
    const sanitizedAttrs = sanitizeAttributes(attributes, this.maxTextLength);
    const recordAttrs = {
      ...sanitizedAttrs,
      env: sanitizedAttrs.env || activeEnv,
    };

    if (this.enableConsole) {
      const consoleFn =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      const attrKeys = Object.keys(recordAttrs);
      const suffix = attrKeys.length > 0 ? ` ${JSON.stringify(recordAttrs)}` : '';
      consoleFn(`[${sev.text}] [${activeEnv}] ${safeMessage}${suffix}`);
    }

    const record = {
      timeUnixNano: nowUnixNano,
      observedTimeUnixNano: nowUnixNano,
      severityNumber: sev.number,
      severityText: sev.text,
      body: { stringValue: safeMessage },
      attributes: toOtlpAttributes(recordAttrs, this.maxTextLength),
    };

    this.queue.push(record);

    if (immediate) {
      return this.flush();
    }

    if (process.env.NODE_ENV === 'test' && !this.forceSendInTest) {
      return;
    }

    if (this.queue.length >= this.batchSize) {
      this.flush().catch(() => {});
    } else {
      this.scheduleFlush();
    }
  }

  debug(msg, attrs = {}, opts = {}) {
    return this.log('debug', msg, attrs, opts);
  }

  info(msg, attrs = {}, opts = {}) {
    return this.log('info', msg, attrs, opts);
  }

  warn(msg, attrs = {}, opts = {}) {
    return this.log('warn', msg, attrs, opts);
  }

  error(msg, attrs = {}, opts = {}) {
    return this.log('error', msg, attrs, opts);
  }

  /**
   * Send batched log records to Grafana OTLP Gateway over HTTP.
   */
  async flush() {
    if (this.queue.length === 0 || this.flushing) return;

    const records = this.queue.splice(0, this.batchSize);
    this.flushing = true;

    try {
      await this.sendToGrafana(records);
    } catch (err) {
      // Gracefully handle network drops without crashing application runtime
      if (this.enableConsole) {
        console.error('[GrafanaLogger] Failed to deliver logs to Grafana:', err.message);
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Assemble OTLP payload and transmit with HTTP Basic authentication.
   */
  async sendToGrafana(records) {
    if (process.env.NODE_ENV === 'test' && !this.forceSendInTest) {
      return;
    }

    const instanceId = this.instanceId || process.env.GRAFANA_INSTANCE_ID;
    const apiKey = this.apiKey || process.env.GRAFANA_API_KEY;
    const url = this.otlpUrl || process.env.GRAFANA_OTLP_URL;

    if (!instanceId || !apiKey || !url || records.length === 0) {
      if (!apiKey && this.enableConsole && !this._warnedMissingKey) {
        this._warnedMissingKey = true;
        console.warn('[GrafanaLogger] Warning: GRAFANA_API_KEY is not set. Logs will not be sent to Grafana Cloud. Please configure GRAFANA_API_KEY in your deployment environment variables.');
      }
      return;
    }

    const authPair = `${instanceId}:${apiKey}`;
    const encoded = Buffer.from(authPair).toString('base64');
    const activeEnv = this.env;

    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
              { key: 'deployment.environment', value: { stringValue: activeEnv } },
              { key: 'env', value: { stringValue: activeEnv } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'teach4all-logger', version: '0.1.0' },
              logRecords: records,
            },
          ],
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${encoded}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (this.enableConsole) {
        console.error(`[GrafanaLogger] Grafana OTLP responded with status ${res.status}: ${errText}`);
      }
    }

    return res;
  }
}

export const logger = new GrafanaLogger();

/**
 * Super verbose request logger for development environment.
 * Logs every incoming request to both console and Grafana Cloud when env is 'development'.
 */
export function logDevRequest(req, endpoint = '', extra = {}) {
  if (!logger.isDev()) return;
  const method = req?.method || 'GET';
  const url = req?.url || endpoint || '/';
  const ip = getClientIp(req);
  const loc = getClientLocation(req);
  logger.info(`Request: ${method} ${url}`, {
    dev_trace: true,
    endpoint: endpoint || url,
    method,
    url,
    client_ip: ip,
    ...(loc?.country ? { client_country: loc.country } : {}),
    ...(loc?.city ? { client_city: loc.city } : {}),
    user_agent: req?.headers ? req.headers['user-agent'] : undefined,
    ...extra,
  });
}
