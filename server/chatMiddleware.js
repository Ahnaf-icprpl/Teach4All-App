import { createApp } from './app.js';

export async function dispatchApi(handler, req, res, serverEnv, routeName) {
  try {
    await handler(req, res, serverEnv);
  } catch (err) {
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
