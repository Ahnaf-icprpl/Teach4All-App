import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Grafana Cloud OTLP Logging Client for Teach4All.
 * 
 * Streams structured application logs directly to Grafana Cloud via the
 * OpenTelemetry Protocol (OTLP/HTTP JSON) gateway using zero runtime dependencies.
 */

// Load local .env fallback if not yet loaded in process.env
if (!process.env.GRAFANA_API_KEY) {
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

/**
 * Convert arbitrary JavaScript values into valid OpenTelemetry attribute values.
 */
export function toOtlpValue(value) {
  if (value === null || value === undefined) return { stringValue: '' };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'object') {
    try {
      return { stringValue: JSON.stringify(value) };
    } catch {
      return { stringValue: String(value) };
    }
  }
  return { stringValue: String(value) };
}

/**
 * Convert key-value pairs into OpenTelemetry KeyValue attribute objects.
 */
export function toOtlpAttributes(attrs = {}) {
  return Object.entries(attrs)
    .filter(([_, v]) => v !== undefined)
    .map(([key, value]) => ({
      key,
      value: toOtlpValue(value),
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
    enableConsole = true,
    forceSendInTest = false,
  } = {}) {
    this.instanceId = instanceId;
    this.apiKey = apiKey;
    this.otlpUrl = otlpUrl;
    this.serviceName = serviceName;
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.enableConsole = enableConsole;
    this.forceSendInTest = forceSendInTest;

    this.queue = [];
    this.flushTimer = null;
    this.flushing = false;
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

    if (this.enableConsole) {
      const consoleFn =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      const attrKeys = Object.keys(attributes);
      const suffix = attrKeys.length > 0 ? ` ${JSON.stringify(attributes)}` : '';
      consoleFn(`[${sev.text}] ${message}${suffix}`);
    }

    const record = {
      timeUnixNano: nowUnixNano,
      observedTimeUnixNano: nowUnixNano,
      severityNumber: sev.number,
      severityText: sev.text,
      body: { stringValue: typeof message === 'string' ? message : JSON.stringify(message) },
      attributes: toOtlpAttributes(attributes),
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
      return;
    }

    const authPair = `${instanceId}:${apiKey}`;
    const encoded = Buffer.from(authPair).toString('base64');
    const env = process.env.ENV || process.env.env || 'development';

    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
              { key: 'deployment.environment', value: { stringValue: env } },
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

    return res;
  }
}

export const logger = new GrafanaLogger();
