import { handleUiTextsRequest } from '../server/uiTextsApi.js';
import { logger } from '../server/logger.js';
import { metrics } from '../server/metrics.js';

export default async function handler(req, res) {
  const start = Date.now();
  const endTracking = metrics.startRequest({ endpoint: '/api/ui-texts', method: req.method, req });
  res.on('finish', () => {
    endTracking();
    metrics.recordHttpRequest({
      endpoint: '/api/ui-texts',
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - start,
      req,
      res,
    });
  });

  try {
    await handleUiTextsRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Internal server error.' } }));
    }
  } finally {
    await Promise.allSettled([logger.flush(), metrics.flush()]);
  }
}
