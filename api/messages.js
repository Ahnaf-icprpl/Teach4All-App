import { handleMessagesRequest } from '../server/historyApi.js';

export default async function handler(req, res) {
  try {
    await handleMessagesRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Internal server error.' } }));
    }
  }
}
