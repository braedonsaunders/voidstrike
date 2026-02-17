// VOIDSTRIKE Service Worker
// Runtime caching only — no precaching of game assets (260MB+ would be insane)

const CACHE_VERSION = 1;
const SHELL_CACHE = `voidstrike-shell-v${CACHE_VERSION}`;
const ASSET_CACHE = `voidstrike-assets-v${CACHE_VERSION}`;
const DATA_CACHE = `voidstrike-data-v${CACHE_VERSION}`;

const VALID_CACHES = [SHELL_CACHE, ASSET_CACHE, DATA_CACHE];

// Max asset cache size in entries (not bytes) — evict oldest when exceeded
const MAX_ASSET_ENTRIES = 500;

// ============================================
// INSTALL
// ============================================

self.addEventListener('install', () => {
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// ============================================
// ACTIVATE
// ============================================

self.addEventListener('activate', (event) => {
  // Clean up old versioned caches
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !VALID_CACHES.includes(key)).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// ============================================
// FETCH
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests for same-origin
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Skip Next.js HMR / dev websocket / webpack chunks in dev
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;
  if (url.pathname.includes('__nextjs')) return;

  // Route to appropriate caching strategy
  if (isStaticGameAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (isGameData(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (isAppShell(request, url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
});

// ============================================
// ASSET CLASSIFICATION
// ============================================

function isStaticGameAsset(pathname) {
  // WASM binaries
  if (pathname.endsWith('.wasm')) return true;
  // 3D models
  if (/\.(glb|gltf|bin)$/.test(pathname)) return true;
  // Textures (including compressed formats)
  if (/\.(png|jpg|jpeg|webp|ktx2|basis)$/.test(pathname)) return true;
  // Audio
  if (/\.(mp3|ogg|wav|m4a)$/.test(pathname)) return true;
  // Draco decoder
  if (pathname.startsWith('/draco/')) return true;
  return false;
}

function isGameData(pathname) {
  // Game definitions, configs, map data
  if (pathname.startsWith('/data/') && pathname.endsWith('.json')) return true;
  if (pathname.startsWith('/config/') && pathname.endsWith('.json')) return true;
  return false;
}

function isAppShell(request, pathname) {
  // Navigation requests (HTML pages)
  if (request.mode === 'navigate') return true;
  // Next.js static assets (JS, CSS) — content-hashed, safe to cache
  if (pathname.startsWith('/_next/static/')) return true;
  // Fonts
  if (/\.(woff2?|ttf|otf|eot)$/.test(pathname)) return true;
  return false;
}

// ============================================
// CACHING STRATEGIES
// ============================================

// Cache-First: check cache, fallback to network, cache the response
// Best for immutable assets (WASM, models, textures, audio)
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(cacheName, MAX_ASSET_ENTRIES);
    }
    return response;
  } catch {
    // Network failed and nothing in cache
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Stale-While-Revalidate: return cache immediately, update in background
// Best for app shell and game data that may change between deploys
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached version immediately if available, otherwise wait for network
  if (cached) return cached;

  const response = await fetchPromise;
  if (response) return response;

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// ============================================
// CACHE MANAGEMENT
// ============================================

// Evict oldest entries when cache exceeds max size
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  // Delete oldest entries (first in the list)
  const deleteCount = keys.length - maxEntries;
  for (let i = 0; i < deleteCount; i++) {
    await cache.delete(keys[i]);
  }
}
