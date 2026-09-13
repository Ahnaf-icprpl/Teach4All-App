import { handleSsrRequest } from '../server/ssr.js';
import { logger } from '../server/logger.js';
import { metrics } from '../server/metrics.js';

export default async function handler(req, res) {
  const start = Date.now();
  const endTracking = metrics.startRequest({ endpoint: req.url || '/', method: req.method, req });
  res.on('finish', () => {
    endTracking();
    metrics.recordHttpRequest({
      endpoint: req.url || '/',
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - start,
      req,
      res,
    });
  });

  try {
    await handleSsrRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('SSR internal error.');
    }
  } finally {
    await Promise.allSettled([logger.flush(), metrics.flush()]);
  }
}
