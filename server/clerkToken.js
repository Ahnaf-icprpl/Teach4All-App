import crypto from 'node:crypto';

const jwksCache = new Map();

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
      const rawVal = pair.slice(idx + 1).trim();
      if (key) {
        try {
          cookies[key] = decodeURIComponent(rawVal);
        } catch {
          cookies[key] = rawVal;
        }
      }
    }
  }
  return cookies;
}

/**
 * Fetches and caches Clerk JWKS for RSA token verification.
 */
export async function getClerkJwks(frontendApi) {
  if (!frontendApi) {
    throw new Error('Clerk frontendApi is not configured');
  }
  const clean = frontendApi.replace(/\/$/, '');
  const now = Date.now();
  const cached = jwksCache.get(clean);
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }
  try {
    const url = `${clean}/.well-known/jwks.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch JWKS (${res.status})`);
    }
    const data = await res.json();
    const keys = data.keys || [];
    jwksCache.set(clean, {
      keys,
      expiresAt: now + 3600 * 1000, // 1 hour cache
    });
    return keys;
  } catch (err) {
    if (cached?.keys) return cached.keys;
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

  const endpoints = [];
  if (payload.iss && typeof payload.iss === 'string' && payload.iss.startsWith('http')) {
    try {
      const h = new URL(payload.iss).hostname;
      if (h.endsWith('.clerk.accounts.dev') || h.endsWith('.teach4all.my.id') || h.includes('clerk.')) {
        endpoints.push(payload.iss.replace(/\/$/, ''));
      }
    } catch {}
  }
  if (frontendApi) {
    const cleanFrontend = frontendApi.replace(/\/$/, '');
    if (!endpoints.includes(cleanFrontend)) endpoints.push(cleanFrontend);
  }

  let jwk = null;
  for (const ep of endpoints) {
    try {
      let keys = await getClerkJwks(ep);
      jwk = keys.find(k => k.kid === header.kid);
      if (!jwk) {
        jwksCache.delete(ep);
        keys = await getClerkJwks(ep);
        jwk = keys.find(k => k.kid === header.kid);
      }
      if (jwk) break;
    } catch {}
  }

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
  const SKEW = 60; // 60s clock skew tolerance
  if (payload.exp && payload.exp < now - SKEW) {
    const err = new Error('Token has expired');
    err.payload = payload;
    err.signatureVerified = true;
    throw err;
  }
  if (payload.nbf && payload.nbf > now + SKEW) {
    throw new Error('Token is not active yet');
  }

  return payload;
}
