import { getMaterials, getMaterialById, createMaterial, setMaterialSolvedStatus, DEFAULT_USER_ID } from './db.js';
import { enforceRateLimit } from './rateLimiter.js';

function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(req.body || '{}'));
    } catch {
      return Promise.reject(new Error('Invalid JSON'));
    }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('Payload Too Large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export async function handleMaterialsRequest(req, res, env = {}) {
  if (!(await enforceRateLimit(req, res, '/api/materials', env))) {
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;
  const userId = req.userId || DEFAULT_USER_ID;

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    const category = url.searchParams.get('category') || undefined;
    const search = url.searchParams.get('search') || url.searchParams.get('q') || undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

    try {
      if (id) {
        const material = await getMaterialById(id, { userId, databaseUrl: dbUrl });
        if (!material) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Material not found.' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ material }));
        return;
      }

      const materials = await getMaterials({ userId, search, category, limit, offset, databaseUrl: dbUrl });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ materials }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to retrieve materials.' } }));
    }
    return;
  }

  if (req.method === 'POST') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (err) {
      res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }

    try {
      if (!payload.title || typeof payload.title !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Title is required.' } }));
        return;
      }
      const material = await createMaterial({ ...payload, userId }, payload.sections || [], { databaseUrl: dbUrl });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ material }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to create material.' } }));
    }
    return;
  }

  if (req.method === 'PATCH') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (err) {
      res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message || 'Invalid request' } }));
      return;
    }

    try {
      const id = payload.id || url.searchParams.get('id');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'ID is required.' } }));
        return;
      }
      const isSolved = payload.isSolved !== undefined ? payload.isSolved : payload.is_solved !== undefined ? payload.is_solved : true;
      const updated = await setMaterialSolvedStatus(id, isSolved, { userId, databaseUrl: dbUrl });
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Material not found.' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ material: updated }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to update material.' } }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
}
