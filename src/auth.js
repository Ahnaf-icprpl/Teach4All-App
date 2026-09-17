import van from 'vanjs-core';
import { toast } from './state.js';
import { t } from './uiTexts.js';
import {
  GUEST_COOKIE_NAME,
  CLERK_HANDSHAKE_URL,
  CLERK_SIGN_IN_URL,
  CLERK_SIGN_UP_URL,
  CLERK_USER_PROFILE_URL,
  getClerkUrls,
  initAuthConfig,
  getCookie,
  getStoredUser,
  getOrCreateGuestId,
  getAuthHeaders as baseGetAuthHeaders,
} from './authUtils.js';

export {
  GUEST_COOKIE_NAME,
  CLERK_HANDSHAKE_URL,
  CLERK_SIGN_IN_URL,
  CLERK_SIGN_UP_URL,
  CLERK_USER_PROFILE_URL,
  getClerkUrls,
  initAuthConfig,
  getOrCreateGuestId,
};

export const currentUser = van.state(getStoredUser());
export const authLoading = van.state(true);

export function isAuthenticated() {
  return Boolean(currentUser.val);
}

export function getEffectiveUserId() {
  return currentUser.val?.id || getOrCreateGuestId();
}

export function getAuthHeaders() {
  return baseGetAuthHeaders(currentUser.val);
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
        let sid = null;
        try {
          localStorage.setItem('teach4all_session', sessionToken);
          const tokenParts = sessionToken.split('.');
          if (tokenParts.length === 3) {
            const p = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (p.sid) {
              sid = p.sid;
              document.cookie = `clerk_session_id=${p.sid}; Path=/; SameSite=Lax; Max-Age=2592000`;
              localStorage.setItem('teach4all_session_id', p.sid);
            }
          }
        } catch {}

        try {
          const loginPayload = { token: sessionToken };
          if (sid) loginPayload.sessionId = sid;
          const stored = getStoredUser();
          if (stored?.name && !String(stored.id).startsWith('guest_')) {
            loginPayload.user = stored;
          }
          const loginRes = await fetch('./api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginPayload),
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

    const dbJwt = url.searchParams.get('__clerk_db_jwt');
    if (dbJwt) {
      document.cookie = `__clerk_db_jwt=${encodeURIComponent(dbJwt)}; Path=/; SameSite=Lax; Max-Age=2592000`;
      try {
        localStorage.setItem('teach4all_db_jwt', dbJwt);
      } catch {}

      await initAuthConfig();
      const urls = getClerkUrls();
      if (urls.frontendApi) {
        const syncResult = await syncFromClerkClient(urls.frontendApi, dbJwt);
        if (syncResult && syncResult.user) {
          currentUser.val = syncResult.user;
        }
      }

      url.searchParams.delete('__clerk_db_jwt');
      url.searchParams.delete('__clerk_status');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
      return true;
    }
  } catch {}
  return false;
}

export async function syncFromClerkClient(frontendApi, dbJwtOverride = null) {
  if (!frontendApi || typeof window === 'undefined') return null;
  try {
    const clean = frontendApi.replace(/\/$/, '');
    let dbJwt = dbJwtOverride || getCookie('__clerk_db_jwt');
    if (!dbJwt && typeof localStorage !== 'undefined') {
      try {
        dbJwt = localStorage.getItem('teach4all_db_jwt');
      } catch {}
    }
    if (!dbJwt) {
      try {
        const u = new URL(window.location.href);
        dbJwt = u.searchParams.get('__clerk_db_jwt');
      } catch {}
    }
    const query = dbJwt ? `?__clerk_db_jwt=${encodeURIComponent(dbJwt)}` : '';
    const res = await fetch(`${clean}/v1/client${query}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sessions = data.response?.sessions || data.client?.sessions || [];
    const activeSession = sessions.find(s => s.status === 'active') || sessions[0];
    if (!activeSession) return null;

    const u = activeSession.user;
    if (!u) return null;

    const primaryEmail = u.email_addresses?.[0]?.email_address || null;
    const firstName = u.first_name || '';
    const lastName = u.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() ||
      u.username ||
      (primaryEmail ? primaryEmail.split('@')[0] : null) ||
      'Pengguna';
    const avatarUrl = u.image_url || u.profile_image_url || null;

    let jwt = null;
    try {
      const tokenUrl = `${clean}/v1/client/sessions/${encodeURIComponent(activeSession.id)}/tokens${query}`;
      const tRes = await fetch(tokenUrl, {
        method: 'POST',
        credentials: 'include',
      });
      if (tRes.ok) {
        const tData = await tRes.json();
        jwt = tData.jwt || tData.response?.jwt || null;
      }
    } catch {}

    const user = {
      id: u.id,
      name: fullName,
      firstName,
      lastName,
      email: primaryEmail,
      avatarUrl,
      username: u.username || null,
    };

    if (jwt) {
      document.cookie = `__session=${jwt}; Path=/; SameSite=Lax; Max-Age=2592000`;
      document.cookie = `clerk_session=${jwt}; Path=/; SameSite=Lax; Max-Age=2592000`;
      try {
        localStorage.setItem('teach4all_session', jwt);
      } catch {}
    }
    if (activeSession.id) {
      document.cookie = `clerk_session_id=${activeSession.id}; Path=/; SameSite=Lax; Max-Age=2592000`;
      try {
        localStorage.setItem('teach4all_session_id', activeSession.id);
      } catch {}
    }
    if (dbJwt) {
      document.cookie = `__clerk_db_jwt=${encodeURIComponent(dbJwt)}; Path=/; SameSite=Lax; Max-Age=2592000`;
      try {
        localStorage.setItem('teach4all_db_jwt', dbJwt);
      } catch {}
    }

    try {
      localStorage.setItem('teach4all_user', JSON.stringify(user));
    } catch {}

    currentUser.val = user;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user } }));
    }

    try {
      fetch('./api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: jwt, sessionId: activeSession.id, dbJwt, user }),
        credentials: 'include',
      }).catch(() => {});
    } catch {}

    return { user, sessionId: activeSession.id, token: jwt };
  } catch {
    return null;
  }
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

    const urls = getClerkUrls();
    const dbJwt = getCookie('__clerk_db_jwt') || (typeof localStorage !== 'undefined' ? localStorage.getItem('teach4all_db_jwt') : null);
    if ((!token || !currentUser.val || currentUser.val.name === 'User' || !currentUser.val.email || dbJwt) && urls.frontendApi) {
      const clerkSync = await syncFromClerkClient(urls.frontendApi, dbJwt);
      if (clerkSync) {
        if (clerkSync.token) token = clerkSync.token;
        if (clerkSync.sessionId) sessionId = clerkSync.sessionId;
        if (clerkSync.user) {
          currentUser.val = clerkSync.user;
        }
      }
    }

    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
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

    const res = await fetch('./api/whoami', {
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        let recovered = false;
        if (dbJwt && urls.frontendApi) {
          const syncResult = await syncFromClerkClient(urls.frontendApi, dbJwt);
          if (syncResult && syncResult.user && syncResult.token) {
            currentUser.val = syncResult.user;
            recovered = true;
          }
        }
        if (!recovered) {
          currentUser.val = null;
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.removeItem('teach4all_user');
              localStorage.removeItem('teach4all_session');
              localStorage.removeItem('teach4all_session_id');
              localStorage.removeItem('teach4all_db_jwt');
            } catch {}
          }
          if (typeof document !== 'undefined') {
            document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
            document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
            document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
            document.cookie = '__clerk_db_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          }
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
      const finalUser = { ...data.user };
      const localUser = getStoredUser();
      if ((!finalUser.name || finalUser.name === 'User' || finalUser.name === 'Pengguna') && localUser?.name && localUser.name !== 'User') {
        finalUser.name = localUser.name;
      }
      if (!finalUser.email && localUser?.email) {
        finalUser.email = localUser.email;
      }
      if (!finalUser.avatarUrl && localUser?.avatarUrl) {
        finalUser.avatarUrl = localUser.avatarUrl;
      }

      currentUser.val = finalUser;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('teach4all_user', JSON.stringify(finalUser));
          if (token) localStorage.setItem('teach4all_session', token);
          if (data.sessionId) {
            localStorage.setItem('teach4all_session_id', data.sessionId);
            document.cookie = `clerk_session_id=${data.sessionId}; Path=/; SameSite=Lax; Max-Age=2592000`;
          }
        } catch {}
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user: finalUser } }));
      }
    } else if (data && data.authenticated === false) {
      let recovered = false;
      if (dbJwt && urls.frontendApi) {
        const syncResult = await syncFromClerkClient(urls.frontendApi, dbJwt);
        if (syncResult && syncResult.user && syncResult.token) {
          currentUser.val = syncResult.user;
          recovered = true;
        }
      }
      if (!recovered) {
        currentUser.val = null;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.removeItem('teach4all_user');
            localStorage.removeItem('teach4all_session');
            localStorage.removeItem('teach4all_session_id');
            localStorage.removeItem('teach4all_db_jwt');
          } catch {}
        }
        if (typeof document !== 'undefined') {
          document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          document.cookie = '__clerk_db_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('teach4all:auth-changed', { detail: { user: null } }));
        }
      }
    }
  } catch {
    // Offline-first: do not clear user on network failure
  } finally {
    authLoading.val = false;
  }
  return currentUser.val;
}

export async function login(returnUrl) {
  if (typeof window === 'undefined') return;
  await initAuthConfig();
  const urls = getClerkUrls();
  if (!urls.signInUrl || (!urls.signInUrl.startsWith('http://') && !urls.signInUrl.startsWith('https://'))) {
    const msg = t('auth_not_configured') || 'Autentikasi belum dikonfigurasi pada server.';
    toast(msg);
    return;
  }
  const target = returnUrl || `${window.location.origin}${window.location.pathname}`;
  const signInUrl = `${urls.signInUrl}?redirect_url=${encodeURIComponent(target)}`;
  window.location.href = signInUrl;
}

export async function signup(returnUrl) {
  if (typeof window === 'undefined') return;
  await initAuthConfig();
  const urls = getClerkUrls();
  if (!urls.signUpUrl || (!urls.signUpUrl.startsWith('http://') && !urls.signUpUrl.startsWith('https://'))) {
    const msg = t('auth_not_configured') || 'Autentikasi belum dikonfigurasi pada server.';
    toast(msg);
    return;
  }
  const target = returnUrl || `${window.location.origin}${window.location.pathname}`;
  const signUpUrl = `${urls.signUpUrl}?redirect_url=${encodeURIComponent(target)}`;
  window.location.href = signUpUrl;
}

export async function logout() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('teach4all_user');
      localStorage.removeItem('teach4all_session');
      localStorage.removeItem('teach4all_session_id');
      localStorage.removeItem('teach4all_db_jwt');
      localStorage.removeItem('teach4all.ui_state.v1');
      localStorage.removeItem(GUEST_COOKIE_NAME);
    }
    document.cookie = '__session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'clerk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'clerk_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = '__clerk_db_jwt=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
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

export async function openUserProfile() {
  if (typeof window === 'undefined') return;
  await initAuthConfig();
  const urls = getClerkUrls();
  if (!urls.userProfileUrl || (!urls.userProfileUrl.startsWith('http://') && !urls.userProfileUrl.startsWith('https://'))) return;
  window.open(urls.userProfileUrl, '_blank', 'noopener,noreferrer');
}

if (typeof window !== 'undefined') {
  checkAuth();
}
