import { handleTitleRequest } from '../server/titleApi.js';
import { logger } from '../server/logger.js';

export default async function handler(req, res) {
  try {
    await handleTitleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Internal server error.' } }));
    }
  } finally {
    await logger.flush();
  }
}
