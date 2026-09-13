/**
 * Environment configuration helper for Teach4All.
 * Valid values: 'production' | 'development'
 */
export const VALID_ENVS = ['production', 'development'];

/**
 * Validate whether an env string is acceptable.
 */
export function isValidEnv(val) {
  if (typeof val !== 'string') return false;
  return VALID_ENVS.includes(val.trim().toLowerCase());
}

/**
 * Parse and validate application environment.
 * Throws if an explicitly provided value is neither 'production' nor 'development'.
 */
export function parseAppEnv(raw, fallback = 'development') {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (VALID_ENVS.includes(normalized)) {
    return normalized;
  }
  throw new Error(`Invalid env "${raw}". Only "production" or "development" is valid.`);
}

/**
 * Retrieve current active application environment.
 */
export function getAppEnv() {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : null;
  const procEnv = typeof process !== 'undefined' && process.env ? process.env : null;

  const candidate = (
    metaEnv?.ENV ||
    metaEnv?.env ||
    metaEnv?.VITE_ENV ||
    procEnv?.ENV ||
    procEnv?.env ||
    procEnv?.NODE_ENV ||
    (metaEnv?.MODE === 'production' ? 'production' : 'development')
  );

  return parseAppEnv(candidate, 'development');
}

/**
 * Check if running in development environment.
 */
export function isDevEnv() {
  return getAppEnv() === 'development';
}

/**
 * Check if running in production environment.
 */
export function isProdEnv() {
  return getAppEnv() === 'production';
}
