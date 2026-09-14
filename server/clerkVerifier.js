import crypto from 'node:crypto';
import { syncUserToDb } from './db.js';

let jwksCache = { keys: null, expiresAt: 0 };
const userCache = new Map();
const sessionCache = new Map();

/**
 * Resolves Clerk environment variables.
 */
export function getClerkConfig(serverEnv = {}) {
  const publishableKey =
    serverEnv.CLERK_PUBLISHABLE_KEY ||
    serverEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    serverEnv.PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.PUBLISHABLE_KEY ||
    'pk_test_b3V0Z29pbmctZmVsaW5lLTY3NDEuY2xlcmsuYWNjb3VudHMuZGV2JA';

  const secretKey =
    serverEnv.CLERK_SECRET_KEY ||
    process.env.CLERK_SECRET_KEY ||
    'sk_test_eEGOFwtFsyPUtLDlvQw1W5ro3sXKbdFF3iw4cmEWo2';

  let derivedFrontendDomain = null;
  try {
    const raw = publishableKey.split('_')[2];
    if (raw) {
      const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/\$$/, '');
      if (decoded && decoded.includes('.')) {
        derivedFrontendDomain = decoded;
      }
    }
  } catch {}

  let frontendApi =
    serverEnv.CLERK_FRONTEND_API ||
    process.env.CLERK_FRONTEND_API ||
    (derivedFrontendDomain ? `https://${derivedFrontendDomain}` : 'https://outgoing-feline-6741.clerk.accounts.dev');

  let accountsUrl =
    serverEnv.CLERK_ACCOUNTS_URL ||
    process.env.CLERK_ACCOUNTS_URL;

  if (!accountsUrl || accountsUrl.includes('api.clerk.com')) {
    if (frontendApi.includes('clerk.accounts.dev')) {
      accountsUrl = frontendApi.replace(/\.clerk\.accounts\.dev/i, '.accounts.dev');
    } else if (frontendApi.includes('clerk.')) {
      accountsUrl = frontendApi.replace(/^https?:\/\/clerk\./i, 'https://accounts.');
    } else {
      accountsUrl = frontendApi;
    }
  }

  return { publishableKey, secretKey, frontendApi, accountsUrl };
}

/**
 * Parses raw Cookie header string into an object.
 */
export function parseCookies(header = '') {
  const cookies = {};
  if (typeof header !== 'string' || !header) return cookies;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) {
        cookies[key] = decodeURIComponent(val);
      }
    }
  }
  return cookies;
}

/**
 * Fetches and caches Clerk JWKS for RSA token verification.
 */
export async function getClerkJwks(frontendApi) {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }
  try {
    const url = `${frontendApi.replace(/\/$/, '')}/.well-known/jwks.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch JWKS (${res.status})`);
    }
    const data = await res.json();
    jwksCache = {
      keys: data.keys || [],
      expiresAt: now + 3600 * 1000, // 1 hour cache
    };
    return jwksCache.keys;
  } catch (err) {
    if (jwksCache.keys) return jwksCache.keys;
    throw err;
  }
}

/**
 * Verifies a Clerk JWT token using native node:crypto and JWKS keys.
 */
export async function verifyClerkJwt(token, frontendApi) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token format');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT structure');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  if (!header.kid) {
    throw new Error('Token header missing kid');
  }

  const keys = await getClerkJwks(frontendApi);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`Public key not found for kid: ${header.kid}`);
  }

  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(sigB64, 'base64url');

  const isValid = crypto.verify('RSA-SHA256', data, keyObject, signature);
  if (!isValid) {
    throw new Error('Invalid JWT signature');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token has expired');
  }
  if (payload.nbf && payload.nbf > now) {
    throw new Error('Token is not active yet');
  }

  return payload;
}

/**
 * Fetches user profile from Clerk API with in-memory caching.
 */
export async function getClerkUser(userId, secretKey, databaseUrl = process.env.DATABASE_URL) {
  if (!userId) return null;
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const primaryEmail = data.email_addresses?.[0]?.email_address || null;

    // Extract Google OAuth account details if connected
    const googleAccount = Array.isArray(data.external_accounts)
      ? data.external_accounts.find(acc => {
          const prov = String(acc?.provider || '').toLowerCase();
          return prov === 'google' || prov === 'oauth_google' || prov.includes('google');
        })
      : null;

    const googlePfp =
      googleAccount?.image_url ||
      googleAccount?.avatar_url ||
      googleAccount?.picture ||
      (typeof data.image_url === 'string' && data.image_url.includes('googleusercontent.com') ? data.image_url : null);

    const avatarUrl =
      googlePfp ||
      (data.has_image ? data.image_url : null) ||
      data.image_url ||
      data.profile_image_url ||
      null;

    const firstName = data.first_name || googleAccount?.first_name || '';
    const lastName = data.last_name || googleAccount?.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() ||
      data.username ||
      googleAccount?.username ||
      primaryEmail?.split('@')[0] ||
      'User';

    const user = {
      id: data.id,
      email: primaryEmail,
      name: fullName,
      firstName,
      lastName,
      avatarUrl,
      googleAvatarUrl: googlePfp || null,
      username: data.username || googleAccount?.username || null,
    };

    userCache.set(userId, {
      user,
      expiresAt: now + 300 * 1000, // 5 minutes cache
    });

    if (databaseUrl) {
      syncUserToDb(user, databaseUrl).catch(() => {});
    }

    return user;
  } catch {
    return null;
  }
}

/**
 * Verifies a session ID with Clerk API and retrieves user with in-memory caching.
 */
export async function verifyClerkSessionId(sessionId, secretKey, databaseUrl = process.env.DATABASE_URL) {
  if (!sessionId) return null;
  const now = Date.now();
  const cached = sessionCache.get(sessionId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  try {
    const res = await fetch(`https://api.clerk.com/v1/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      sessionCache.delete(sessionId);
      return null;
    }
    const session = await res.json();
    if (session.status !== 'active') {
      sessionCache.delete(sessionId);
      return null;
    }
    const user = await getClerkUser(session.user_id, secretKey, databaseUrl);
    const result = { session, user };
    sessionCache.set(sessionId, {
      ...result,
      expiresAt: now + 300 * 1000, // 5 minutes cache
    });
    return result;
  } catch {
    if (cached) return cached;
    return null;
  }
}

/**
 * Extracts auth credential (JWT token or session ID) from request.
 */
export function extractAuthCredential(req) {
  const headers = req.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  let token = null;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  const cookies = parseCookies(headers.cookie || '');
  if (!token) {
    token = cookies.__session || cookies.clerk_session || null;
  }

  let sessionId = headers['x-session-id'] || headers['X-Session-ID'] || cookies.clerk_session_id || null;

  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const qToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('__clerk_token');
    if (qToken) token = qToken;
    const qSession = parsedUrl.searchParams.get('sessionId') || parsedUrl.searchParams.get('session_id');
    if (qSession) sessionId = qSession;
  } catch {}

  if (req.body && typeof req.body === 'object') {
    if (req.body.token) token = req.body.token;
    if (req.body.sessionId) sessionId = req.body.sessionId;
  }

  if (token || sessionId) {
    return { token, sessionId };
  }

  return null;
}

/**
 * Authenticates request against Clerk (JWKS or Session API).
 */
export async function authenticateClerkRequest(req, serverEnv = {}) {
  const config = getClerkConfig(serverEnv);
  const dbUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const cred = extractAuthCredential(req);
  if (!cred) {
    return { authenticated: false, user: null, sessionId: null };
  }

  // 1. If it's a JWT token
  if (cred.token) {
    try {
      const payload = await verifyClerkJwt(cred.token, config.frontendApi);
      const userId = payload.sub;
      const user = await getClerkUser(userId, config.secretKey, dbUrl);
      const resolvedUser = user || { id: userId, name: 'User', email: null, avatarUrl: null };
      return {
        authenticated: true,
        user: resolvedUser,
        sessionId: payload.sid || null,
      };
    } catch {
      // Fallback: If JWT is expired or verification failed, inspect payload for session ID
      try {
        const parts = cred.token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          if (payload.sid) {
            const verified = await verifyClerkSessionId(payload.sid, config.secretKey, dbUrl);
            if (verified && verified.user) {
              return { authenticated: true, user: verified.user, sessionId: payload.sid };
            }
          }
        }
      } catch {}

      // Fallback: If token string is actually a sessionId
      if (cred.token.startsWith('sess_')) {
        const verified = await verifyClerkSessionId(cred.token, config.secretKey, dbUrl);
        if (verified && verified.user) {
          return { authenticated: true, user: verified.user, sessionId: cred.token };
        }
      }
    }
  }

  // 2. If it's a session ID
  if (cred.sessionId) {
    const verified = await verifyClerkSessionId(cred.sessionId, config.secretKey, dbUrl);
    if (verified && verified.user) {
      return { authenticated: true, user: verified.user, sessionId: cred.sessionId };
    }
  }

  return { authenticated: false, user: null, sessionId: null };
}
