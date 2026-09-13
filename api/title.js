import { handleTitleRequest } from '../server/titleApi.js';
import { logger } from '../server/logger.js';
import { metrics } from '../server/metrics.js';

export default async function handler(req, res) {
  const start = Date.now();
  res.on('finish', () => {
    metrics.recordHttpRequest({
      endpoint: '/api/title',
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  try {
    await handleTitleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Internal server error.' } }));
    }
  } finally {
    await Promise.allSettled([logger.flush(), metrics.flush()]);
  }
}
