import crypto from 'node:crypto';
import { enforceRateLimit, getClientIp } from './rateLimiter.js';
import { syncUserToDb, ensureUserExists } from './db.js';
import {
  getClerkConfig,
  parseCookies,
  getClerkJwks,
  verifyClerkJwt,
  getClerkUser,
  verifyClerkSessionId,
  extractAuthCredential,
  authenticateClerkRequest,
} from './clerkVerifier.js';

export {
  getClerkConfig,
  parseCookies,
  getClerkJwks,
  verifyClerkJwt,
  getClerkUser,
  verifyClerkSessionId,
  extractAuthCredential,
  authenticateClerkRequest,
};

/**
 * Handles GET /api/whoami and GET /api/auth/whoami.
 */
export async function handleWhoamiRequest(req, res, serverEnv = {}, endpoint = null) {
  const targetEndpoint = endpoint || (req?.baseUrl ? `${req.baseUrl}${req.path}` : (req?.originalUrl || req?.url || '/api/whoami').split('?')[0]);
  if (!(await enforceRateLimit(req, res, targetEndpoint, serverEnv))) {
    return;
  }

  const authResult = await authenticateClerkRequest(req, serverEnv);
  if (authResult.authenticated && authResult.user) {
    const dbUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
    syncUserToDb(authResult.user, dbUrl).catch(() => {});
  }

  const body = JSON.stringify({
    authenticated: authResult.authenticated,
    user: authResult.user,
    sessionId: authResult.sessionId || null,
    guestId: req.isGuest ? req.userId : null,
  });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (typeof res.json === 'function') {
    res.json(JSON.parse(body));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  }
}

/**
 * Handles POST /api/auth/login, /api/auth/signup, /api/auth/sync.
 * Accepts { token, sessionId } and sets secure cookie.
 */
export async function handleLoginRequest(req, res, serverEnv = {}, endpoint = null) {
  const targetEndpoint = endpoint || (req?.baseUrl ? `${req.baseUrl}${req.path}` : (req?.originalUrl || req?.url || '/api/auth/login').split('?')[0]);
  if (!(await enforceRateLimit(req, res, targetEndpoint, serverEnv))) {
    return;
  }

  const config = getClerkConfig(serverEnv);
  const cred = extractAuthCredential(req);
  if (!cred) {
    const errPayload = { error: { message: 'Missing token or sessionId in request' } };
    if (typeof res.status === 'function') {
      res.status(400).json(errPayload);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errPayload));
    }
    return;
  }

  const authResult = await authenticateClerkRequest(req, serverEnv);
  if (!authResult.authenticated) {
    const errPayload = { error: { message: 'Invalid token or session' } };
    if (typeof res.status === 'function') {
      res.status(401).json(errPayload);
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errPayload));
    }
    return;
  }

  if (authResult.user) {
    if (req.body?.user && req.body.user.id === authResult.user.id) {
      if (req.body.user.name && req.body.user.name !== 'User' && req.body.user.name !== 'Pengguna') {
        authResult.user.name = req.body.user.name;
      }
      if (req.body.user.email) {
        authResult.user.email = req.body.user.email;
      }
      if (req.body.user.avatarUrl) {
        authResult.user.avatarUrl = req.body.user.avatarUrl;
      }
      if (req.body.user.firstName) authResult.user.firstName = req.body.user.firstName;
      if (req.body.user.lastName) authResult.user.lastName = req.body.user.lastName;
      if (req.body.user.username) authResult.user.username = req.body.user.username;
    }
    const dbUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;
    await syncUserToDb(authResult.user, dbUrl);
  }

  const isHttps = Boolean(req.secure || req.headers?.['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
  const sec = isHttps ? '; Secure' : '';
  const tokenToSet = cred.token || cred.sessionId;
  const cookieHeaders = [
    `__session=${encodeURIComponent(tokenToSet)}; Path=/; SameSite=Lax${sec}; Max-Age=2592000`,
    `clerk_session=${encodeURIComponent(tokenToSet)}; Path=/; SameSite=Lax${sec}; Max-Age=2592000`,
  ];
  if (authResult.sessionId) {
    cookieHeaders.push(`clerk_session_id=${encodeURIComponent(authResult.sessionId)}; Path=/; SameSite=Lax${sec}; Max-Age=2592000`);
  }
  res.setHeader('Set-Cookie', cookieHeaders);

  const payload = {
    authenticated: true,
    user: authResult.user,
    sessionId: authResult.sessionId,
  };

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (typeof res.json === 'function') {
    res.json(payload);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload);
  }
}

/**
 * Handles POST/GET /api/auth/logout.
 */
export async function handleLogoutRequest(req, res, serverEnv = {}) {
  if (!(await enforceRateLimit(req, res, '/api/auth/logout', serverEnv))) {
    return;
  }

  const config = getClerkConfig(serverEnv);
  const authResult = await authenticateClerkRequest(req, serverEnv);

  if (authResult.sessionId) {
    sessionCache.delete(authResult.sessionId);
    try {
      await fetch(`https://api.clerk.com/v1/sessions/${encodeURIComponent(authResult.sessionId)}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.secretKey}` },
      });
    } catch {}
  }

  // Clear session cookies
  const expiredCookies = [
    '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
    'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
    'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
    '__client_uat=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
    '__clerk_db_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
  ];

  res.setHeader('Set-Cookie', expiredCookies);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  const payload = {
    authenticated: false,
    user: null,
    message: 'Logged out successfully',
  };

  if (typeof res.json === 'function') {
    res.json(payload);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
}

/**
 * Handles GET /api/auth/config.
 * Returns public Clerk configuration for the client.
 */
export async function handleAuthConfigRequest(req, res, serverEnv = {}) {
  if (!(await enforceRateLimit(req, res, '/api/auth/config', serverEnv))) {
    return;
  }

  const config = getClerkConfig(serverEnv);
  const frontend = (config.frontendApi || '').replace(/\/$/, '');
  const accounts = (config.accountsUrl || '').replace(/\/$/, '');
  const payload = {
    publishableKey: config.publishableKey || '',
    frontendApi: frontend,
    accountsUrl: accounts,
    handshakeUrl: frontend ? `${frontend}/v1/client/handshake` : '',
    signInUrl: accounts ? `${accounts}/sign-in` : '',
    signUpUrl: accounts ? `${accounts}/sign-up` : '',
    userProfileUrl: accounts ? `${accounts}/user` : '',
  };

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (typeof res.json === 'function') {
    res.json(payload);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
}

/**
 * Middleware that intercepts Clerk handshake redirect query parameters.
 */
export function clerkHandshakeMiddleware(req, res, next) {
  const urlString = req.originalUrl || req.url || '';
  if (!urlString.includes('__clerk_handshake')) {
    return next();
  }

  try {
    const parsed = new URL(urlString, 'http://localhost');
    const handshakeToken = parsed.searchParams.get('__clerk_handshake');
    if (handshakeToken && handshakeToken.includes('.')) {
      const parts = handshakeToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (Array.isArray(payload.handshake)) {
        const cookiesToSet = [];
        let extractedSessionToken = null;

        for (const c of payload.handshake) {
          const match = c.match(/^__session=([^;]+)/);
          if (match && match[1] && match[1].length > 10) {
            extractedSessionToken = match[1];
          }
          const sanitized = c
            .replace(/Domain=[^;]+;?/gi, '')
            .replace(/SameSite=None/gi, 'SameSite=Lax')
            .replace(/Secure;?/gi, '')
            .replace(/HttpOnly;?/gi, '')
            .trim();
          cookiesToSet.push(sanitized);
        }

        if (extractedSessionToken) {
          const isHttps = Boolean(req.secure || req.headers?.['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
          const sec = isHttps ? '; Secure' : '';
          cookiesToSet.push(`__session=${extractedSessionToken}; Path=/; SameSite=Lax${sec}; Max-Age=2592000`);
          cookiesToSet.push(`clerk_session=${extractedSessionToken}; Path=/; SameSite=Lax${sec}; Max-Age=2592000`);
          try {
            const tokenParts = extractedSessionToken.split('.');
            if (tokenParts.length === 3) {
              const jwtPayload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString('utf8'));
              if (jwtPayload.sid) {
                cookiesToSet.push(`clerk_session_id=${jwtPayload.sid}; Path=/; SameSite=Lax${sec}; Max-Age=2592000`);
              }
            }
          } catch {}
        }

        res.setHeader('Set-Cookie', cookiesToSet);
      }
    }
  } catch {}

  next();
}

/**
 * Middleware that authenticates incoming requests using Clerk credentials,
 * binding req.user, req.userId, and req.isGuest authoritatively.
 */
export function authContextMiddleware(serverEnv = {}) {
  const dbUrl = serverEnv.DATABASE_URL || process.env.DATABASE_URL;

  return async (req, res, next) => {
    try {
      const auth = await authenticateClerkRequest(req, serverEnv);
      if (auth && auth.authenticated && auth.user?.id) {
        req.user = auth.user;
        req.userId = auth.user.id;
        req.isGuest = false;
      } else {
        const cookies = parseCookies(req.headers?.cookie || '');
        let guestId = cookies.teach4all_guest_id || req.headers?.['x-guest-id'] || req.headers?.['x-guest-session'];

        if (!guestId || typeof guestId !== 'string' || !/^guest_[a-zA-Z0-9_-]{8,64}$/.test(guestId.trim())) {
          guestId = `guest_${crypto.randomUUID()}`;
          if (res && typeof res.setHeader === 'function' && !res.headersSent) {
            res.setHeader('Set-Cookie', `teach4all_guest_id=${guestId}; Path=/; SameSite=Lax`);
          }
        } else {
          guestId = guestId.trim();
        }

        req.user = null;
        req.userId = guestId;
        req.isGuest = true;

        if (dbUrl) {
          await ensureUserExists(guestId, dbUrl);
        }
      }
    } catch {
      const fallbackGuestId = `guest_${crypto.randomUUID()}`;
      req.user = null;
      req.userId = fallbackGuestId;
      req.isGuest = true;
      if (dbUrl) {
        try {
          await ensureUserExists(fallbackGuestId, dbUrl);
        } catch {}
      }
    }
    next();
  };
}
