import { handleSsrRequest } from '../server/ssr.js';
import { logger } from '../server/logger.js';
import { metrics } from '../server/metrics.js';

export default async function handler(req, res) {
  const start = Date.now();
  res.on('finish', () => {
    metrics.recordHttpRequest({
      endpoint: req.url || '/',
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - start,
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
