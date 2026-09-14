import { toOtlpMetricAttributes, parseMetricKey } from './metricsUtils.js';

/**
 * Format local in-memory data points into OpenTelemetry gauge metric structures.
 */
export function formatLocalMetrics(dataPoints = []) {
  const groupedByName = new Map();

  for (const pt of dataPoints) {
    if (!groupedByName.has(pt.name)) {
      groupedByName.set(pt.name, {
        unit: pt.unit,
        description: pt.description,
        points: [],
      });
    }
    const group = groupedByName.get(pt.name);
    const dataPoint = {
      timeUnixNano: pt.timeUnixNano,
      attributes: toOtlpMetricAttributes(pt.attributes),
    };

    if (pt.isInteger) {
      dataPoint.asInt = Math.round(pt.value);
    } else {
      dataPoint.asDouble = Number(pt.value.toFixed(4));
    }
    group.points.push(dataPoint);
  }

  const metricsList = [];
  for (const [name, group] of groupedByName.entries()) {
    metricsList.push({
      name,
      unit: group.unit,
      description: group.description,
      gauge: { dataPoints: group.points },
    });
  }

  return metricsList;
}

/**
 * Format in-memory cumulative counter hash into OpenTelemetry metric structures.
 */
export function formatCounterMetrics(rawHash = {}, activeEnv = 'development', timeUnixNano = '') {
  if (!rawHash || typeof rawHash !== 'object') return [];

  const metricsList = [];
  const counterGrouped = new Map();
  let cumTotalReqs = 0;
  let cumTotalErrors = 0;

  for (const [field, countVal] of Object.entries(rawHash)) {
    const count = typeof countVal === 'number' ? countVal : parseInt(countVal, 10);
    if (isNaN(count)) continue;

    const { name, attributes } = parseMetricKey(field);
    if (name === 'http_requests_total') cumTotalReqs += count;
    if (name === 'http_requests_errors_total') cumTotalErrors += count;

    if (!counterGrouped.has(name)) {
      counterGrouped.set(name, []);
    }

    counterGrouped.get(name).push({
      asInt: count,
      timeUnixNano,
      attributes: toOtlpMetricAttributes({
        ...attributes,
        env: attributes.env || activeEnv,
      }),
    });
  }

  for (const [name, dataPoints] of counterGrouped.entries()) {
    metricsList.push({
      name,
      unit: name.includes('_bytes_') ? 'By' : '1',
      description: `Cumulative ${name} aggregated in-memory`,
      gauge: { dataPoints },
    });
  }

  if (cumTotalReqs > 0) {
    const cumErrPct = Number(((cumTotalErrors / cumTotalReqs) * 100).toFixed(2));
    metricsList.push({
      name: 'http_cluster_cumulative_error_rate_percentage',
      unit: '%',
      description: 'Global all-time cumulative HTTP error rate percentage across instances',
      gauge: {
        dataPoints: [
          {
            asDouble: cumErrPct,
            timeUnixNano,
            attributes: toOtlpMetricAttributes({ env: activeEnv }),
          },
        ],
      },
    });
  }

  return metricsList;
}

export const formatRedisMetrics = formatCounterMetrics;

/**
 * Computes request rate, error rate, and latency gauges and queues them on the metrics instance.
 */
export function recordCalculatedGauges(metricsInst, localStats, rateHash = null) {
  let rps = localStats.requestRatePerSec;
  let rpm = localStats.requestRatePerMin;
  let errorRatePct = localStats.errorRatePercentage;
  let errorRateRatio = localStats.errorRateRatio;
  let clientErrorRatePct = localStats.clientErrorRatePercentage;
  let serverErrorRatePct = localStats.serverErrorRatePercentage;
  const endpointRates = { ...localStats.endpoints };

  if (rateHash && typeof rateHash === 'object' && rateHash.total) {
    const elapsedSec = Math.max(1, Math.floor((Date.now() % 60000) / 1000));
    const clusterTotal = parseInt(rateHash.total, 10) || 0;
    const clusterErrors = parseInt(rateHash.errors, 10) || 0;
    const cluster4xx = parseInt(rateHash.errors_4xx, 10) || 0;
    const cluster5xx = parseInt(rateHash.errors_5xx, 10) || 0;

    if (clusterTotal > 0) {
      rps = clusterTotal / elapsedSec;
      rpm = (clusterTotal / elapsedSec) * 60;
      errorRatePct = (clusterErrors / clusterTotal) * 100;
      errorRateRatio = clusterErrors / clusterTotal;
      clientErrorRatePct = (cluster4xx / clusterTotal) * 100;
      serverErrorRatePct = (cluster5xx / clusterTotal) * 100;

      for (const [key, val] of Object.entries(rateHash)) {
        if (key.startsWith('ep:') && key.endsWith(':total')) {
          const ep = key.slice(3, -6);
          const epTotal = parseInt(val, 10) || 0;
          const epErrors = parseInt(rateHash[`ep:${ep}:errors`] || '0', 10) || 0;
          endpointRates[ep] = {
            count: epTotal,
            errors: epErrors,
            requestRatePerSec: epTotal / elapsedSec,
            errorRatePercentage: epTotal > 0 ? (epErrors / epTotal) * 100 : 0,
          };
        }
      }
    }
  }

  metricsInst.record('http_request_rate_per_second', rps, {
    unit: '1/s',
    description: 'Current HTTP request rate in requests per second (RPS)',
  });
  metricsInst.record('http_request_rate_per_minute', rpm, {
    unit: '1/min',
    description: 'Current HTTP request rate in requests per minute (RPM)',
  });
  metricsInst.record('http_error_rate_percentage', errorRatePct, {
    unit: '%',
    description: 'HTTP error rate percentage (status >= 400)',
  });
  metricsInst.record('http_error_rate_ratio', errorRateRatio, {
    unit: '1',
    description: 'HTTP error rate ratio (0.0 to 1.0)',
  });
  metricsInst.record('http_client_error_rate_percentage', clientErrorRatePct, {
    unit: '%',
    description: 'HTTP 4xx client error rate percentage',
  });
  metricsInst.record('http_server_error_rate_percentage', serverErrorRatePct, {
    unit: '%',
    description: 'HTTP 5xx server error rate percentage',
  });
  metricsInst.record('http_active_requests', localStats.activeRequests, {
    unit: '1',
    description: 'Concurrent active in-flight HTTP requests',
  });

  if (localStats.count > 0) {
    metricsInst.record('http_request_duration_avg_ms', localStats.durationAvgMs, {
      unit: 'ms',
      description: 'Average HTTP request latency in milliseconds',
    });
    metricsInst.record('http_request_duration_min_ms', localStats.durationMinMs, {
      unit: 'ms',
      description: 'Minimum HTTP request latency in milliseconds',
    });
    metricsInst.record('http_request_duration_max_ms', localStats.durationMaxMs, {
      unit: 'ms',
      description: 'Maximum HTTP request latency in milliseconds',
    });
    if (localStats.count >= 5) {
      metricsInst.record('http_request_duration_p95_ms', localStats.durationP95Ms, {
        unit: 'ms',
        description: '95th percentile HTTP request latency in milliseconds',
      });
    }
  }

  for (const [ep, data] of Object.entries(endpointRates)) {
    metricsInst.record('http_endpoint_request_rate_per_second', data.requestRatePerSec, {
      unit: '1/s',
      description: 'Per-endpoint HTTP request rate in requests per second',
      attributes: { endpoint: ep },
    });
    metricsInst.record('http_endpoint_error_rate_percentage', data.errorRatePercentage, {
      unit: '%',
      description: 'Per-endpoint HTTP error rate percentage',
      attributes: { endpoint: ep },
    });
  }
}

/**
 * Wrap metrics list into standard OpenTelemetry ResourceMetrics payload structure.
 */
export function buildOtlpResourcePayload({ serviceName = 'teach4all', activeEnv = 'development', metrics = [] } = {}) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'deployment.environment', value: { stringValue: activeEnv } },
            { key: 'env', value: { stringValue: activeEnv } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'teach4all-metrics', version: '0.2.0' },
            metrics,
          },
        ],
      },
    ],
  };
}
