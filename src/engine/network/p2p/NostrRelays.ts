/**
 * Nostr relay configuration
 * Uses well-known public relays that accept anonymous posts
 */

// Well-known public relays that accept anonymous posts (no auth/whitelist required)
// Prioritized by reliability and speed
const PUBLIC_RELAYS = [
  'wss://relay.damus.io',        // Very reliable
  'wss://nos.lol',               // Very reliable
  'wss://relay.primal.net',      // Reliable
  'wss://nostr.mom',             // Reliable
  'wss://relay.nostr.band',      // Usually reliable
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostr.net',
];

export class NostrRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NostrRelayError';
  }
}

/**
 * Get a list of public relays for matchmaking
 * Pre-checks relay health and returns only working ones
 * @param count Number of relays to return (default 6)
 */
export async function getRelays(count: number = 6): Promise<string[]> {
  // Check health of all relays in parallel with short timeout
  const healthyRelays = await filterHealthyRelays(PUBLIC_RELAYS, 2000);

  if (healthyRelays.length === 0) {
    // Fallback: return top relays even if health check failed (might work)
    console.warn('[Nostr] No healthy relays found, using fallback list');
    const fallback = PUBLIC_RELAYS.slice(0, count);
    console.log(`[Nostr] Using ${fallback.length} fallback relays:`, fallback);
    return fallback;
  }

  // Shuffle healthy relays for load distribution
  const shuffled = healthyRelays.sort(() => Math.random() - 0.5);

  // Return requested count
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));

  console.log(`[Nostr] Using ${selected.length} healthy relays:`, selected);

  return selected;
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
