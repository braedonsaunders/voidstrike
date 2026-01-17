/**
 * Hook for browsing and subscribing to public VOIDSTRIKE lobbies via Nostr
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import type { Filter, NostrEvent } from 'nostr-tools';
import { getRelays } from '@/engine/network/p2p/NostrRelays';

// Must match the event kind in useMultiplayer.ts
const PUBLIC_LOBBY_KIND = 30436;
const PUBLIC_LOBBY_TAG = 'VOIDSTRIKE_PUBLIC';

// Max age for lobbies to show (5 minutes)
const MAX_LOBBY_AGE_SECONDS = 300;

export interface PublicLobby {
  id: string;
  code: string;
  hostName: string;
  hostPubkey: string;
  mapName: string;
  mapId: string;
  currentPlayers: number;
  maxPlayers: number;
  gameMode: string;
  createdAt: number;
}

interface UsePublicLobbiesReturn {
  lobbies: PublicLobby[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  startBrowsing: () => Promise<void>;
  stopBrowsing: () => void;
}

export function usePublicLobbies(): UsePublicLobbiesReturn {
  const [lobbies, setLobbies] = useState<PublicLobby[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poolRef = useRef<SimplePool | null>(null);
  const subRef = useRef<{ close: () => void } | null>(null);
  const relaysRef = useRef<string[]>([]);
  const lobbiesMapRef = useRef<Map<string, PublicLobby>>(new Map());
  const cleanupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up old lobbies periodically
  const cleanupOldLobbies = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - MAX_LOBBY_AGE_SECONDS;

    let changed = false;
    for (const [id, lobby] of lobbiesMapRef.current) {
      if (lobby.createdAt < cutoff) {
        lobbiesMapRef.current.delete(id);
        changed = true;
      }
    }

    if (changed) {
      setLobbies(Array.from(lobbiesMapRef.current.values()));
    }
  }, []);

  const startBrowsing = useCallback(async () => {
    // Guard: Close any existing subscription before creating a new one
    if (subRef.current) {
      subRef.current.close();
      subRef.current = null;
    }
    if (poolRef.current) {
      poolRef.current.close(relaysRef.current);
      poolRef.current = null;
    }
    if (cleanupIntervalRef.current) {
      clearInterval(cleanupIntervalRef.current);
      cleanupIntervalRef.current = null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get relays
      const relays = await getRelays(6);
      relaysRef.current = relays;

      // Create pool
      const pool = new SimplePool();
      poolRef.current = pool;

      // Subscribe to public lobbies
      const filter: Filter = {
        kinds: [PUBLIC_LOBBY_KIND],
        '#t': [PUBLIC_LOBBY_TAG],
        since: Math.floor(Date.now() / 1000) - MAX_LOBBY_AGE_SECONDS,
      };

      console.log('[LobbyBrowser] Subscribing to public lobbies...');

      const sub = pool.subscribeMany(relays, filter, {
        onevent: (event: NostrEvent) => {
          try {
            const data = JSON.parse(event.content);

            // Find the lobby code from tags
            const codeTag = event.tags.find(t => t[0] === 't' && t[1] !== PUBLIC_LOBBY_TAG);
            const code = codeTag?.[1] || data.code;

            if (!code) return;

            const lobby: PublicLobby = {
              id: event.id,
              code,
              hostName: data.hostName || 'Unknown',
              hostPubkey: event.pubkey,
              mapName: data.mapName || 'Unknown Map',
              mapId: data.mapId || '',
              currentPlayers: data.currentPlayers || 1,
              maxPlayers: data.maxPlayers || 2,
              gameMode: data.gameMode || 'standard',
              createdAt: event.created_at,
            };

            // Update or add lobby
            lobbiesMapRef.current.set(event.id, lobby);
            setLobbies(Array.from(lobbiesMapRef.current.values()));

            console.log('[LobbyBrowser] Found lobby:', lobby.hostName, lobby.code);
          } catch (e) {
            console.warn('[LobbyBrowser] Failed to parse lobby event:', e);
          }
        },
        oneose: () => {
          console.log('[LobbyBrowser] Caught up with stored events');
          setIsLoading(false);
        },
      });

      subRef.current = sub;

      // Set up periodic cleanup using ref
      cleanupIntervalRef.current = setInterval(cleanupOldLobbies, 30000);

    } catch (e) {
      console.error('[LobbyBrowser] Error:', e);
      setError(e instanceof Error ? e.message : 'Failed to browse lobbies');
      setIsLoading(false);
    }
  }, [cleanupOldLobbies]);

  const stopBrowsing = useCallback(() => {
    if (cleanupIntervalRef.current) {
      clearInterval(cleanupIntervalRef.current);
      cleanupIntervalRef.current = null;
    }
    if (subRef.current) {
      subRef.current.close();
      subRef.current = null;
    }
    if (poolRef.current) {
      poolRef.current.close(relaysRef.current);
      poolRef.current = null;
    }
    lobbiesMapRef.current.clear();
    setLobbies([]);
  }, []);

  const refresh = useCallback(async () => {
    stopBrowsing();
    lobbiesMapRef.current.clear();
    setLobbies([]);
    await startBrowsing();
  }, [startBrowsing, stopBrowsing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopBrowsing();
    };
  }, [stopBrowsing]);

  return {
    lobbies,
    isLoading,
    error,
    refresh,
    startBrowsing,
    stopBrowsing,
  };
}

/**
 * Publish a public lobby listing
 */
export async function publishPublicLobby(
  pool: SimplePool,
  relays: string[],
  secretKey: Uint8Array,
  lobbyData: {
    code: string;
    hostName: string;
    mapName: string;
    mapId: string;
    currentPlayers: number;
    maxPlayers: number;
    gameMode: string;
  }
): Promise<boolean> {
  // Import finalizeEvent dynamically to avoid circular deps
  const { finalizeEvent } = await import('nostr-tools');

  const event = finalizeEvent({
    kind: PUBLIC_LOBBY_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', PUBLIC_LOBBY_TAG],  // Public lobby tag for discovery
      ['t', lobbyData.code],     // Lobby code tag
    ],
    content: JSON.stringify(lobbyData),
  }, secretKey);

  // Publish to relays
  const results = await Promise.allSettled(
    relays.map(r =>
      Promise.all(pool.publish([r], event)).catch(() => [])
    )
  );

  const successCount = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[LobbyBrowser] Published public lobby to ${successCount}/${relays.length} relays`);

  return successCount > 0;
}
