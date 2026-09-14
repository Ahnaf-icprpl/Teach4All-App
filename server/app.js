import express from 'express';
import { getClientIp } from './rateLimiter.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { chatRouter } from './routes/chatRoutes.js';
import { historyRouter } from './routes/historyRoutes.js';
import { studyRouter } from './routes/studyRoutes.js';
import { uiRouter } from './routes/uiRoutes.js';
import { load404HtmlTemplate } from './ssr.js';

export function createApp(serverEnv = {}) {
  const app = express();

  // 1. Security & Header Defaults
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  // 2. Request Body Parsing
  app.use(express.json({ limit: '500kb' }));

  // 3. Telemetry & Dev Logging Middleware
  app.use((req, res, next) => {
    const isDev = (serverEnv.ENV || serverEnv.env || process.env.ENV || process.env.env || '').toLowerCase() === 'development' || logger.isDev();
    const clientIp = getClientIp(req);
    const start = Date.now();
    const fullUrl = req.originalUrl || req.url || '/';
    const cleanUrl = fullUrl.split('?')[0];

    if (isDev) {
      logger.info(`Incoming ${req.method} ${fullUrl}`, {
        dev_trace: true,
        method: req.method,
        url: fullUrl,
        client_ip: clientIp,
        user_agent: req.headers['user-agent'] || '',
      });
    }

    const endTracking = metrics.startRequest({ endpoint: cleanUrl, method: req.method, req });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      endTracking();
      metrics.recordHttpRequest({ endpoint: cleanUrl, method: req.method, status: res.statusCode, durationMs, req, res });
      metrics.flush().catch(() => {});

      if (isDev || res.statusCode >= 400) {
        const level = res.statusCode >= 400 ? 'error' : 'info';
        logger[level](`Completed ${req.method} ${fullUrl} -> ${res.statusCode} (${durationMs}ms)`, {
          dev_trace: true,
          method: req.method,
          url: fullUrl,
          status: res.statusCode,
          duration_ms: durationMs,
          client_ip: clientIp,
        });
        logger.flush().catch(() => {});
      }
    });

    next();
  });

  // 4. Mount Domain API Routers
  app.use('/api', chatRouter(serverEnv));
  app.use('/api', historyRouter(serverEnv));
  app.use('/api', studyRouter(serverEnv));
  app.use('/api', uiRouter(serverEnv));

  // 5. 404 Handler for Unmatched API Routes
  app.use('/api', (req, res) => {
    const endpoint = req.originalUrl || req.url || '/';
    logger.warn('API endpoint not found (404)', { endpoint, method: req.method, client_ip: getClientIp(req) });
    if (typeof res.status === 'function') {
      res.status(404).json({ error: { message: `Route ${endpoint} not found` } });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Route ${endpoint} not found` } }));
    }
  });

  // 6. 404 Fallback for Non-Asset Application Routes
  app.use((req, res, next) => {
    const fullUrl = req.originalUrl || req.url || '';
    const cleanUrl = fullUrl.split('?')[0];
    if (
      cleanUrl !== '/' &&
      cleanUrl !== '/index.html' &&
      cleanUrl !== '/404.html' &&
      !cleanUrl.startsWith('/@') &&
      !cleanUrl.startsWith('/src/') &&
      !cleanUrl.startsWith('/node_modules/') &&
      !cleanUrl.includes('.')
    ) {
      logger.warn(`Route not found (404): ${cleanUrl}`, { endpoint: cleanUrl, method: req.method, client_ip: getClientIp(req) });
      const p404 = load404HtmlTemplate();
      if (typeof res.status === 'function') {
        res.status(404).type('text/html; charset=utf-8').send(p404);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(p404);
      }
      return;
    }
    next();
  });

  // 7. Global Centralized Error Boundary
  app.use((err, req, res, next) => {
    const path = req.originalUrl || req.url || '/';
    logger.error('Unhandled server error', { error: err.message, stack: err.stack, path });
    if (!res.headersSent) {
      if (typeof res.status === 'function') {
        res.status(err.status || 500).json({ error: { message: err.message || 'Internal server error.' } });
      } else {
        res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message || 'Internal server error.' } }));
      }
    }
  });

  return app;
}
