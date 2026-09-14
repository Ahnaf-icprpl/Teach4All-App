import { createApp } from './app.js';
import { logger } from './logger.js';

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
  const app = createApp(serverEnv);
  if (chatHandler) {
    app.post('/api/chat', (req, res) => chatHandler(req, res, serverEnv));
  }
  return app;
}
