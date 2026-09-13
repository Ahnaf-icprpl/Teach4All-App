import { getClientIp } from './rateLimiter.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { handleTitleRequest } from './titleApi.js';
import { handleConversationsRequest, handleMessagesRequest } from './historyApi.js';
import { handleErrorLogRequest } from './errorApi.js';
import { handleUiTextsRequest, handleChatPromptsRequest } from './uiTextsApi.js';
import { handleQuizzesRequest } from './quizzesApi.js';
import { handleMaterialsRequest } from './materialsApi.js';

export async function dispatchApi(handler, req, res, serverEnv, routeName) {
  try {
    await handler(req, res, serverEnv);
  } catch (err) {
    logger.error(`Unhandled error in ${routeName} middleware`, { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal server error.' } }));
    }
  }
}

export function createChatMiddleware(serverEnv = {}, chatHandler = null) {
  return async (req, res, next) => {
    const isDev = (serverEnv.ENV || serverEnv.env || process.env.ENV || process.env.env || '').toLowerCase() === 'development' || logger.isDev();
    const clientIp = getClientIp(req);
    const start = Date.now();
    const url = req.url ? req.url.split('?')[0] : '';
    const fullUrl = req.url || '/';
    const method = req.method || 'GET';

    if (isDev) {
      logger.info(`Incoming ${method} ${fullUrl}`, {
        dev_trace: true,
        method,
        url: fullUrl,
        client_ip: clientIp,
        user_agent: req.headers['user-agent'] || '',
      });
    }

    const endTracking = metrics.startRequest({ endpoint: url || fullUrl, method, req });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      endTracking();
      metrics.recordHttpRequest({ endpoint: url || fullUrl, method, status: res.statusCode, durationMs, req, res });
      metrics.flush().catch(() => {});
      if (isDev || res.statusCode >= 400) {
        const logMethod = res.statusCode >= 400 ? 'error' : 'info';
        logger[logMethod](`Completed ${method} ${fullUrl} -> ${res.statusCode} (${durationMs}ms)`, {
          dev_trace: true,
          method,
          url: fullUrl,
          status: res.statusCode,
          duration_ms: durationMs,
          client_ip: clientIp,
        });
        logger.flush().catch(() => {});
      }
    });

    const activeChatHandler = chatHandler || (await import('./chatApi.js')).handleChatRequest;

    const apiRoutes = {
      '/api/chat': activeChatHandler,
      '/api/title': handleTitleRequest,
      '/api/conversations': handleConversationsRequest,
      '/api/messages': handleMessagesRequest,
      '/api/log-error': handleErrorLogRequest,
      '/api/ui-texts': handleUiTextsRequest,
      '/api/chat-prompts': handleChatPromptsRequest,
      '/api/quizzes': handleQuizzesRequest,
      '/api/materials': handleMaterialsRequest,
    };
    const normUrl = (url.split('?')[0] || '').replace(/\/+$/, '') || '/';
    if (apiRoutes[normUrl]) {
      return dispatchApi(apiRoutes[normUrl], req, res, serverEnv, normUrl);
    }
    if (url.startsWith('/api/')) {
      logger.warn('API endpoint not found (404)', { endpoint: url, method, client_ip: clientIp });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Route ${url} not found` } }));
      return;
    }

    if (
      url !== '/' &&
      url !== '/index.html' &&
      url !== '/404.html' &&
      !url.startsWith('/@') &&
      !url.startsWith('/src/') &&
      !url.startsWith('/node_modules/') &&
      !url.includes('.')
    ) {
      logger.warn(`Route not found (404): ${url}`, { endpoint: url, method, client_ip: clientIp });
      const { load404HtmlTemplate } = await import('./ssr.js');
      const p404 = load404HtmlTemplate();
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(p404);
      return;
    }

    if (next) next();
  };
}
