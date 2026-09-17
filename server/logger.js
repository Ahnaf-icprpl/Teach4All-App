import { trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { getClientIp } from './rateLimiter.js';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {}

const envName = (process.env.ENV || process.env.NODE_ENV || 'development').toLowerCase().trim();
const isProd = envName.startsWith('prod') || envName === 'staging';

const LOG_LEVELS = {
  debug: { severity: SeverityNumber.DEBUG, text: 'DEBUG', priority: 1 },
  info: { severity: SeverityNumber.INFO, text: 'INFO', priority: 2 },
  warn: { severity: SeverityNumber.WARN, text: 'WARN', priority: 3 },
  error: { severity: SeverityNumber.ERROR, text: 'ERROR', priority: 4 },
};

function getMinLogLevelPriority() {
  const envLevel = (process.env.LOG_LEVEL || (isProd ? 'info' : 'debug')).toLowerCase().trim();
  return LOG_LEVELS[envLevel]?.priority || (isProd ? 2 : 1);
}

/**
 * Resolves currently active trace and span IDs from the OpenTelemetry context.
 */
export function getActiveTraceContext() {
  try {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) {
      return { traceId: null, spanId: null, sampled: false };
    }
    const spanContext = activeSpan.spanContext();
    return {
      traceId: spanContext?.traceId || null,
      spanId: spanContext?.spanId || null,
      sampled: Boolean(spanContext?.traceFlags && (spanContext.traceFlags & 1)),
    };
  } catch {
    return { traceId: null, spanId: null, sampled: false };
  }
}

/**
 * Normalizes attributes to valid OpenTelemetry primitive or JSON string values.
 */
function sanitizeAttributes(attributes = {}) {
  const sanitized = {};
  for (const [key, val] of Object.entries(attributes)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      sanitized[key] = val;
    } else if (val instanceof Error) {
      sanitized[`${key}.message`] = val.message;
      sanitized[`${key}.stack`] = val.stack || '';
      sanitized[`${key}.name`] = val.name;
    } else {
      try {
        sanitized[key] = JSON.stringify(val);
      } catch {
        sanitized[key] = String(val);
      }
    }
  }
  return sanitized;
}

/**
 * Formats console output according to active runtime environment.
 */
function outputConsoleLog(levelText, message, meta = {}, traceCtx = {}) {
  const timestamp = new Date().toISOString();
  const stream = levelText === 'ERROR' ? process.stderr : process.stdout;

  if (isProd) {
    const record = {
      timestamp,
      level: levelText,
      message,
      ...(traceCtx.traceId ? { trace_id: traceCtx.traceId, span_id: traceCtx.spanId } : {}),
      ...meta,
    };
    stream.write(JSON.stringify(record) + '\n');
  } else {
    const traceBadge = traceCtx.traceId ? ` [trace:${traceCtx.traceId.slice(0, 8)}]` : '';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    stream.write(`[${timestamp}] [${levelText}]${traceBadge} ${message}${metaStr}\n`);
  }
}

/**
 * Emits a structured log record to OpenTelemetry and standard streams.
 */
export function emitLog(levelKey, message, metadata = {}) {
  const config = LOG_LEVELS[levelKey] || LOG_LEVELS.info;
  if (config.priority < getMinLogLevelPriority()) {
    return;
  }

  const traceCtx = getActiveTraceContext();
  const sanitizedAttrs = sanitizeAttributes({
    ...metadata,
    ...(traceCtx.traceId ? { 'trace_id': traceCtx.traceId, 'span_id': traceCtx.spanId } : {}),
  });

  // 1. Emit to OpenTelemetry (forwarded to Grafana Cloud Loki via OTLP /v1/logs)
  try {
    const otelLogger = logs.getLogger(SERVICE_NAME);
    otelLogger.emit({
      severityNumber: config.severity,
      severityText: config.text,
      body: typeof message === 'string' ? message : JSON.stringify(message),
      attributes: sanitizedAttrs,
    });
  } catch {}

  // 2. Output to stdout/stderr
  try {
    outputConsoleLog(config.text, message, metadata, traceCtx);
  } catch {}
}

export const logger = {
  debug(message, meta = {}) {
    emitLog('debug', message, meta);
  },
  info(message, meta = {}) {
    emitLog('info', message, meta);
  },
  warn(message, meta = {}) {
    emitLog('warn', message, meta);
  },
  error(message, errorOrMeta = {}, extraMeta = {}) {
    let meta = {};
    if (errorOrMeta instanceof Error) {
      meta = {
        'error.message': errorOrMeta.message,
        'error.name': errorOrMeta.name,
        'error.stack': errorOrMeta.stack,
        ...extraMeta,
      };
    } else if (typeof errorOrMeta === 'object' && errorOrMeta !== null) {
      meta = { ...errorOrMeta, ...extraMeta };
    }
    emitLog('error', message, meta);
  },
};

/**
 * Express middleware to log completed HTTP requests with latency, status, and trace correlation.
 */
export function requestLoggerMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;
    const statusCode = res.statusCode || 200;
    const route = req.originalUrl || req.url || '/';

    // Skip verbose dev asset logs in development
    if (!isProd && (route.startsWith('/@') || route.startsWith('/src/') || route.startsWith('/node_modules/'))) {
      return;
    }

    const clientIp = getClientIp(req);
    const userId = req.userId || req.user?.id || req.auth?.userId || req.headers?.['x-user-id'] || 'anonymous';

    // Skip internal localhost health check polls from cluttering production logs
    const isInternalHealthCheck = clientIp === '127.0.0.1' &&
      (route === '/' || route === '/index.html') &&
      !req.headers?.['x-forwarded-for'] &&
      !req.headers?.['cf-connecting-ip'] &&
      !req.headers?.['x-real-ip'];
    if (isProd && isInternalHealthCheck) {
      return;
    }

    const meta = {
      'http.method': req.method,
      'http.route': route,
      'http.status_code': statusCode,
      'http.duration_ms': Math.round(durationMs * 100) / 100,
      'client.ip': clientIp,
      'user.id': userId,
    };

    const logMsg = `HTTP ${req.method} ${route} ${statusCode} (${meta['http.duration_ms']}ms)`;
    if (statusCode >= 500) {
      logger.error(logMsg, meta);
    } else if (statusCode >= 400) {
      logger.warn(logMsg, meta);
    } else {
      logger.info(logMsg, meta);
    }
  });

  next();
}

export default logger;
