import crypto from 'node:crypto';
import { syncUserToDb, getUserFromDb } from './db.js';
import { parseCookies, getClerkJwks, verifyClerkJwt } from './clerkToken.js';

export { parseCookies, getClerkJwks, verifyClerkJwt };

const userCache = new Map();
const sessionCache = new Map();

/**
 * Resolves Clerk environment variables with full multi-alias fallback.
 */
export function getClerkConfig(serverEnv = {}) {
  const publishableKey = (
    serverEnv.CLERK_PUBLISHABLE_KEY ||
    serverEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    serverEnv.PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.PUBLISHABLE_KEY ||
    ''
  ).trim();

  const secretKey = (
    serverEnv.CLERK_SECRET_KEY ||
    serverEnv.CLERK_API_KEY ||
    serverEnv.CLERK_SECRET ||
    serverEnv.CLERK_SERVER_KEY ||
    serverEnv.SECRET_KEY ||
    process.env.CLERK_SECRET_KEY ||
    process.env.CLERK_API_KEY ||
    process.env.CLERK_SECRET ||
    process.env.CLERK_SERVER_KEY ||
    process.env.SECRET_KEY ||
    ''
  ).trim();

  let derivedFrontendDomain = null;
  if (publishableKey) {
    try {
      const raw = publishableKey.split('_')[2];
      if (raw) {
        const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/\$$/, '');
        if (decoded && decoded.includes('.')) {
          derivedFrontendDomain = decoded;
        }
      }
    } catch {}
  }

  let frontendApi = (
    serverEnv.CLERK_FRONTEND_API ||
    process.env.CLERK_FRONTEND_API ||
    (derivedFrontendDomain ? `https://${derivedFrontendDomain}` : '')
  ).trim();

  let accountsUrl = (
    serverEnv.CLERK_ACCOUNTS_URL ||
    process.env.CLERK_ACCOUNTS_URL ||
    ''
  ).trim();

  if ((!accountsUrl || accountsUrl.includes('api.clerk.com')) && frontendApi) {
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
 * Extracts profile information from JWT payload claims.
 */
export function extractProfileFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const id = payload.sub || payload.id;
  if (!id) return null;

  const email = payload.email || payload.email_address || payload.primary_email_address || null;
  const firstName = payload.first_name || payload.given_name || '';
  const lastName = payload.last_name || payload.family_name || '';
  const fullName = payload.name || payload.full_name || [firstName, lastName].filter(Boolean).join(' ').trim() ||
    payload.username || payload.preferred_username || (email ? email.split('@')[0] : null);
  const avatarUrl = payload.picture || payload.image_url || payload.avatar_url || payload.photo_url || null;
  const username = payload.username || payload.preferred_username || null;

  return {
    id,
    email: email || null,
    name: (fullName && fullName !== 'User') ? fullName : null,
    firstName: firstName || null,
    lastName: lastName || null,
    avatarUrl: avatarUrl || null,
    username: username || null,
  };
}

/**
 * Cleans and formats display name from user parts.
 */
function buildFullName(firstName, lastName, username, email, fallback = 'Pengguna') {
  const parts = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (parts && parts !== 'User') return parts;
  if (username && username !== 'teach4all_user') return username;
  if (email && email.includes('@')) {
    const local = email.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return fallback;
}

/**
 * Fetches user profile from Clerk API with fallback to database and token claims.
 */
export async function getClerkUser(userId, secretKey, databaseUrl = process.env.DATABASE_URL, extra = {}) {
  if (!userId) return null;
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > now && cached.user?.name && cached.user.name !== 'User' && cached.user.email) {
    return cached.user;
  }

  if (secretKey) {
    try {
      const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (res.ok) {
        const data = await res.json();
        const primaryEmail = data.email_addresses?.[0]?.email_address || extra.email || null;

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
          extra.avatarUrl ||
          null;

        const firstName = data.first_name || googleAccount?.first_name || extra.firstName || '';
        const lastName = data.last_name || googleAccount?.last_name || extra.lastName || '';
        const fullName = buildFullName(firstName, lastName, data.username || googleAccount?.username || extra.username, primaryEmail, extra.name || 'Pengguna');

        const user = {
          id: data.id,
          email: primaryEmail,
          name: fullName,
          firstName,
          lastName,
          avatarUrl,
          googleAvatarUrl: googlePfp || null,
          username: data.username || googleAccount?.username || extra.username || null,
        };

        userCache.set(userId, { user, expiresAt: now + 300 * 1000 });
        if (databaseUrl) syncUserToDb(user, databaseUrl).catch(() => {});
        return user;
      }
    } catch {}
  }

  // Database fallback
  if (databaseUrl) {
    try {
      const dbUser = await getUserFromDb(userId, databaseUrl);
      if (dbUser) {
        if ((!dbUser.name || dbUser.name === 'User' || dbUser.name === 'Pengguna') && (extra.name || extra.email)) {
          dbUser.name = extra.name || buildFullName(extra.firstName, extra.lastName, extra.username, extra.email, dbUser.name);
          dbUser.email = dbUser.email || extra.email || null;
          dbUser.avatarUrl = dbUser.avatarUrl || extra.avatarUrl || null;
          syncUserToDb(dbUser, databaseUrl).catch(() => {});
        }
        userCache.set(userId, { user: dbUser, expiresAt: now + 60 * 1000 });
        return dbUser;
      }
    } catch {}
  }

  // Extra/Payload fallback
  if (extra && (extra.name || extra.email || extra.username)) {
    const fallbackName = buildFullName(extra.firstName, extra.lastName, extra.username, extra.email, extra.name || 'Pengguna');
    const user = {
      id: userId,
      email: extra.email || null,
      name: fallbackName,
      firstName: extra.firstName || '',
      lastName: extra.lastName || '',
      avatarUrl: extra.avatarUrl || null,
      username: extra.username || null,
    };
    userCache.set(userId, { user, expiresAt: now + 60 * 1000 });
    if (databaseUrl) syncUserToDb(user, databaseUrl).catch(() => {});
    return user;
  }

  return null;
}

/**
 * Verifies a session ID with Clerk API and retrieves user.
 */
export async function verifyClerkSessionId(sessionId, secretKey, databaseUrl = process.env.DATABASE_URL, extra = {}) {
  if (!sessionId || !secretKey) return null;
  const now = Date.now();
  const cached = sessionCache.get(sessionId);
  if (cached && cached.expiresAt > now && cached.user?.name && cached.user.name !== 'User') {
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
    let user = await getClerkUser(session.user_id, secretKey, databaseUrl, extra);
    if (!user && databaseUrl) {
      user = await getUserFromDb(session.user_id, databaseUrl);
    }
    if (!user) {
      const fallbackName = buildFullName(extra.firstName, extra.lastName, extra.username, extra.email, extra.name || 'Pengguna');
      user = { id: session.user_id, name: fallbackName, email: extra.email || null, avatarUrl: extra.avatarUrl || null };
    }
    const result = { session, user };
    sessionCache.set(sessionId, { ...result, expiresAt: now + 300 * 1000 });
    return result;
  } catch {
    if (cached) return cached;
    return null;
  }
}

/**
 * Extracts auth credential and profile hints from request.
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
    const rawUrl = req.originalUrl || req.url || '/';
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const qToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('__clerk_token');
    if (qToken) token = qToken;
    const qSession = parsedUrl.searchParams.get('sessionId') || parsedUrl.searchParams.get('session_id');
    if (qSession) sessionId = qSession;

    const qHandshake = parsedUrl.searchParams.get('__clerk_handshake');
    if (qHandshake && qHandshake.includes('.')) {
      const parts = qHandshake.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (Array.isArray(payload.handshake)) {
          for (const c of payload.handshake) {
            const match = c.match(/^__session=([^;]+)/);
            if (match && match[1] && match[1].length > 10) {
              token = match[1];
              try {
                const tParts = token.split('.');
                if (tParts.length === 3) {
                  const tPayload = JSON.parse(Buffer.from(tParts[1], 'base64url').toString('utf8'));
                  if (tPayload.sid) sessionId = tPayload.sid;
                }
              } catch {}
              break;
            }
          }
        }
      }
    }
  } catch {}

  let clientProfile = null;
  const rawProfileHeader = headers['x-user-profile'] || headers['X-User-Profile'];
  if (rawProfileHeader) {
    try {
      clientProfile = JSON.parse(Buffer.from(rawProfileHeader, 'base64url').toString('utf8'));
    } catch {
      try {
        clientProfile = JSON.parse(decodeURIComponent(rawProfileHeader));
      } catch {}
    }
  }

  if (req.body && typeof req.body === 'object') {
    if (req.body.token) token = req.body.token;
    if (req.body.sessionId) sessionId = req.body.sessionId;
    if (req.body.user && typeof req.body.user === 'object') {
      clientProfile = { ...clientProfile, ...req.body.user };
    }
  }

  if (token || sessionId || clientProfile) {
    return { token, sessionId, clientProfile };
  }

  return null;
}

/**
 * Authenticates request against Clerk (JWKS, Session API, or verified claims).
 */
export async function authenticateClerkRequest(req, serverEnv = {}) {
  const config = getClerkConfig(serverEnv);
  const dbUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
  const cred = extractAuthCredential(req);
  if (!cred) {
    return { authenticated: false, user: null, sessionId: null };
  }

  const clientProfile = cred.clientProfile || {};

  // 1. JWT verification
  if (cred.token) {
    try {
      const payload = await verifyClerkJwt(cred.token, config.frontendApi);
      const userId = payload.sub;
      const payloadProfile = extractProfileFromPayload(payload) || {};
      const extraProfile = { ...payloadProfile, ...clientProfile };

      let user = await getClerkUser(userId, config.secretKey, dbUrl, extraProfile);
      if (!user && dbUrl) {
        user = await getUserFromDb(userId, dbUrl);
      }

      const fallbackName = buildFullName(extraProfile.firstName, extraProfile.lastName, extraProfile.username, extraProfile.email || user?.email, extraProfile.name || user?.name || 'Pengguna');
      const resolvedUser = {
        id: userId,
        name: (user?.name && user.name !== 'User') ? user.name : fallbackName,
        email: user?.email || extraProfile.email || null,
        avatarUrl: user?.avatarUrl || extraProfile.avatarUrl || null,
        firstName: user?.firstName || extraProfile.firstName || '',
        lastName: user?.lastName || extraProfile.lastName || '',
        username: user?.username || extraProfile.username || null,
      };

      if (dbUrl) syncUserToDb(resolvedUser, dbUrl).catch(() => {});
      return { authenticated: true, user: resolvedUser, sessionId: payload.sid || null };
    } catch (jwtErr) {
      // Fallback inspection of payload on expiration or clock drift
      try {
        const parts = cred.token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          const payloadProfile = extractProfileFromPayload(payload) || {};
          const extraProfile = { ...payloadProfile, ...clientProfile };

          if (payload.sid) {
            const verified = await verifyClerkSessionId(payload.sid, config.secretKey, dbUrl, extraProfile);
            if (verified && (verified.user || verified.session?.user_id)) {
              const uId = verified.session?.user_id || payload.sub;
              const uName = (verified.user?.name && verified.user.name !== 'User')
                ? verified.user.name
                : buildFullName(extraProfile.firstName, extraProfile.lastName, extraProfile.username, extraProfile.email, extraProfile.name || 'Pengguna');
              const resolved = {
                id: uId,
                name: uName,
                email: verified.user?.email || extraProfile.email || null,
                avatarUrl: verified.user?.avatarUrl || extraProfile.avatarUrl || null,
              };
              return { authenticated: true, user: resolved, sessionId: payload.sid };
            }
          }

          if (jwtErr?.signatureVerified && payload.sub && dbUrl) {
            const dbUser = await getUserFromDb(payload.sub, dbUrl);
            if (dbUser) {
              return { authenticated: true, user: dbUser, sessionId: payload.sid || null };
            }
          }

          if (jwtErr?.signatureVerified && payload.sub) {
            const fallbackName = buildFullName(extraProfile.firstName, extraProfile.lastName, extraProfile.username, extraProfile.email, extraProfile.name || 'Pengguna');
            const resolved = {
              id: payload.sub,
              name: fallbackName,
              email: extraProfile.email || null,
              avatarUrl: extraProfile.avatarUrl || null,
            };
            return { authenticated: true, user: resolved, sessionId: payload.sid || null };
          }
        }
      } catch {}

      if (cred.token.startsWith('sess_')) {
        const verified = await verifyClerkSessionId(cred.token, config.secretKey, dbUrl, clientProfile);
        if (verified && (verified.user || verified.session?.user_id)) {
          return { authenticated: true, user: verified.user, sessionId: cred.token };
        }
      }
    }
  }

  // 2. Session ID verification
  if (cred.sessionId) {
    const verified = await verifyClerkSessionId(cred.sessionId, config.secretKey, dbUrl, clientProfile);
    if (verified && (verified.user || verified.session?.user_id)) {
      return { authenticated: true, user: verified.user, sessionId: cred.sessionId };
    }
  }

  return { authenticated: false, user: null, sessionId: null };
}
