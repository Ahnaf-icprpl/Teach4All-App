import { handleSsrRequest } from '../server/ssr.js';

export default async function handler(req, res) {
  try {
    await handleSsrRequest(req, res, process.env);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('SSR internal error.');
    }
  }
}
