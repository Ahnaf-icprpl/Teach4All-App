import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';

// Safely load environment file if running standalone
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {}

/**
 * Resolves normalized environment name ('production' or 'development').
 */
export function resolveOtelEnvironment(env = process.env) {
  const raw = (env.ENV || env.env || env.NODE_ENV || 'development').toLowerCase().trim();
  return raw === 'production' || raw === 'prod' ? 'production' : 'development';
}

/**
 * Parses Grafana Cloud OTLP token (format: glc_<base64>)
 * Extracts instance ID and region to build the OTLP gateway URL and Basic Auth credentials.
 */
export function parseGrafanaOtelKey(apiKey = '') {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('glc_')) {
    return null;
  }

  try {
    const rawPayload = apiKey.slice(4);
    const jsonStr = Buffer.from(rawPayload, 'base64').toString('utf8');
    const meta = JSON.parse(jsonStr);

    const region = meta.m?.r || 'prod-ap-southeast-2';
    const stackMatch = String(meta.n || '').match(/stack-(\d+)/);
    const instanceId = stackMatch ? stackMatch[1] : (meta.o || '');

    if (!instanceId) return null;

    const basicAuth = 'Basic ' + Buffer.from(`${instanceId}:${apiKey}`).toString('base64');
    const endpoint = `https://otlp-gateway-${region}.grafana.net/otlp`;

    return {
      instanceId,
      region,
      endpoint,
      authorization: basicAuth,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves OpenTelemetry configuration from environment variables.
 */
export function getOtelConfig(env = process.env) {
  const apiKey = (env.GRAFANA_OTEL_API_KEY || env.GRAFANA_API_KEY || env.OTEL_API_KEY || '').trim();
  const grafanaInfo = parseGrafanaOtelKey(apiKey);

  let endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT || grafanaInfo?.endpoint || '').trim();
  if (endpoint.endsWith('/')) {
    endpoint = endpoint.slice(0, -1);
  }

  const headers = {};
  if (grafanaInfo?.authorization) {
    headers['Authorization'] = grafanaInfo.authorization;
  }

  if (env.OTEL_EXPORTER_OTLP_HEADERS) {
    const headerEntries = env.OTEL_EXPORTER_OTLP_HEADERS.split(',');
    for (const entry of headerEntries) {
      const idx = entry.indexOf('=');
      if (idx !== -1) {
        const k = entry.slice(0, idx).trim();
        const v = entry.slice(idx + 1).trim();
        if (k && v) headers[k] = v;
      }
    }
  }

  const serviceName = (env.OTEL_SERVICE_NAME || 'teach4all').trim();
  const environment = resolveOtelEnvironment(env);
  const isEnabled = Boolean(
    endpoint && (headers['Authorization'] || Object.keys(headers).length > 0 || !endpoint.includes('grafana.net'))
  );

  return {
    isEnabled,
    endpoint,
    headers,
    serviceName,
    environment,
  };
}

let sdkInstance = null;

/**
 * Initializes and starts the OpenTelemetry NodeSDK with auto-instrumentation.
 */
export function initOpenTelemetry(env = process.env) {
  if (globalThis.__OTEL_SDK_INSTANCE__) {
    return globalThis.__OTEL_SDK_INSTANCE__;
  }

  const config = getOtelConfig(env);
  if (!config.isEnabled) {
    return null;
  }

  try {
    const tracesUrl = (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim() ||
      (config.endpoint.endsWith('/v1/traces') ? config.endpoint : `${config.endpoint}/v1/traces`);

    const metricsUrl = (env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || '').trim() ||
      (config.endpoint.endsWith('/v1/metrics') ? config.endpoint : `${config.endpoint}/v1/metrics`);

    const logsUrl = (env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || '').trim() ||
      (config.endpoint.endsWith('/v1/logs') ? config.endpoint : `${config.endpoint}/v1/logs`);

    const traceExporter = new OTLPTraceExporter({
      url: tracesUrl,
      headers: config.headers,
    });

    const metricExporter = new OTLPMetricExporter({
      url: metricsUrl,
      headers: config.headers,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 15000,
    });

    const logExporter = new OTLPLogExporter({
      url: logsUrl,
      headers: config.headers,
    });

    const logRecordProcessor = new BatchLogRecordProcessor({
      exporter: logExporter,
      scheduledDelayMillis: 2000,
      maxExportBatchSize: 512,
    });

    const resource = resourceFromAttributes({
      'service.name': config.serviceName,
      'deployment.environment': config.environment,
      'deployment.environment.name': config.environment,
      'environment': config.environment,
      'env': config.environment,
    });

    sdkInstance = new NodeSDK({
      resource,
      serviceName: config.serviceName,
      traceExporter,
      metricReaders: [metricReader],
      logRecordProcessors: [logRecordProcessor],
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdkInstance.start();
    globalThis.__OTEL_SDK_INSTANCE__ = sdkInstance;
    console.log(
      `[OpenTelemetry] Auto-instrumentation active for service '${config.serviceName}' [env: ${config.environment}] -> ${config.endpoint}`
    );

    const cleanup = async () => {
      if (globalThis.__OTEL_SDK_INSTANCE__) {
        try {
          await globalThis.__OTEL_SDK_INSTANCE__.shutdown();
        } catch {}
      }
    };

    process.once('SIGTERM', cleanup);
    process.once('SIGINT', cleanup);

    return sdkInstance;
  } catch (err) {
    console.error('[OpenTelemetry] Initialization failed:', err.message);
    return null;
  }
}

// Auto-initialize when imported
initOpenTelemetry();

export const sdk = sdkInstance;
export default initOpenTelemetry;
