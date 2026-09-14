import van from 'vanjs-core';
import { toast } from './state.js';
import { t } from './uiTexts.js';

export const CLERK_HANDSHAKE_URL = 'https://outgoing-feline-6741.clerk.accounts.dev/v1/client/handshake';
export const CLERK_SIGN_IN_URL = 'https://outgoing-feline-6741.accounts.dev/sign-in';
export const CLERK_SIGN_UP_URL = 'https://outgoing-feline-6741.accounts.dev/sign-up';
export const CLERK_USER_PROFILE_URL = 'https://outgoing-feline-6741.accounts.dev/user';
export const TEST_FALLBACK_USER_ID = '00000000-0000-0000-0000-000000000001';

function getStoredUser() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('teach4all_user');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export const currentUser = van.state(getStoredUser());
export const authLoading = van.state(true);

export function isAuthenticated() {
  return Boolean(currentUser.val);
}

export function getEffectiveUserId() {
  return currentUser.val?.id || TEST_FALLBACK_USER_ID;
}

function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAuthHeaders() {
  const headers = {};
  let token = getCookie('__session') || getCookie('clerk_session');
  let sessionId = getCookie('clerk_session_id');
  if (!token && typeof localStorage !== 'undefined') {
    try {
      token = localStorage.getItem('teach4all_session');
    } catch {}
  }
  if (!sessionId && typeof localStorage !== 'undefined') {
    try {
      sessionId = localStorage.getItem('teach4all_session_id');
    } catch {}
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (sessionId) {
    headers['X-Session-ID'] = sessionId;
  }
  return headers;
}

export async function processHandshakeIfPresent() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    const handshake = url.searchParams.get('__clerk_handshake');
    if (handshake && handshake.includes('.')) {
      const parts = handshake.split('.');
      const rawPayload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(rawPayload);
      let sessionToken = null;

      if (Array.isArray(payload.handshake)) {
        for (const cookieStr of payload.handshake) {
          const sanitized = cookieStr
            .replace(/Domain=[^;]+;?/gi, '')
            .replace(/SameSite=None/gi, 'SameSite=Lax')
            .replace(/Secure;?/gi, '')
            .trim();
          document.cookie = sanitized;

          const match = cookieStr.match(/^__session=([^;]+)/);
          if (match && match[1] && match[1].length > 10) {
            sessionToken = match[1];
          }
        }
      }

      if (sessionToken) {
        document.cookie = `__session=${sessionToken}; Path=/; SameSite=Lax; Max-Age=2592000`;
        document.cookie = `clerk_session=${sessionToken}; Path=/; SameSite=Lax; Max-Age=2592000`;
        try {
          localStorage.setItem('teach4all_session', sessionToken);
          const tokenParts = sessionToken.split('.');
          if (tokenParts.length === 3) {
            const p = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (p.sid) {
              document.cookie = `clerk_session_id=${p.sid}; Path=/; SameSite=Lax; Max-Age=2592000`;
              localStorage.setItem('teach4all_session_id', p.sid);
            }
          }
        } catch {}

        try {
          await fetch('./api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: sessionToken }),
          });
        } catch {}
      }

      url.searchParams.delete('__clerk_handshake');
      url.searchParams.delete('__clerk_status');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
      return true;
    }
  } catch {}
  return false;
}

export async function checkAuth() {
  authLoading.val = true;
  await processHandshakeIfPresent();

  try {
    let token = getCookie('__session') || getCookie('clerk_session');
    let sessionId = getCookie('clerk_session_id');
    if (!token && typeof localStorage !== 'undefined') {
      try {
        token = localStorage.getItem('teach4all_session');
      } catch {}
    }
    if (!sessionId && typeof localStorage !== 'undefined') {
      try {
        sessionId = localStorage.getItem('teach4all_session_id');
      } catch {}
    }

    if (!token && !sessionId) {
      currentUser.val = null;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem('teach4all_user');
        } catch {}
      }
      authLoading.val = false;
      return null;
    }

    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }

    const res = await fetch('./api/whoami', { headers });
    if (!res.ok) {
      if (res.status === 401) {
        currentUser.val = null;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.removeItem('teach4all_user');
            localStorage.removeItem('teach4all_session');
            localStorage.removeItem('teach4all_session_id');
          } catch {}
        }
      }
      authLoading.val = false;
      return currentUser.val;
    }

    const data = await res.json();
    if (data && data.authenticated && data.user) {
      currentUser.val = data.user;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('teach4all_user', JSON.stringify(data.user));
          if (token) localStorage.setItem('teach4all_session', token);
          if (data.sessionId) {
            localStorage.setItem('teach4all_session_id', data.sessionId);
            document.cookie = `clerk_session_id=${data.sessionId}; Path=/; SameSite=Lax; Max-Age=2592000`;
          }
        } catch {}
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user: data.user } }));
      }
    } else if (data && data.authenticated === false) {
      currentUser.val = null;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem('teach4all_user');
          localStorage.removeItem('teach4all_session');
          localStorage.removeItem('teach4all_session_id');
        } catch {}
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user: null } }));
      }
    }
  } catch {
    // Offline-first: do not clear user on network failure
  } finally {
    authLoading.val = false;
  }
  return currentUser.val;
}

export function login(returnUrl) {
  if (typeof window === 'undefined') return;
  const target = returnUrl || `${window.location.origin}${window.location.pathname}`;
  const handshakeUrl = `${CLERK_HANDSHAKE_URL}?redirect_url=${encodeURIComponent(target)}`;
  const signInUrl = `${CLERK_SIGN_IN_URL}?redirect_url=${encodeURIComponent(handshakeUrl)}`;
  window.location.href = signInUrl;
}

export function signup(returnUrl) {
  if (typeof window === 'undefined') return;
  const target = returnUrl || `${window.location.origin}${window.location.pathname}`;
  const handshakeUrl = `${CLERK_HANDSHAKE_URL}?redirect_url=${encodeURIComponent(target)}`;
  const signUpUrl = `${CLERK_SIGN_UP_URL}?redirect_url=${encodeURIComponent(handshakeUrl)}`;
  window.location.href = signUpUrl;
}

export async function logout() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('teach4all_user');
      localStorage.removeItem('teach4all_session');
      localStorage.removeItem('teach4all_session_id');
    }
    document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    await fetch('./api/auth/logout', { method: 'POST' });
  } catch {}
  currentUser.val = null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user: null } }));
  }
  const msg = t('auth_logout_success');
  if (msg) toast(msg);
}

export function openUserProfile() {
  if (typeof window === 'undefined') return;
  window.open(CLERK_USER_PROFILE_URL, '_blank', 'noopener,noreferrer');
}

// Auto-initialize checkAuth when loaded in browser
if (typeof window !== 'undefined') {
  checkAuth();
}
