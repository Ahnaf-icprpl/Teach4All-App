import { appEnvState } from './uiTexts.js';

/**
 * Environment configuration helper for Teach4All.
 * Valid values: 'production' | 'staging' | 'development'
 */
export const VALID_ENVS = ['production', 'staging', 'development'];

/**
 * Validate whether an env string is acceptable.
 */
export function isValidEnv(val) {
  if (typeof val !== 'string') return false;
  return VALID_ENVS.includes(val.trim().toLowerCase());
}

/**
 * Parse and validate application environment.
 * Throws if an explicitly provided value is neither 'production', 'staging', nor 'development'.
 */
export function parseAppEnv(raw, fallback = 'development') {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (VALID_ENVS.includes(normalized)) {
    return normalized;
  }
  throw new Error(`Invalid env "${raw}". Only "production", "staging", or "development" is valid.`);
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
    (metaEnv?.MODE === 'production' ? 'production' : (metaEnv?.MODE === 'staging' ? 'staging' : 'development'))
  );

  return parseAppEnv(candidate, 'development');
}

/**
 * Check if running in development environment.
 */
export function isDevEnv() {
  if (appEnvState?.val) {
    return appEnvState.val === 'development';
  }
  if (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.env) {
    return window.__INITIAL_UI_DATA__.env === 'development';
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ENV) {
    return import.meta.env.ENV === 'development';
  }
  return getAppEnv() === 'development';
}

/**
 * Check if running in staging environment.
 */
export function isStagingEnv() {
  if (appEnvState?.val) {
    return appEnvState.val === 'staging';
  }
  if (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.env) {
    return window.__INITIAL_UI_DATA__.env === 'staging';
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ENV) {
    return import.meta.env.ENV === 'staging';
  }
  return getAppEnv() === 'staging';
}

/**
 * Check if running in production environment.
 */
export function isProdEnv() {
  if (appEnvState?.val) {
    return appEnvState.val === 'production';
  }
  if (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.env) {
    return window.__INITIAL_UI_DATA__.env === 'production';
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ENV) {
    return import.meta.env.ENV === 'production';
  }
  return getAppEnv() === 'production';
}
