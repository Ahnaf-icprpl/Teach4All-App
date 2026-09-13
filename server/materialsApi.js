import { getMaterials, getMaterialById, createMaterial } from './db.js';
import { logger } from './logger.js';
import { getClientIp } from './rateLimiter.js';

export async function handleMaterialsRequest(req, res, env = {}) {
  const clientIp = getClientIp(req);
  const url = new URL(req.url, 'http://localhost');
  const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    const category = url.searchParams.get('category') || undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

    try {
      if (id) {
        const material = await getMaterialById(id, { databaseUrl: dbUrl });
        if (!material) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Material not found.' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ material }));
        return;
      }

      const materials = await getMaterials({ category, limit, offset, databaseUrl: dbUrl });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ materials }));
    } catch (err) {
      logger.error('Failed to retrieve materials from database', { error: err.message, client_ip: clientIp });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to retrieve materials.' } }));
    }
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    try {
      body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
          if (data.length > 1e6) reject(new Error('Payload Too Large'));
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
    } catch (err) {
      res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }

    try {
      const payload = JSON.parse(body || '{}');
      if (!payload.title || typeof payload.title !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Title is required.' } }));
        return;
      }
      const material = await createMaterial(payload, payload.sections || [], { databaseUrl: dbUrl });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ material }));
    } catch (err) {
      logger.error('Failed to create material in database', { error: err.message, client_ip: clientIp });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to create material.' } }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
}
