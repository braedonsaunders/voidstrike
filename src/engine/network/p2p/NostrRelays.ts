/**
 * Dynamic Nostr relay discovery
 * Fetches live relay list from nostr.watch API
 * NO hardcoded fallback - throws error if API fails
 */

const NOSTR_WATCH_API = 'https://api.nostr.watch/v1/online';
const API_TIMEOUT = 5000;
const MIN_RELAYS = 3;

export class NostrRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NostrRelayError';
  }
}

/**
 * Fetch live relay list from nostr.watch
 * @param count Number of relays to return (default 8)
 * @throws NostrRelayError if API fails or returns insufficient relays
 */
export async function getRelays(count: number = 8): Promise<string[]> {
  try {
    const response = await fetch(NOSTR_WATCH_API, {
      signal: AbortSignal.timeout(API_TIMEOUT),
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new NostrRelayError(
        `Failed to fetch Nostr relays: HTTP ${response.status} ${response.statusText}`
      );
    }

    const relays: string[] = await response.json();

    // Filter for WebSocket Secure relays only
    const wsRelays = relays.filter(r => r.startsWith('wss://'));

    if (wsRelays.length < MIN_RELAYS) {
      throw new NostrRelayError(
        `Insufficient Nostr relays available: got ${wsRelays.length}, need at least ${MIN_RELAYS}`
      );
    }

    // Shuffle for load distribution
    const shuffled = wsRelays.sort(() => Math.random() - 0.5);

    console.log(`[Nostr] Fetched ${shuffled.length} live relays from nostr.watch`);

    return shuffled.slice(0, count);
  } catch (error) {
    if (error instanceof NostrRelayError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new NostrRelayError(
          `Nostr relay API request timed out after ${API_TIMEOUT}ms. Check your internet connection.`
        );
      }
      throw new NostrRelayError(`Failed to fetch Nostr relays: ${error.message}`);
    }

    throw new NostrRelayError('Failed to fetch Nostr relays: Unknown error');
  }
}

/**
 * Check if a specific relay is reachable
 */
export async function checkRelayHealth(relayUrl: string, timeout: number = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(relayUrl);
      const timer = setTimeout(() => {
        ws.close();
        resolve(false);
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

/**
 * Filter relay list to only healthy relays
 */
export async function filterHealthyRelays(
  relays: string[],
  timeout: number = 3000
): Promise<string[]> {
  const healthChecks = await Promise.all(
    relays.map(async (relay) => ({
      relay,
      healthy: await checkRelayHealth(relay, timeout),
    }))
  );

  return healthChecks.filter(r => r.healthy).map(r => r.relay);
}
