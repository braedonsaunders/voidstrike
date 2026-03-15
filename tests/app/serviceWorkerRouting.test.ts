import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

interface ServiceWorkerContext {
  getRequestStrategy: (request: { mode?: string }, pathname: string) => string | null;
  networkFirst: (request: Request, cacheName: string) => Promise<Response>;
  caches: {
    open: ReturnType<typeof vi.fn>;
    keys: ReturnType<typeof vi.fn>;
  };
  fetch: ReturnType<typeof vi.fn>;
  self: {
    addEventListener: ReturnType<typeof vi.fn>;
    clients: { claim: ReturnType<typeof vi.fn> };
    location: { origin: string };
    skipWaiting: ReturnType<typeof vi.fn>;
  };
}

function loadServiceWorkerContext(): ServiceWorkerContext {
  const source = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');

  const context = {
    URL,
    Response,
    Promise,
    console,
    caches: {
      open: vi.fn(),
      keys: vi.fn(),
    },
    fetch: vi.fn(),
    self: {
      addEventListener: vi.fn(),
      clients: { claim: vi.fn() },
      location: { origin: 'http://127.0.0.1:3001' },
      skipWaiting: vi.fn(),
    },
  } as unknown as ServiceWorkerContext;

  vm.runInNewContext(source, context, { filename: 'public/sw.js' });
  return context;
}

describe('service worker request routing', () => {
  it('uses network-first for navigation requests', () => {
    const context = loadServiceWorkerContext();

    expect(context.getRequestStrategy({ mode: 'navigate' }, '/game/setup')).toBe(
      'navigation-network-first'
    );
  });

  it('keeps hashed static app shell assets on stale-while-revalidate', () => {
    const context = loadServiceWorkerContext();

    expect(
      context.getRequestStrategy(
        { mode: 'same-origin' },
        '/_next/static/chunks/app/game/setup/page-abcdef123456.js'
      )
    ).toBe('shell-stale-while-revalidate');
  });

  it('falls back to cached navigation HTML when the network is unavailable', async () => {
    const context = loadServiceWorkerContext();
    const cachedResponse = new Response('cached setup shell');
    const cache = {
      match: vi.fn().mockResolvedValue(cachedResponse),
      put: vi.fn(),
    };
    context.caches.open.mockResolvedValue(cache);
    context.fetch.mockRejectedValue(new Error('offline'));

    const response = await context.networkFirst(
      new Request('http://127.0.0.1:3001/game/setup'),
      'voidstrike-shell-v2'
    );

    expect(await response.text()).toBe('cached setup shell');
    expect(cache.put).not.toHaveBeenCalled();
  });
});
