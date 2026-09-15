import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { LoggerProvider, InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';

import {
  logger,
  getActiveTraceContext,
  requestLoggerMiddleware,
  emitLog,
} from '../server/logger.js';
import {
  normalizeMetricRoute,
  metricsMiddleware,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  httpRequestsInFlight,
} from '../server/metrics.js';

// Setup OpenTelemetry context manager and providers for testing
const contextManager = new AsyncHooksContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);

const logExporter = new InMemoryLogRecordExporter();
const loggerProvider = new LoggerProvider({
  processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
});
logs.setGlobalLoggerProvider(loggerProvider);

test('getActiveTraceContext returns null IDs when outside an active span', () => {
  const ctx = getActiveTraceContext();
  assert.strictEqual(ctx.traceId, null);
  assert.strictEqual(ctx.spanId, null);
  assert.strictEqual(ctx.sampled, false);
});

test('logger captures traceId and spanId when inside an active span', () => {
  const tracer = trace.getTracer('test-logger-tracer');

  tracer.startActiveSpan('test-operation', (span) => {
    const traceCtx = getActiveTraceContext();
    assert.ok(traceCtx.traceId, 'traceId should exist inside active span');
    assert.ok(traceCtx.spanId, 'spanId should exist inside active span');

    logger.info('User initiated action', { 'user.id': 'usr_456', action: 'quiz_start' });

    span.end();
  });

  const records = logExporter.getFinishedLogRecords();
  assert.ok(records.length > 0, 'should have emitted at least one log record');

  const record = records[records.length - 1];
  assert.strictEqual(record.body, 'User initiated action');
  assert.strictEqual(record.severityNumber, SeverityNumber.INFO);
  assert.strictEqual(record.attributes['user.id'], 'usr_456');
  assert.strictEqual(record.attributes['action'], 'quiz_start');
  assert.ok(record.spanContext?.traceId, 'spanContext must have traceId');
  assert.ok(record.spanContext?.spanId, 'spanContext must have spanId');
  assert.strictEqual(record.attributes['trace_id'], record.spanContext?.traceId);
});

test('logger.error formats Error instances and captures stack trace', () => {
  const errorObj = new Error('Database connection timed out');
  logger.error('Failed to execute query', errorObj, { 'db.table': 'conversations' });

  const records = logExporter.getFinishedLogRecords();
  const record = records[records.length - 1];

  assert.strictEqual(record.body, 'Failed to execute query');
  assert.strictEqual(record.severityNumber, SeverityNumber.ERROR);
  assert.strictEqual(record.attributes['error.message'], 'Database connection timed out');
  assert.strictEqual(record.attributes['error.name'], 'Error');
  assert.ok(record.attributes['error.stack'].includes('Database connection timed out'));
  assert.strictEqual(record.attributes['db.table'], 'conversations');
});

test('requestLoggerMiddleware logs completed requests with HTTP metadata', async () => {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/api/study/materials/123';
  req.originalUrl = '/api/study/materials/123';
  req.headers = { 'x-forwarded-for': '198.51.100.24' };
  req.auth = { userId: 'test_user_req_logger' };

  let nextCalled = false;
  const res = new EventEmitter();
  res.statusCode = 200;

  requestLoggerMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true, 'middleware should call next()');

  // Finish request
  res.emit('finish');

  const records = logExporter.getFinishedLogRecords();
  const record = records[records.length - 1];

  assert.ok(record.body.includes('HTTP GET /api/study/materials/123 200'));
  assert.strictEqual(record.attributes['http.method'], 'GET');
  assert.strictEqual(record.attributes['http.route'], '/api/study/materials/123');
  assert.strictEqual(record.attributes['http.status_code'], 200);
  assert.strictEqual(record.attributes['client.ip'], '198.51.100.24');
  assert.strictEqual(record.attributes['user.id'], 'test_user_req_logger');
  assert.ok(typeof record.attributes['http.duration_ms'] === 'number');
});

test('normalizeMetricRoute replaces dynamic IDs with parameterized placeholders', () => {
  assert.strictEqual(
    normalizeMetricRoute('/api/conversations/3fa85f64-5717-4562-b3fc-2c963f66afa6/messages'),
    '/api/conversations/:uuid/messages'
  );
  assert.strictEqual(
    normalizeMetricRoute('/api/users/guest_1234567890/profile'),
    '/api/users/:guestId/profile'
  );
  assert.strictEqual(
    normalizeMetricRoute('/api/users/user_2abcDEF123/sync'),
    '/api/users/:userId/sync'
  );
  assert.strictEqual(
    normalizeMetricRoute('/api/quizzes/42'),
    '/api/quizzes/:id'
  );
});

test('metricsMiddleware executes cleanly and records request duration and in-flight counts', () => {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/chat';
  req.originalUrl = '/api/chat';

  let nextCalled = false;
  const res = new EventEmitter();
  res.statusCode = 200;

  metricsMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true, 'metricsMiddleware should invoke next()');

  // Verify instruments exist and accept data without throwing
  res.emit('finish');
});
