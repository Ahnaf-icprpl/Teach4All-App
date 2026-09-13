// Build placeholders are replaced by scripts/build-sw.mjs; never register this source file.
const CACHE_NAME = '__CACHE_NAME__';
const ASSETS = __PRECACHE_ASSETS__;
const scope = self.registration.scope;
const assetUrls = ASSETS.map(path => new URL(path, scope).href);
const shellUrl = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(assetUrls.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // The scope identifier prevents deleting a sibling deployment's cache.
    const prefix = CACHE_NAME.slice(0, CACHE_NAME.lastIndexOf('-') + 1);
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  const url = new URL(request.url);

  // Non-cached endpoints (like API calls) are always sent directly to server
  if (url.pathname.startsWith('/api/')) return;

  const isShell = request.mode === 'navigate'
    && [new URL(scope).pathname, new URL(shellUrl).pathname].includes(url.pathname);

  if (request.mode === 'navigate') {
    if (isShell) {
      event.respondWith((async () => {
        try {
          const netRes = await fetch(request);
          if (netRes && netRes.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(shellUrl, netRes.clone()).catch(() => {});
            return netRes;
          }
        } catch {}
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(shellUrl)) || fetch(request);
      })());
      return;
    }

    // For non-cached navigation endpoints: send to server so server returns 404 properly.
    // When offline, fallback to precached 404 page with 404 status.
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const match404 = await cache.match(new URL('404.html', scope).href);
        if (match404) {
          return new Response(match404.body, {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return (await cache.match(shellUrl)) || fetch(request);
      }
    })());
    return;
  }

  // Precached static assets
  if (assetUrls.includes(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request.url)) || fetch(request);
    })());
    return;
  }
});
