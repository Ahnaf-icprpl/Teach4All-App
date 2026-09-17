import express from 'express';
import { authRouter } from './routes/authRoutes.js';
import { chatRouter } from './routes/chatRoutes.js';
import { historyRouter } from './routes/historyRoutes.js';
import { studyRouter } from './routes/studyRoutes.js';
import { uiRouter } from './routes/uiRoutes.js';
import { clerkHandshakeMiddleware, authContextMiddleware } from './authApi.js';
import { enforceRateLimit } from './rateLimiter.js';
import { load404HtmlTemplate } from './ssr.js';
import { metricsMiddleware, handleMetricsRequest } from './metrics.js';
import { logger, requestLoggerMiddleware } from './logger.js';

export function createApp(serverEnv = {}) {
  const app = express();

  // 1. Security & Header Defaults
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('query parser', 'simple');

  // 1.5 OTLP Telemetry (Metrics & Request Logging with Trace Correlation)
  app.use(metricsMiddleware);
  app.use(requestLoggerMiddleware);
  app.get('/metrics', (req, res) => handleMetricsRequest(req, res, serverEnv));

  // 2. Request Body Parsing & Auth Handshake Interception
  app.use(clerkHandshakeMiddleware);
  app.use(express.json({ limit: '500kb' }));

  // 2.5 Authoritative Auth Context Middleware for API routes
  app.use('/api', authContextMiddleware(serverEnv));

  // 3. Mount Domain API Routers
  app.use('/api', authRouter(serverEnv));
  app.use('/api', chatRouter(serverEnv));
  app.use('/api', historyRouter(serverEnv));
  app.use('/api', studyRouter(serverEnv));
  app.use('/api', uiRouter(serverEnv));

  // 4. 404 Handler for Unmatched API Routes
  app.use('/api', async (req, res) => {
    if (!(await enforceRateLimit(req, res, '*', serverEnv))) {
      return;
    }
    const endpoint = req.originalUrl || req.url || '/';
    if (typeof res.status === 'function') {
      res.status(404).json({ error: { message: `Route ${endpoint} not found` } });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Route ${endpoint} not found` } }));
    }
  });

  // 5. 404 Fallback for Non-Asset Application Routes
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
      const p404 = load404HtmlTemplate({ serverEnv });
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

  // 6. Global Centralized Error Boundary
  app.use((err, req, res, next) => {
    logger.error(`Unhandled server error on ${req.method} ${req.originalUrl || req.url}`, err, {
      'http.route': req.originalUrl || req.url,
      'http.method': req.method,
      'error.status': err.status || 500,
    });
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
