/* The worker caches a fixed build inventory, never user requests or project data. */
const CACHE = 'xmlw-static-__VERSION__';
const ASSETS = __ASSETS__;
const ROOT = new URL('./', self.location.href);
const allowed = new Set(ASSETS.map((p) => new URL(p, ROOT).href));
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Keep old versions intact if a new offline installation fails midway.
    for (let i = 0; i < ASSETS.length; i += 8) {
      await Promise.all(ASSETS.slice(i, i + 8).map(async (p) => {
        const url = new URL(p, ROOT).href;
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'omit', redirect: 'error' }));
        if (!response.ok) throw new Error('Offline installation incomplete');
        await cache.put(url, response);
      }));
    }
  })());
});
self.addEventListener('activate', (event) => {
  // Keep earlier version caches so an already-open tab can finish safely.
  // Browser storage settings can clear app caches when desired.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const denied = () => new Response('This app only reads its bundled static resources.', { status: 403 });
  event.respondWith((async () => {
    // No uploads, query-string values, redirects or third-party network traffic.
    if (request.method !== 'GET' || url.origin !== ROOT.origin || url.search) return denied();
    let key = url.href;
    if (request.mode === 'navigate') {
      if (url.pathname !== ROOT.pathname && url.pathname !== new URL('index.html', ROOT).pathname) return denied();
      key = new URL('index.html', ROOT).href;
    }
    if (!allowed.has(key)) {
      // Assets of an older tab are served only from a prior immutable build cache.
      const old = await caches.match(key);
      return old ?? denied();
    }
    const cache = await caches.open(CACHE);
    return await cache.match(key) ?? new Response('Offline resources are missing. Reopen the app online.', { status: 503 });
  })());
});
