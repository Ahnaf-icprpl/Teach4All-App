import crypto from 'node:crypto';
import pg from 'pg';
import { logger } from './logger.js';

const { Pool } = pg;

const pools = new Map();

/**
 * Configure SSL based on database connection string and environment.
 */
export function getSslConfig(connectionString) {
  if (!connectionString) return false;
  const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  if (isLocalhost && !connectionString.includes('sslmode=require')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

/**
 * Retrieve or instantiate a connection pool for the specified databaseUrl.
 */
export function getPool(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return null;
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: getSslConfig(databaseUrl),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true,
    });

    pool.on('error', () => {});

    pools.set(databaseUrl, pool);
  }
  return pool;
}

/**
 * Cleanly close all active PostgreSQL pools.
 */
export async function closePools() {
  for (const pool of pools.values()) {
    try {
      await pool.end();
    } catch {}
  }
  pools.clear();
}

/**
 * Execute parameterized query returning rows directly.
 */
export async function query(sql, params = [], databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return [];
  const pool = getPool(databaseUrl);
  if (!pool) return [];
  const res = await pool.query(sql, params);
  return res.rows || [];
}

/**
 * Execute SQL via pg driver.
 * Returns stringified rows or formatted output for compatibility with stdout inspections.
 */
export async function runSql(sql, databaseUrl = process.env.DATABASE_URL, params = []) {
  if (!databaseUrl) return '';
  const pool = getPool(databaseUrl);
  if (!pool) return '';

  const res = params && params.length > 0 ? await pool.query(sql, params) : await pool.query(sql);
  if (Array.isArray(res)) {
    return res.map(r => JSON.stringify(r.rows || [])).join('\n');
  }
  if (res && res.rows && res.rows.length > 0) {
    return JSON.stringify(res.rows);
  }
  return '';
}

/**
 * Safely escape string literals for SQL (kept for utility compatibility).
 */
export function escapeSqlString(str) {
  if (typeof str !== 'string') return "''";
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Ensure string is valid UUID format.
 */
export function toUuid(id) {
  if (typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id.trim())) {
    return id.trim();
  }
  return crypto.randomUUID();
}

/**
 * Normalize and validate user ID (supports Clerk user IDs and guest UUIDs).
 */
export function toUserId(id) {
  if (typeof id === 'string' && id.trim()) {
    return id.trim();
  }
  return null;
}

/**
 * Ensure a user record exists in the database.
 */
export async function ensureUserExists(userId, databaseUrl = process.env.DATABASE_URL) {
  const uId = toUserId(userId);
  if (!uId || !databaseUrl) return;
  const pool = getPool(databaseUrl);
  if (!pool) return;
  try {
    const username = uId.startsWith('guest_') ? 'teach4all_guest' : 'teach4all_user';
    await pool.query(
      `INSERT INTO users (id, username, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO NOTHING;`,
      [uId, username]
    );
  } catch {}
}

/**
 * Upsert Clerk user profile info into the database users table.
 */
export async function syncUserToDb(user = {}, databaseUrl = process.env.DATABASE_URL) {
  const userId = typeof user?.id === 'string' ? user.id.trim() : null;
  if (!userId || !databaseUrl) return null;
  const pool = getPool(databaseUrl);
  if (!pool) return null;

  const sql = `
    INSERT INTO users (id, email, name, first_name, last_name, avatar_url, username, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      name = CASE
        WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != 'User' AND EXCLUDED.name != 'Pengguna' THEN EXCLUDED.name
        WHEN users.name IS NOT NULL AND users.name != 'User' AND users.name != 'Pengguna' THEN users.name
        ELSE COALESCE(EXCLUDED.name, users.name, 'Pengguna')
      END,
      first_name = COALESCE(EXCLUDED.first_name, users.first_name),
      last_name = COALESCE(EXCLUDED.last_name, users.last_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
      username = COALESCE(EXCLUDED.username, users.username),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;

  const fallbackUsername =
    user.username ||
    user.email?.split('@')[0] ||
    (user.name ? user.name.replace(/\s+/g, '_').toLowerCase() : null) ||
    (userId.startsWith('guest_') ? 'teach4all_guest' : 'teach4all_user');

  try {
    const res = await pool.query(sql, [
      userId,
      user.email || null,
      user.name || null,
      user.firstName || user.first_name || null,
      user.lastName || user.last_name || null,
      user.avatarUrl || user.avatar_url || null,
      fallbackUsername,
    ]);
    return res.rows[0] || null;
  } catch (err) {
    logger.error('Failed to sync user to database', err, { userId });
    return null;
  }
}

/**
 * Retrieve user record from database users table.
 */
export async function getUserFromDb(userId, databaseUrl = process.env.DATABASE_URL) {
  const uId = toUserId(userId);
  if (!uId || !databaseUrl) return null;
  const pool = getPool(databaseUrl);
  if (!pool) return null;
  try {
    const res = await pool.query(
      'SELECT id, email, name, first_name, last_name, avatar_url, username FROM users WHERE id = $1 LIMIT 1;',
      [uId]
    );
    if (res.rows && res.rows[0]) {
      const row = res.rows[0];
      const rawName = row.name && row.name !== 'User' && row.name !== 'Pengguna' ? row.name : null;
      const partsName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      const emailName = row.email && row.email.includes('@')
        ? row.email.split('@')[0].charAt(0).toUpperCase() + row.email.split('@')[0].slice(1)
        : null;
      const fullName = rawName || (partsName && partsName !== 'User' ? partsName : null) ||
        (row.username && row.username !== 'teach4all_user' ? row.username : null) ||
        emailName ||
        'Pengguna';
      return {
        id: row.id,
        email: row.email || null,
        name: fullName,
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        avatarUrl: row.avatar_url || null,
        username: row.username || null,
      };
    }
  } catch {}
  return null;
}

export const inMemoryConversations = new Map();
export const inMemoryMessages = new Map();

/**
 * Query JSON from PostgreSQL safely via pg driver.
 */
export async function queryJson(sql, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return null;
  const pool = getPool(databaseUrl);
  if (!pool) return null;
  try {
    const res = await pool.query(sql);
    if (!res || !res.rows || res.rows.length === 0) return null;
    const firstRow = res.rows[0];
    const firstKey = Object.keys(firstRow)[0];
    const val = firstRow[firstKey];
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  } catch {
    return null;
  }
}
