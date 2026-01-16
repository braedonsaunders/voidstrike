/**
 * Nostr relay configuration
 * Uses well-known public relays that accept anonymous posts
 */

// Well-known public relays that accept anonymous posts (no auth/whitelist required)
// These are actively maintained and have good uptime
const PUBLIC_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.bg',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostr.net',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.current.fyi',
];

export class NostrRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NostrRelayError';
  }
}

/**
 * Get a list of public relays for matchmaking
 * Uses well-known public relays that accept anonymous posts
 * @param count Number of relays to return (default 6)
 */
export async function getRelays(count: number = 6): Promise<string[]> {
  // Shuffle for load distribution
  const shuffled = [...PUBLIC_RELAYS].sort(() => Math.random() - 0.5);

  // Return requested count
  const selected = shuffled.slice(0, count);

  console.log(`[Nostr] Using ${selected.length} public relays:`, selected);

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
