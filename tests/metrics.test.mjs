import { test } from 'node:test';
import assert from 'node:assert';
import {
  extractRequestMetadata,
  classifyUserAgent,
  calculatePercentile,
  MetricsWindowTracker,
  recordCumulativeMetrics,
} from '../server/metricsUtils.js';
import {
  formatLocalMetrics,
  formatCounterMetrics,
  buildOtlpResourcePayload,
} from '../server/metricsFormatter.js';
import { GrafanaMetrics } from '../server/metrics.js';

test('classifyUserAgent buckets user agents into low-cardinality categories', () => {
  assert.strictEqual(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119.0.0.0 Safari/537.36'), 'browser');
  assert.strictEqual(classifyUserAgent('curl/7.88.1'), 'tool');
  assert.strictEqual(classifyUserAgent('PostmanRuntime/7.32.3'), 'tool');
  assert.strictEqual(classifyUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)'), 'bot');
  assert.strictEqual(classifyUserAgent('python-requests/2.28.1'), 'other');
  assert.strictEqual(classifyUserAgent(''), 'unknown');
  assert.strictEqual(classifyUserAgent(null), 'unknown');
});

test('calculatePercentile computes correct statistical percentiles', () => {
  assert.strictEqual(calculatePercentile([], 95), 0);
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.strictEqual(calculatePercentile(values, 50), 50);
  assert.strictEqual(calculatePercentile(values, 95), 100);
});

test('extractRequestMetadata extracts rich request info, headers, and status classes', () => {
  const req = {
    method: 'POST',
    url: '/api/chat?token=secret123',
    headers: {
      'x-vercel-ip-country': 'SG',
      'user-agent': 'Mozilla/5.0 Chrome/120.0',
      'content-length': '256',
      'x-vercel-forwarded-for': '203.0.113.195',
    },
  };
  const res = {
    statusCode: 200,
    getHeader(name) {
      return name.toLowerCase() === 'content-length' ? '1024' : null;
    },
  };

  const meta = extractRequestMetadata({ req, res, durationMs: 42 });
  assert.strictEqual(meta.endpoint, '/api/chat');
  assert.strictEqual(meta.method, 'POST');
  assert.strictEqual(meta.status, 200);
  assert.strictEqual(meta.statusClass, '2xx');
  assert.strictEqual(meta.isError, false);
  assert.strictEqual(meta.isClientError, false);
  assert.strictEqual(meta.isServerError, false);
  assert.strictEqual(meta.errorType, 'none');
  assert.strictEqual(meta.country, 'SG');
  assert.strictEqual(meta.clientIp, '203.0.113.195');
  assert.strictEqual(meta.clientCategory, 'browser');
  assert.strictEqual(meta.requestBytes, 256);
  assert.strictEqual(meta.responseBytes, 1024);
  assert.strictEqual(meta.durationMs, 42);

  // Test 429 rate limited
  const meta429 = extractRequestMetadata({ status: 429, endpoint: '/api/title' });
  assert.strictEqual(meta429.statusClass, '4xx');
  assert.strictEqual(meta429.isError, true);
  assert.strictEqual(meta429.isClientError, true);
  assert.strictEqual(meta429.errorType, 'rate_limited');

  // Test 500 server error
  const meta500 = extractRequestMetadata({ status: 500, endpoint: '/api/chat' });
  assert.strictEqual(meta500.statusClass, '5xx');
  assert.strictEqual(meta500.isError, true);
  assert.strictEqual(meta500.isServerError, true);
  assert.strictEqual(meta500.errorType, 'server_error');
});

test('MetricsWindowTracker calculates request rate, error rate, and active concurrency accurately', () => {
  const tracker = new MetricsWindowTracker();
  assert.strictEqual(tracker.activeRequests, 0);

  // Test active requests tracking
  const endReq1 = tracker.startRequest('/api/chat');
  const endReq2 = tracker.startRequest('/api/chat');
  assert.strictEqual(tracker.activeRequests, 2);

  endReq1();
  assert.strictEqual(tracker.activeRequests, 1);
  endReq2();
  assert.strictEqual(tracker.activeRequests, 0);

  // Record 3 successful requests and 1 error request (total 4, error rate 25%)
  tracker.recordRequest({
    endpoint: '/api/chat',
    durationMs: 50,
    requestBytes: 100,
    responseBytes: 200,
    isError: false,
    isClientError: false,
    isServerError: false,
  });
  tracker.recordRequest({
    endpoint: '/api/chat',
    durationMs: 70,
    requestBytes: 100,
    responseBytes: 200,
    isError: false,
    isClientError: false,
    isServerError: false,
  });
  tracker.recordRequest({
    endpoint: '/api/title',
    durationMs: 30,
    requestBytes: 50,
    responseBytes: 100,
    isError: false,
    isClientError: false,
    isServerError: false,
  });
  tracker.recordRequest({
    endpoint: '/api/chat',
    durationMs: 120,
    requestBytes: 80,
    responseBytes: 50,
    isError: true,
    isClientError: false,
    isServerError: true,
  });

  // Simulate 2-second elapsed window
  const fakeNow = tracker.windowStart + 2000;
  const stats = tracker.computeWindowStats(fakeNow);

  assert.strictEqual(stats.count, 4);
  assert.strictEqual(stats.errors, 1);
  assert.strictEqual(stats.clientErrors, 0);
  assert.strictEqual(stats.serverErrors, 1);
  assert.strictEqual(stats.errorRatePercentage, 25);
  assert.strictEqual(stats.errorRateRatio, 0.25);
  assert.strictEqual(stats.serverErrorRatePercentage, 25);
  assert.strictEqual(stats.requestRatePerSec, 2); // 4 reqs / 2 secs
  assert.strictEqual(stats.requestRatePerMin, 120); // 2 * 60

  assert.strictEqual(stats.durationMinMs, 30);
  assert.strictEqual(stats.durationMaxMs, 120);
  assert.strictEqual(stats.durationAvgMs, 67.5);

  assert.strictEqual(stats.endpoints['/api/chat'].count, 3);
  assert.strictEqual(stats.endpoints['/api/chat'].errors, 1);
  assert(Math.abs(stats.endpoints['/api/chat'].errorRatePercentage - 33.33) < 0.1);
});

test('recordCumulativeMetrics writes atomic counters and rate window buckets to in-memory Maps', () => {
  const inMemoryCounters = new Map();
  const inMemoryRateBuckets = new Map();

  const meta = {
    endpoint: '/api/chat',
    method: 'POST',
    status: 500,
    statusStr: '500',
    statusClass: '5xx',
    isError: true,
    isClientError: false,
    isServerError: true,
    errorType: 'server_error',
    durationMs: 85,
    country: 'US',
    clientIp: '1.2.3.4',
    clientCategory: 'browser',
    requestBytes: 512,
    responseBytes: 128,
  };

  recordCumulativeMetrics(meta, 'production', inMemoryCounters, inMemoryRateBuckets);

  const keys = [...inMemoryCounters.keys()];
  assert(keys.some(c => c.includes('http_requests_total')));
  assert(keys.some(c => c.includes('http_requests_errors_total')));
  assert(keys.some(c => c.includes('http_requests_server_errors_total')));
  assert(keys.some(c => c.includes('http_requests_by_country_total{country=US')));
  assert(keys.some(c => c.includes('http_request_bytes_total')));
  assert(keys.some(c => c.includes('http_response_bytes_total')));
  assert.strictEqual(inMemoryCounters.get('http_request_bytes_total{endpoint=/api/chat,env=production}'), 512);
  assert.strictEqual(inMemoryCounters.get('http_response_bytes_total{endpoint=/api/chat,env=production}'), 128);

  const minuteBucket = Math.floor(Date.now() / 60000);
  const bucket = inMemoryRateBuckets.get(minuteBucket);
  assert(bucket);
  assert.strictEqual(bucket.total, 1);
  assert.strictEqual(bucket.errors, 1);
  assert.strictEqual(bucket.errors_5xx, 1);
});

test('GrafanaMetrics buildMetricsList aggregates error rates, request rates, and OTLP attributes in-memory', async () => {
  const metricsInst = new GrafanaMetrics({
    forceSendInTest: false,
  });

  metricsInst.inMemoryCounters.set('http_requests_total{endpoint=/api/chat,method=POST,status=200,env=production}', 9);
  metricsInst.inMemoryCounters.set('http_requests_total{endpoint=/api/chat,method=POST,status=500,env=production}', 1);
  metricsInst.inMemoryCounters.set('http_requests_errors_total{endpoint=/api/chat,status=500,error_type=server_error,env=production}', 1);

  // Record 1 error request and 1 success request locally
  metricsInst.recordHttpRequest({
    endpoint: '/api/chat',
    method: 'POST',
    status: 500,
    durationMs: 150,
    country: 'DE',
    requestBytes: 300,
    responseBytes: 60,
  });
  metricsInst.recordHttpRequest({
    endpoint: '/api/chat',
    method: 'POST',
    status: 200,
    durationMs: 50,
    country: 'DE',
    requestBytes: 200,
    responseBytes: 400,
  });

  const metricsList = await metricsInst.buildMetricsList();
  assert(metricsList.length > 0);

  const metricNames = metricsList.map(m => m.name);
  assert(metricNames.includes('http_request_rate_per_second'));
  assert(metricNames.includes('http_request_rate_per_minute'));
  assert(metricNames.includes('http_error_rate_percentage'));
  assert(metricNames.includes('http_error_rate_ratio'));
  assert(metricNames.includes('http_server_error_rate_percentage'));
  assert(metricNames.includes('http_request_duration_avg_ms'));
  assert(metricNames.includes('http_cluster_cumulative_error_rate_percentage'));

  const errorPctMetric = metricsList.find(m => m.name === 'http_error_rate_percentage');
  assert(errorPctMetric);
  const errorVal = errorPctMetric.gauge.dataPoints[0].asInt ?? errorPctMetric.gauge.dataPoints[0].asDouble;
  assert.strictEqual(errorVal, 50); // 1 error out of 2 requests = 50%

  const clusterErrorMetric = metricsList.find(m => m.name === 'http_cluster_cumulative_error_rate_percentage');
  assert(clusterErrorMetric);
  const clusterVal = clusterErrorMetric.gauge.dataPoints[0].asInt ?? clusterErrorMetric.gauge.dataPoints[0].asDouble;
  assert(clusterVal > 0);

  // Verify resource payload wrapper
  const payload = buildOtlpResourcePayload({
    serviceName: 'teach4all',
    activeEnv: 'production',
    metrics: metricsList,
  });
  assert(payload.resourceMetrics);
  assert.strictEqual(payload.resourceMetrics[0].resource.attributes[0].value.stringValue, 'teach4all');
});
