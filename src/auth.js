import van from 'vanjs-core';
import { toast } from './state.js';
import { t } from './uiTexts.js';

export function getClerkUrls() {
  const serverAuth = (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.auth) || null;
  if (serverAuth) {
    const frontend = (serverAuth.frontendApi || '').replace(/\/$/, '');
    const accounts = (serverAuth.accountsUrl || '').replace(/\/$/, '');
    return {
      handshakeUrl: serverAuth.handshakeUrl || `${frontend}/v1/client/handshake`,
      signInUrl: serverAuth.signInUrl || `${accounts}/sign-in`,
      signUpUrl: serverAuth.signUpUrl || `${accounts}/sign-up`,
      userProfileUrl: serverAuth.userProfileUrl || `${accounts}/user`,
    };
  }
  return {
    handshakeUrl: '',
    signInUrl: '',
    signUpUrl: '',
    userProfileUrl: '',
  };
}

export async function initAuthConfig() {
  if (typeof window === 'undefined') return null;
  if (window.__INITIAL_UI_DATA__?.auth) return window.__INITIAL_UI_DATA__.auth;
  try {
    const res = await fetch('./api/auth/config', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (!window.__INITIAL_UI_DATA__) window.__INITIAL_UI_DATA__ = {};
      window.__INITIAL_UI_DATA__.auth = data;
      return data;
    }
  } catch {}
  return null;
}

export const CLERK_HANDSHAKE_URL = '';
export const CLERK_SIGN_IN_URL = '';
export const CLERK_SIGN_UP_URL = '';
export const CLERK_USER_PROFILE_URL = '';
export const GUEST_COOKIE_NAME = 'teach4all_guest_id';

function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function getStoredUser() {
  if (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.user) {
    return window.__INITIAL_UI_DATA__.user;
  }
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('teach4all_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user && user.id && !String(user.id).startsWith('guest_') && user.id !== '00000000-0000-0000-0000-000000000001') {
        return user;
      }
      localStorage.removeItem('teach4all_user');
    }
  } catch {}
  return null;
}

export const currentUser = van.state(getStoredUser());
export const authLoading = van.state(true);

export function isAuthenticated() {
  return Boolean(currentUser.val);
}

export function getOrCreateGuestId() {
  let guestId = getCookie(GUEST_COOKIE_NAME);
  if (!guestId && typeof localStorage !== 'undefined') {
    try {
      guestId = localStorage.getItem(GUEST_COOKIE_NAME);
    } catch {}
  }
  if (!guestId || typeof guestId !== 'string' || !guestId.startsWith('guest_')) {
    const randomSuffix = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : (Math.random().toString(36).slice(2, 11) + Date.now().toString(36));
    guestId = `guest_${randomSuffix}`;
  }
  if (typeof document !== 'undefined') {
    document.cookie = `${GUEST_COOKIE_NAME}=${guestId}; Path=/; SameSite=Lax`;
    try {
      localStorage.setItem(GUEST_COOKIE_NAME, guestId);
    } catch {}
  }
  return guestId;
}

export function getEffectiveUserId() {
  return currentUser.val?.id || getOrCreateGuestId();
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
  const guestId = getOrCreateGuestId();
  if (guestId && !token && !currentUser.val) {
    headers['X-Guest-ID'] = guestId;
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
          const loginRes = await fetch('./api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: sessionToken }),
            credentials: 'include',
          });
          if (loginRes.ok) {
            const loginData = await loginRes.json();
            if (loginData && loginData.authenticated && loginData.user) {
              currentUser.val = loginData.user;
              try {
                localStorage.setItem('teach4all_user', JSON.stringify(loginData.user));
              } catch {}
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user: loginData.user } }));
              }
            }
          }
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
  await initAuthConfig();
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

    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }

    const res = await fetch('./api/whoami', {
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        currentUser.val = null;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.removeItem('teach4all_user');
            localStorage.removeItem('teach4all_session');
            localStorage.removeItem('teach4all_session_id');
          } catch {}
        }
        if (typeof document !== 'undefined') {
          document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        }
      }
      authLoading.val = false;
      return currentUser.val;
    }

    const data = await res.json();
    if (data && data.guestId && typeof document !== 'undefined') {
      document.cookie = `${GUEST_COOKIE_NAME}=${data.guestId}; Path=/; SameSite=Lax`;
      try {
        localStorage.setItem(GUEST_COOKIE_NAME, data.guestId);
      } catch {}
    }
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
      if (typeof document !== 'undefined') {
        document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
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
  const urls = getClerkUrls();
  if (!urls.signInUrl) {
    const msg = t('auth_not_configured') || 'Autentikasi belum dikonfigurasi pada server.';
    toast(msg);
    return;
  }
  const target = returnUrl || `${window.location.origin}${window.location.pathname}`;
  const handshakeUrl = urls.handshakeUrl ? `${urls.handshakeUrl}?redirect_url=${encodeURIComponent(target)}` : target;
  const signInUrl = `${urls.signInUrl}?redirect_url=${encodeURIComponent(handshakeUrl)}`;
  window.location.href = signInUrl;
}

export function signup(returnUrl) {
  if (typeof window === 'undefined') return;
  const urls = getClerkUrls();
  if (!urls.signUpUrl) {
    const msg = t('auth_not_configured') || 'Autentikasi belum dikonfigurasi pada server.';
    toast(msg);
    return;
  }
  const target = returnUrl || `${window.location.origin}${window.location.pathname}`;
  const handshakeUrl = urls.handshakeUrl ? `${urls.handshakeUrl}?redirect_url=${encodeURIComponent(target)}` : target;
  const signUpUrl = `${urls.signUpUrl}?redirect_url=${encodeURIComponent(handshakeUrl)}`;
  window.location.href = signUpUrl;
}

export async function logout() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('teach4all_user');
      localStorage.removeItem('teach4all_session');
      localStorage.removeItem('teach4all_session_id');
      localStorage.removeItem(GUEST_COOKIE_NAME);
    }
    document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = `${GUEST_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
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
  const urls = getClerkUrls();
  if (!urls.userProfileUrl) return;
  window.open(urls.userProfileUrl, '_blank', 'noopener,noreferrer');
}

// Auto-initialize checkAuth when loaded in browser
if (typeof window !== 'undefined') {
  checkAuth();
}
