import { query } from './db.js';
import { enforceRateLimit } from './rateLimiter.js';
import { getClerkConfig } from './clerkVerifier.js';

export async function getUiTextsFromDb(databaseUrl = process.env.DATABASE_URL) {
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

export async function getChatPromptsFromDb(databaseUrl = process.env.DATABASE_URL) {
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

export async function getGoogleTagIdFromDb(databaseUrl = process.env.DATABASE_URL) {
  try {
    const rows = await query("SELECT value FROM ui_texts WHERE key = 'google_tag_id' LIMIT 1;", [], databaseUrl);
    if (Array.isArray(rows) && rows.length > 0 && rows[0].value) {
      return String(rows[0].value).trim();
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
    const texts = await getUiTextsFromDb(dbUrl);
    const prompts = await getChatPromptsFromDb(dbUrl);
    const appEnv = env.ENV || env.env || process.env.ENV || process.env.env || 'development';
    const clerkConfig = getClerkConfig(env);
    const authConfig = {
      publishableKey: clerkConfig.publishableKey,
      frontendApi: clerkConfig.frontendApi,
      accountsUrl: clerkConfig.accountsUrl,
      handshakeUrl: `${clerkConfig.frontendApi.replace(/\/$/, '')}/v1/client/handshake`,
      signInUrl: `${clerkConfig.accountsUrl.replace(/\/$/, '')}/sign-in`,
      signUpUrl: `${clerkConfig.accountsUrl.replace(/\/$/, '')}/sign-up`,
      userProfileUrl: `${clerkConfig.accountsUrl.replace(/\/$/, '')}/user`,
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
