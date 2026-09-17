export const GUEST_COOKIE_NAME = 'teach4all_guest_id';
export const CLERK_HANDSHAKE_URL = '';
export const CLERK_SIGN_IN_URL = '';
export const CLERK_SIGN_UP_URL = '';
export const CLERK_USER_PROFILE_URL = '';

export function getClerkUrls() {
  const serverAuth = (typeof window !== 'undefined' && window.__INITIAL_UI_DATA__?.auth) || null;
  if (serverAuth) {
    const frontend = (serverAuth.frontendApi || '').replace(/\/$/, '');
    const accounts = (serverAuth.accountsUrl || '').replace(/\/$/, '');
    return {
      frontendApi: frontend,
      accountsUrl: accounts,
      handshakeUrl: serverAuth.handshakeUrl || (frontend ? `${frontend}/v1/client/handshake` : ''),
      signInUrl: serverAuth.signInUrl || (accounts ? `${accounts}/sign-in` : ''),
      signUpUrl: serverAuth.signUpUrl || (accounts ? `${accounts}/sign-up` : ''),
      userProfileUrl: serverAuth.userProfileUrl || (accounts ? `${accounts}/user` : ''),
    };
  }
  return {
    frontendApi: '',
    accountsUrl: '',
    handshakeUrl: '',
    signInUrl: '',
    signUpUrl: '',
    userProfileUrl: '',
  };
}

export const AUTH_CONFIG_STORAGE_KEY = 'teach4all.auth_config.v1';

export async function initAuthConfig() {
  if (typeof window === 'undefined') return null;
  if (window.__INITIAL_UI_DATA__?.auth?.signInUrl) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AUTH_CONFIG_STORAGE_KEY, JSON.stringify(window.__INITIAL_UI_DATA__.auth));
      }
    } catch {}
    return window.__INITIAL_UI_DATA__.auth;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem(AUTH_CONFIG_STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.signInUrl) {
            if (!window.__INITIAL_UI_DATA__) window.__INITIAL_UI_DATA__ = {};
            window.__INITIAL_UI_DATA__.auth = parsed;
            return parsed;
          }
        }
      }
    } catch {}
    return null;
  }
  try {
    const res = await fetch('./api/auth/config', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (!window.__INITIAL_UI_DATA__) window.__INITIAL_UI_DATA__ = {};
      window.__INITIAL_UI_DATA__.auth = data;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(AUTH_CONFIG_STORAGE_KEY, JSON.stringify(data));
        }
      } catch {}
      return data;
    }
  } catch {}
  return null;
}

export function getCookie(name) {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  } catch {
    return null;
  }
}

export function getStoredUser() {
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

export function getAuthHeaders(currentUserVal = null) {
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
  let dbJwt = getCookie('__clerk_db_jwt');
  if (!dbJwt && typeof localStorage !== 'undefined') {
    try {
      dbJwt = localStorage.getItem('teach4all_db_jwt');
    } catch {}
  }
  if (dbJwt && !token) {
    headers['X-Clerk-Db-Jwt'] = dbJwt;
  }
  const stored = getStoredUser();
  if (stored?.name && stored.name !== 'User' && !String(stored.id).startsWith('guest_')) {
    try {
      headers['X-User-Profile'] = btoa(unescape(encodeURIComponent(JSON.stringify(stored))));
    } catch {}
  }
  const guestId = getOrCreateGuestId();
  if (guestId && !token && !currentUserVal && !dbJwt) {
    headers['X-Guest-ID'] = guestId;
  }
  return headers;
}
