import { query } from './db.js';
import { enforceRateLimit } from './rateLimiter.js';
import { getClerkConfig } from './clerkVerifier.js';

export const UI_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const uiCache = new Map();
const pendingFetches = new Map();

/**
 * Clear cached UI texts and prompts (optionally for a specific databaseUrl).
 */
export function clearUiCache(databaseUrl) {
  if (databaseUrl) {
    uiCache.delete(databaseUrl);
    pendingFetches.delete(databaseUrl);
  } else {
    uiCache.clear();
    pendingFetches.clear();
  }
}

/**
 * Fallback loader for UI texts using standard SELECT.
 */
async function fetchUiTextsFallback(databaseUrl) {
  const rows = await query('SELECT key, value FROM ui_texts ORDER BY key ASC;', [], databaseUrl);
  const texts = {};
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.key && typeof row.value === 'string') {
        texts[row.key] = row.value;
      }
    }
  }
  return texts;
}

/**
 * Fallback loader for chat prompts using standard SELECT.
 */
async function fetchChatPromptsFallback(databaseUrl) {
  const rows = await query('SELECT id, title, detail, prompt, icon, color FROM chat_prompts ORDER BY id ASC;', [], databaseUrl);
  return Array.isArray(rows) ? rows.map(r => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    prompt: r.prompt,
    icon: r.icon,
    color: r.color,
  })) : [];
}

/**
 * Fetches UI texts and chat prompts in a single database query using PostgreSQL
 * JSON aggregation, caching the result in memory for 10 minutes (TTL).
 */
export async function getUiDataFromDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return { texts: {}, prompts: [] };

  const cacheKey = databaseUrl;
  const now = Date.now();
  const cached = uiCache.get(cacheKey);

  if (cached && cached.expiresAt > now && Object.keys(cached.texts || {}).length > 0) {
    return { texts: cached.texts, prompts: cached.prompts };
  }

  if (pendingFetches.has(cacheKey)) {
    return pendingFetches.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const rows = await query(`
        SELECT
          COALESCE((SELECT json_object_agg(key, value) FROM ui_texts), '{}'::json) AS texts,
          COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'detail', detail, 'prompt', prompt, 'icon', icon, 'color', color) ORDER BY id ASC) FROM chat_prompts), '[]'::json) AS prompts;
      `, [], databaseUrl);

      let texts = {};
      let prompts = [];

      if (Array.isArray(rows) && rows.length > 0 && rows[0]) {
        const rawTexts = rows[0].texts;
        texts = (typeof rawTexts === 'string' ? JSON.parse(rawTexts) : rawTexts) || {};
        const rawPrompts = rows[0].prompts;
        prompts = (typeof rawPrompts === 'string' ? JSON.parse(rawPrompts) : rawPrompts) || [];
      }

      if (Object.keys(texts).length > 0 || prompts.length > 0) {
        uiCache.set(cacheKey, {
          texts,
          prompts,
          expiresAt: Date.now() + UI_CACHE_TTL_MS,
        });
      }

      return { texts, prompts };
    } catch (err) {
      try {
        const texts = await fetchUiTextsFallback(databaseUrl);
        const prompts = await fetchChatPromptsFallback(databaseUrl);
        if (Object.keys(texts).length > 0 || prompts.length > 0) {
          uiCache.set(cacheKey, {
            texts,
            prompts,
            expiresAt: Date.now() + UI_CACHE_TTL_MS,
          });
        }
        return { texts, prompts };
      } catch (fallbackErr) {
        if (cached?.texts) {
          return { texts: cached.texts, prompts: cached.prompts };
        }
        throw fallbackErr || err;
      }
    } finally {
      pendingFetches.delete(cacheKey);
    }
  })();

  pendingFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function getUiTextsFromDb(databaseUrl = process.env.DATABASE_URL) {
  const data = await getUiDataFromDb(databaseUrl);
  return data.texts || {};
}

export async function getChatPromptsFromDb(databaseUrl = process.env.DATABASE_URL) {
  const data = await getUiDataFromDb(databaseUrl);
  return data.prompts || [];
}

export async function getGoogleTagIdFromDb(databaseUrl = process.env.DATABASE_URL) {
  try {
    const texts = await getUiTextsFromDb(databaseUrl);
    if (texts?.google_tag_id) {
      return String(texts.google_tag_id).trim();
    }
  } catch {}
  return null;
}

export async function handleUiTextsRequest(req, res, env = {}) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
    return;
  }

  if (!(await enforceRateLimit(req, res, '/api/ui-texts', env))) {
    return;
  }

  try {
    const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;
    const { texts, prompts } = await getUiDataFromDb(dbUrl);
    const appEnv = env.ENV || env.env || process.env.ENV || process.env.env || 'development';
    const clerkConfig = getClerkConfig(env);
    const frontend = (clerkConfig.frontendApi || '').replace(/\/$/, '');
    const accounts = (clerkConfig.accountsUrl || '').replace(/\/$/, '');
    const authConfig = {
      publishableKey: clerkConfig.publishableKey || '',
      frontendApi: frontend,
      accountsUrl: accounts,
      handshakeUrl: frontend ? `${frontend}/v1/client/handshake` : '',
      signInUrl: accounts ? `${accounts}/sign-in` : '',
      signUpUrl: accounts ? `${accounts}/sign-up` : '',
      userProfileUrl: accounts ? `${accounts}/user` : '',
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ texts, prompts, env: appEnv, auth: authConfig }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Failed to load UI texts and prompts from database.' } }));
  }
}

export async function handleChatPromptsRequest(req, res, env = {}) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
    return;
  }

  if (!(await enforceRateLimit(req, res, '/api/chat-prompts', env))) {
    return;
  }

  try {
    const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;
    const prompts = await getChatPromptsFromDb(dbUrl);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ prompts }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Failed to load chat prompts from database.' } }));
  }
}
