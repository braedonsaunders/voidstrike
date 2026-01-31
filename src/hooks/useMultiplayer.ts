/**
 * Lobby-based multiplayer hook
 *
 * Flow:
 * 1. Your lobby auto-generates a 4-char code
 * 2. Others can join your lobby using your code
 * 3. When they join, they fill an "Open" slot
 * 4. You can also join someone else's lobby using their code
 *
 * IMPORTANT: Uses single-letter tags for relay compatibility.
 * Nostr relays only index single-letter tags by default (NIP-12).
 * - 't' tag: lobby code (e.g., ['t', 'ABCD'])
 * - 'p' tag: target pubkey for direct messages
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { debugNetworking } from '@/utils/debugLogger';
import type { Filter, NostrEvent } from 'nostr-tools';
import { getRelays } from '@/engine/network/p2p/NostrRelays';
import type { PlayerSlot, StartingResources, GameSpeed } from '@/store/gameSetupStore';
import { useMultiplayerStore } from '@/store/multiplayerStore';

// Short code alphabet (no confusing chars)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

// Nostr event kinds for lobby signaling
// Using high kind numbers to avoid conflicts with standard Nostr apps
const EVENT_KINDS = {
  LOBBY_HOST: 30430,    // Host announces lobby
  LOBBY_JOIN: 30431,    // Guest requests to join
  LOBBY_ACCEPT: 30432,  // Host accepts guest
  WEBRTC_OFFER: 30433,  // WebRTC offer
  WEBRTC_ANSWER: 30434, // WebRTC answer
  LOBBY_REJECT: 30435,  // Host rejects guest (no slots available)
  PUBLIC_LOBBY: 30436,  // Public lobby listing for browser
};

// Tag for public lobby discovery
const PUBLIC_LOBBY_TAG = 'VOIDSTRIKE_PUBLIC';

// Data channel message types
export type LobbyMessageType = 'lobby_state' | 'game_start' | 'chat' | 'ping';

export interface LobbyState {
  playerSlots: PlayerSlot[];
  selectedMapId: string;
  startingResources: StartingResources;
  gameSpeed: GameSpeed;
  fogOfWar: boolean;
  guestSlotId?: string; // Which slot the guest is in
}

export interface LobbyMessage {
  type: LobbyMessageType;
  payload: unknown;
  timestamp: number;
}

export interface GameStartPayload {
  startTime: number;
}

// STUN servers
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type LobbyStatus =
  | 'disabled'     // Nostr not active (single-player mode)
  | 'initializing'
  | 'hosting'      // Your lobby is active, waiting for guests
  | 'joining'      // Attempting to join another lobby
  | 'connected'    // Connected to another lobby as guest
  | 'error';

export interface GuestConnection {
  pubkey: string;
  name: string;
  slotId: string;
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
}

interface UseLobbyReturn {
  status: LobbyStatus;
  lobbyCode: string | null;
  error: string | null;
  guests: GuestConnection[];
  // As guest, connection to host
  hostConnection: RTCDataChannel | null;
  isHost: boolean;
  // Received lobby state (for guests)
  receivedLobbyState: LobbyState | null;
  mySlotId: string | null; // Which slot the current player is in
  // Actions
  joinLobby: (code: string, playerName: string) => Promise<void>;
  leaveLobby: () => void;
  kickGuest: (pubkey: string) => void;
  // Messaging
  sendLobbyState: (state: LobbyState) => void;
  sendGameStart: () => number; // Returns count of guests notified
  onGameStart: (callback: () => void) => void;
  // Connection status
  connectedGuestCount: number;
  // Reconnection
  reconnect: () => Promise<boolean>;
  // Public lobby listing
  publishPublicListing: (lobbyData: {
    hostName: string;
    mapName: string;
    mapId: string;
    currentPlayers: number;
    maxPlayers: number;
    gameMode: string;
  }) => Promise<boolean>;
}

function generateLobbyCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

async function gatherICE(pc: RTCPeerConnection, timeout = 3000): Promise<string[]> {
  const candidates: string[] = [];

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(candidates);
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      pc.onicecandidate = null;
      pc.onicegatheringstatechange = null;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        candidates.push(e.candidate.candidate);
      } else {
        cleanup();
        resolve(candidates);
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup();
        resolve(candidates);
      }
    };
  });
}

/**
 * Publish to multiple relays, succeeding if at least one works
 * Doesn't throw if some relays fail (including rate-limit errors)
 */
async function publishToRelays(
  pool: SimplePool,
  relays: string[],
  event: NostrEvent
): Promise<boolean> {
  const results = await Promise.allSettled(
    relays.map(r =>
      // pool.publish returns Promise<string>[], wrap in Promise.all to get single Promise
      Promise.all(pool.publish([r], event)).catch(err => {
        // Silently ignore rate-limit errors - they're expected with frequent events
        if (err?.message?.includes('rate-limit')) {
          return []; // Return empty array to count as success
        }
        throw err;
      })
    )
  );

  const successCount = results.filter(r => r.status === 'fulfilled').length;
  if (successCount > 0) {
    debugNetworking.log(`[Lobby] Published to ${successCount}/${relays.length} relays`);
  } else {
    debugNetworking.warn(`[Lobby] Failed to publish to any relay`);
  }

  return successCount > 0;
}

export interface UseLobbyOptions {
  /** When false, Nostr is not initialized (single-player mode). Defaults to true. */
  enabled?: boolean;
  /** Called when a guest requests to join. Returns slot ID or null if no slots. */
  onGuestJoin?: (guestName: string) => string | null;
  /** Called when a guest leaves. */
  onGuestLeave?: (slotId: string) => void;
}

export function useLobby(options: UseLobbyOptions = {}): UseLobbyReturn {
  const { enabled = true, onGuestJoin, onGuestLeave } = options;

  const [status, setStatus] = useState<LobbyStatus>(enabled ? 'initializing' : 'disabled');
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<GuestConnection[]>([]);
  const [hostConnection, setHostConnection] = useState<RTCDataChannel | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [receivedLobbyState, setReceivedLobbyState] = useState<LobbyState | null>(null);

  // Store joined lobby info for reconnection
  const joinedCodeRef = useRef<string | null>(null);
  const joinedNameRef = useRef<string | null>(null);
  // Track when reconnection is in progress to prevent state conflicts with multiplayerStore
  const isReconnectingRef = useRef<boolean>(false);
  const [mySlotId, setMySlotId] = useState<string | null>(null);

  const poolRef = useRef<SimplePool | null>(null);
  const secretKeyRef = useRef<Uint8Array | null>(null);
  const pubkeyRef = useRef<string | null>(null);
  const relaysRef = useRef<string[]>([]);
  const subRef = useRef<{ close: () => void } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null); // For guest mode
  const gameStartCallbackRef = useRef<(() => void) | null>(null);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle incoming messages on the host connection (guest mode)
  useEffect(() => {
    if (!hostConnection) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const message: LobbyMessage = JSON.parse(event.data);
        debugNetworking.log('[Lobby] Received message from host:', message.type);

        switch (message.type) {
          case 'lobby_state': {
            const state = message.payload as LobbyState;
            setReceivedLobbyState(state);
            if (state.guestSlotId) {
              setMySlotId(state.guestSlotId);
            }
            break;
          }
          case 'game_start': {
            debugNetworking.log('[Lobby] Game start signal received');
            gameStartCallbackRef.current?.();
            break;
          }
        }
      } catch (e) {
        debugNetworking.error('[Lobby] Failed to parse message:', e);
      }
    };

    hostConnection.addEventListener('message', handleMessage);
    return () => hostConnection.removeEventListener('message', handleMessage);
  }, [hostConnection]);

  // Initialize lobby (host mode) - only when enabled
  useEffect(() => {
    // Skip initialization in single-player mode
    if (!enabled) {
      setStatus('disabled');
      setLobbyCode(null);
      return;
    }

    let mounted = true;
    setStatus('initializing');

    const initLobby = async () => {
      try {
        // Generate keys and code
        const secretKey = generateSecretKey();
        const pubkey = getPublicKey(secretKey);
        const code = generateLobbyCode();

        secretKeyRef.current = secretKey;
        pubkeyRef.current = pubkey;

        // Get relays
        const relays = await getRelays(6);
        relaysRef.current = relays;

        // Create pool
        const pool = new SimplePool();
        poolRef.current = pool;

        if (!mounted) return;

        setLobbyCode(code);

        debugNetworking.log('[Lobby] Using relays:', relays);

        // Publish lobby announcement
        // Use 't' tag for lobby code (single-letter tags are indexed by relays per NIP-12)
        const lobbyEvent = finalizeEvent({
          kind: EVENT_KINDS.LOBBY_HOST,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', `voidstrike-lobby-${code}`],
            ['t', code], // Use 't' tag for filtering - relays index single-letter tags
          ],
          content: JSON.stringify({ code }),
        }, secretKey);

        const published = await publishToRelays(pool, relays, lobbyEvent);
        if (!published) {
          throw new Error('Failed to publish lobby to any relay');
        }
        debugNetworking.log('[Lobby] Published lobby with code:', code);

        // Subscribe to join requests
        // Use a wide time window to catch events across network delays
        const subscriptionStartTime = Math.floor(Date.now() / 1000) - 300; // 5 minutes back
        const filter: Filter = {
          kinds: [EVENT_KINDS.LOBBY_JOIN],
          '#t': [code], // Filter by 't' tag containing lobby code
          since: subscriptionStartTime,
        };

        debugNetworking.log('[Lobby] Subscribing to join requests for code:', code, 'with filter:', JSON.stringify(filter));
        const sub = pool.subscribeMany(relays, filter, {
          oneose: () => {
            debugNetworking.log('[Lobby] Join subscription caught up with stored events (EOSE), now listening for new events');
          },
          onevent: async (event: NostrEvent) => {
            debugNetworking.log('[Lobby] Received join request event:', event.id.slice(0, 8) + '...', 'tags:', JSON.stringify(event.tags));
            try {
              const data = JSON.parse(event.content);
              const guestPubkey = event.pubkey;
              const guestName = data.name || 'Guest';

              // Try to fill an open slot
              const slotId = onGuestJoin?.(guestName);
              if (!slotId) {
                debugNetworking.log('[Lobby] No open slots available, sending rejection');
                // Send rejection to guest
                const rejectEvent = finalizeEvent({
                  kind: EVENT_KINDS.LOBBY_REJECT,
                  created_at: Math.floor(Date.now() / 1000),
                  tags: [
                    ['p', guestPubkey],
                    ['t', code],
                  ],
                  content: JSON.stringify({ reason: 'No open slots available' }),
                }, secretKey);
                await publishToRelays(pool, relays, rejectEvent);
                return;
              }

              // Create peer connection for this guest
              const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

              // Create data channel
              const channel = pc.createDataChannel('game', { ordered: true });
              channel.onopen = () => {
                debugNetworking.log('[Lobby] Data channel open with guest:', guestName);
                setGuests(prev => prev.map(g =>
                  g.pubkey === guestPubkey ? { ...g, dataChannel: channel } : g
                ));
              };

              // Add guest to list
              const guestConn: GuestConnection = {
                pubkey: guestPubkey,
                name: guestName,
                slotId,
                pc,
                dataChannel: null,
              };
              setGuests(prev => [...prev, guestConn]);

              // Create and send offer
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const iceCandidates = await gatherICE(pc);

              const offerEvent = finalizeEvent({
                kind: EVENT_KINDS.WEBRTC_OFFER,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                  ['p', guestPubkey],
                  ['t', code], // Use 't' tag for lobby code
                ],
                content: JSON.stringify({
                  sdp: offer.sdp,
                  ice: iceCandidates,
                  slotId,
                }),
              }, secretKey);

              await publishToRelays(pool, relays, offerEvent);
              debugNetworking.log('[Lobby] Sent offer to guest');

              // Listen for answer
              const answerFilter: Filter = {
                kinds: [EVENT_KINDS.WEBRTC_ANSWER],
                authors: [guestPubkey],
                '#p': [pubkey],
                since: Math.floor(Date.now() / 1000) - 300, // 5 minutes back
              };
              debugNetworking.log('[Lobby] Subscribing for answer from guest:', guestPubkey.slice(0, 8) + '...');

              const answerSub = pool.subscribeMany(relays, answerFilter, {
                onevent: async (answerEvent: NostrEvent) => {
                  debugNetworking.log('[Lobby] Received answer from guest');
                  try {
                    const answerData = JSON.parse(answerEvent.content);
                    await pc.setRemoteDescription({ type: 'answer', sdp: answerData.sdp });

                    for (const ice of answerData.ice || []) {
                      try {
                        await pc.addIceCandidate({ candidate: ice, sdpMid: '0', sdpMLineIndex: 0 });
                      } catch (e) {
                        debugNetworking.warn('[Lobby] ICE error:', e);
                      }
                    }
                  } catch (e) {
                    debugNetworking.error('[Lobby] Failed to process answer:', e);
                  }
                },
              });

              // Handle disconnect
              pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                  debugNetworking.log('[Lobby] Guest disconnected:', guestName);
                  onGuestLeave?.(slotId);
                  setGuests(prev => prev.filter(g => g.pubkey !== guestPubkey));
                  answerSub.close();
                }
              };

            } catch (e) {
              debugNetworking.error('[Lobby] Failed to process join request:', e);
            }
          },
        });

        subRef.current = sub;
        setStatus('hosting');

      } catch (e) {
        debugNetworking.error('[Lobby] Init error:', e);
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to initialize lobby');
          setStatus('error');
        }
      }
    };

    initLobby();

    return () => {
      mounted = false;
      // Cleanup subscriptions - close quietly
      try {
        subRef.current?.close();
        subRef.current = null;
      } catch { /* ignore */ }
      // Clear any pending join timeout to prevent stale state updates
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
      // Don't explicitly close the pool - nostr-tools throws unhandled errors
      // when websockets are already closing. Let browser garbage collect instead.
      poolRef.current = null;
      // Clear refs
      secretKeyRef.current = null;
      pubkeyRef.current = null;
      relaysRef.current = [];
      // Close peer connections
      guests.forEach(g => {
        try {
          g.pc.close();
        } catch { /* ignore */ }
      });
    };
  }, [enabled, onGuestJoin]); // Re-initialize when enabled changes or guest handler changes

  const joinLobby = useCallback(async (code: string, playerName: string) => {
    try {
      setIsHost(false);
      setStatus('joining');
      setError(null);

      const normalizedCode = code.toUpperCase().trim();

      // Store for reconnection
      joinedCodeRef.current = normalizedCode;
      joinedNameRef.current = playerName;

      // Use existing pool or create new one
      const pool = poolRef.current || new SimplePool();
      if (!poolRef.current) poolRef.current = pool;

      const secretKey = secretKeyRef.current || generateSecretKey();
      const pubkey = pubkeyRef.current || getPublicKey(secretKey);

      const relays = relaysRef.current.length > 0 ? relaysRef.current : await getRelays(6);
      if (relaysRef.current.length === 0) relaysRef.current = relays;

      debugNetworking.log('[Lobby] Guest using relays:', relays);
      debugNetworking.log('[Lobby] Guest pubkey:', pubkey.slice(0, 8) + '...');

      // Subscribe for offer FIRST (before sending join request)
      // This ensures we catch the offer even if host responds quickly
      const offerFilter: Filter = {
        kinds: [EVENT_KINDS.WEBRTC_OFFER],
        '#p': [pubkey],
        '#t': [normalizedCode], // Use 't' tag for lobby code
        since: Math.floor(Date.now() / 1000) - 300, // 5 minutes back
      };

      debugNetworking.log('[Lobby] Subscribing for offers with filter:', JSON.stringify(offerFilter));

      let handled = false;

      const offerSub = pool.subscribeMany(relays, offerFilter, {
        onevent: async (event: NostrEvent) => {
          if (handled) return;
          handled = true;
          rejectSub.close(); // Close reject subscription since we got accepted
          // Clear join timeout since we got a response
          if (joinTimeoutRef.current) {
            clearTimeout(joinTimeoutRef.current);
            joinTimeoutRef.current = null;
          }

          debugNetworking.log('[Lobby] Received offer from host:', event.id.slice(0, 8) + '...');
          try {
            const data = JSON.parse(event.content);
            const hostPubkey = event.pubkey;

            // Create peer connection
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            pcRef.current = pc;

            // Handle incoming data channel
            pc.ondatachannel = (e) => {
              debugNetworking.log('[Lobby] Received data channel from host');
              e.channel.onopen = () => {
                debugNetworking.log('[Lobby] Data channel open with host');
                setHostConnection(e.channel);
                setStatus('connected');
              };
              e.channel.onclose = () => {
                debugNetworking.log('[Lobby] Host disconnected');
                setStatus('error');
                setError('Host disconnected');
              };
            };

            // Set remote description (offer)
            await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });

            // Add ICE candidates
            for (const ice of data.ice || []) {
              try {
                await pc.addIceCandidate({ candidate: ice, sdpMid: '0', sdpMLineIndex: 0 });
              } catch (e) {
                debugNetworking.warn('[Lobby] ICE error:', e);
              }
            }

            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const iceCandidates = await gatherICE(pc);

            const answerEvent = finalizeEvent({
              kind: EVENT_KINDS.WEBRTC_ANSWER,
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                ['p', hostPubkey],
              ],
              content: JSON.stringify({
                sdp: answer.sdp,
                ice: iceCandidates,
              }),
            }, secretKey);

            await publishToRelays(pool, relays, answerEvent);
            debugNetworking.log('[Lobby] Sent answer to host');

          } catch (e) {
            debugNetworking.error('[Lobby] Failed to process offer:', e);
            setError('Failed to connect to host');
            // Don't reset to host mode during reconnection - let multiplayerStore handle retry
            if (!isReconnectingRef.current) {
              setIsHost(true); // Reset to host mode
              setStatus('hosting'); // Go back to hosting so user can try again
            }
          }
        },
        oneose: () => {
          debugNetworking.log('[Lobby] Offer subscription caught up (EOSE)');
        },
      });

      // Also subscribe for rejection events (no slots available)
      const rejectFilter: Filter = {
        kinds: [EVENT_KINDS.LOBBY_REJECT],
        '#p': [pubkey],
        '#t': [normalizedCode],
        since: Math.floor(Date.now() / 1000) - 300,
      };

      const rejectSub = pool.subscribeMany(relays, rejectFilter, {
        onevent: (event: NostrEvent) => {
          if (handled) return;
          handled = true;
          offerSub.close(); // Close offer subscription
          // Clear join timeout since we got a response
          if (joinTimeoutRef.current) {
            clearTimeout(joinTimeoutRef.current);
            joinTimeoutRef.current = null;
          }

          debugNetworking.log('[Lobby] Received rejection from host');
          try {
            const data = JSON.parse(event.content);
            setError(data.reason || 'Lobby is full');
            // Don't reset to host mode during reconnection - let multiplayerStore handle retry
            if (!isReconnectingRef.current) {
              setIsHost(true); // Reset to host mode so Join button reappears
              setStatus('hosting'); // Go back to hosting so user can try again
            }
          } catch {
            setError('Lobby is full - no open slots available');
            // Don't reset to host mode during reconnection - let multiplayerStore handle retry
            if (!isReconnectingRef.current) {
              setIsHost(true); // Reset to host mode so Join button reappears
              setStatus('hosting');
            }
          }
        },
      });

      // Small delay to ensure subscriptions are active before publishing join request
      await new Promise(resolve => setTimeout(resolve, 500));

      // Publish join request with 't' tag for lobby code
      const joinEvent = finalizeEvent({
        kind: EVENT_KINDS.LOBBY_JOIN,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['t', normalizedCode], // Use 't' tag for filtering by relays
        ],
        content: JSON.stringify({ name: playerName }),
      }, secretKey);

      debugNetworking.log('[Lobby] Publishing join request with tags:', JSON.stringify(joinEvent.tags));
      const published = await publishToRelays(pool, relays, joinEvent);
      if (!published) {
        offerSub.close();
        rejectSub.close();
        throw new Error('Failed to publish join request to any relay');
      }
      debugNetworking.log('[Lobby] Sent join request for code:', normalizedCode);

      // Timeout after 30 seconds - store ref for cleanup on unmount
      joinTimeoutRef.current = setTimeout(() => {
        if (!handled) {
          offerSub.close();
          rejectSub.close();
          setError('No lobby found with that code');
          // Don't reset to host mode during reconnection - let multiplayerStore handle retry
          if (!isReconnectingRef.current) {
            setIsHost(true); // Reset to host mode so Join button reappears
            setStatus('hosting'); // Go back to hosting so user can try again
          }
        }
        joinTimeoutRef.current = null;
      }, 30000);

    } catch (e) {
      debugNetworking.error('[Lobby] Join error:', e);
      setError(e instanceof Error ? e.message : 'Failed to join lobby');
      // Don't reset to host mode during reconnection - let multiplayerStore handle retry
      if (!isReconnectingRef.current) {
        setIsHost(true); // Reset to host mode so Join button reappears
        setStatus('hosting'); // Go back to hosting so user can try again
      }
    }
  }, []);

  const leaveLobby = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setHostConnection(null);
    setIsHost(true);
    setStatus('hosting');
  }, []);

  const kickGuest = useCallback((pubkey: string) => {
    const guest = guests.find(g => g.pubkey === pubkey);
    if (guest) {
      guest.pc.close();
      onGuestLeave?.(guest.slotId);
      setGuests(prev => prev.filter(g => g.pubkey !== pubkey));
    }
  }, [guests, onGuestLeave]);

  // Send lobby state to all connected guests (host only)
  const sendLobbyState = useCallback((state: LobbyState) => {
    if (!isHost) return;

    const connectedGuests = guests.filter(g => g.dataChannel?.readyState === 'open');
    if (connectedGuests.length === 0) return;

    debugNetworking.log('[Lobby] Sending lobby state to', connectedGuests.length, 'guests');

    connectedGuests.forEach(guest => {
      // Include guest's slot ID in their message
      const guestState: LobbyState = {
        ...state,
        guestSlotId: guest.slotId,
      };

      const message: LobbyMessage = {
        type: 'lobby_state',
        payload: guestState,
        timestamp: Date.now(),
      };

      try {
        guest.dataChannel?.send(JSON.stringify(message));
      } catch (e) {
        debugNetworking.error('[Lobby] Failed to send to guest:', e);
      }
    });
  }, [isHost, guests]);

  // Send game start signal to all guests (host only)
  // Returns number of guests successfully notified
  const sendGameStart = useCallback((): number => {
    if (!isHost) return 0;

    const connectedGuests = guests.filter(g => g.dataChannel?.readyState === 'open');
    debugNetworking.log('[Lobby] Sending game start to', connectedGuests.length, 'guests');

    if (connectedGuests.length === 0) {
      debugNetworking.warn('[Lobby] No connected guests to send game start to');
      return 0;
    }

    const message: LobbyMessage = {
      type: 'game_start',
      payload: { startTime: Date.now() } as GameStartPayload,
      timestamp: Date.now(),
    };

    let successCount = 0;
    connectedGuests.forEach(guest => {
      try {
        guest.dataChannel?.send(JSON.stringify(message));
        successCount++;
      } catch (e) {
        debugNetworking.error('[Lobby] Failed to send game start to guest:', e);
      }
    });

    return successCount;
  }, [isHost, guests]);

  // Register callback for game start (guest only)
  const onGameStart = useCallback((callback: () => void) => {
    gameStartCallbackRef.current = callback;
  }, []);

  // Reconnection function for guests
  // This is called by multiplayerStore.attemptReconnect() which handles exponential backoff
  const reconnect = useCallback(async (): Promise<boolean> => {
    // Only guests need to reconnect - hosts wait for guests to reconnect to them
    if (isHost) {
      debugNetworking.log('[Lobby] Host does not need to reconnect');
      return true;
    }

    const code = joinedCodeRef.current;
    const name = joinedNameRef.current;

    if (!code || !name) {
      debugNetworking.error('[Lobby] Cannot reconnect - no stored lobby info');
      return false;
    }

    debugNetworking.log('[Lobby] Attempting to reconnect to lobby:', code);

    // Set reconnecting flag to prevent joinLobby from resetting to host mode on failure
    // multiplayerStore owns the reconnection state machine and will handle retries
    isReconnectingRef.current = true;

    try {
      // Close existing peer connection
      pcRef.current?.close();
      pcRef.current = null;
      setHostConnection(null);

      // Re-join the lobby
      await joinLobby(code, name);

      // Wait a bit for connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if we successfully connected by checking the actual connection state
      const currentHostConnection = pcRef.current;
      const isConnected = currentHostConnection !== null;

      debugNetworking.log('[Lobby] Reconnection result:', isConnected ? 'success' : 'failed');

      // Clear reconnecting flag on success - store will handle state
      if (isConnected) {
        isReconnectingRef.current = false;
      }
      // On failure, keep flag set - store will either retry or mark as failed

      return isConnected;
    } catch (e) {
      debugNetworking.error('[Lobby] Reconnection failed:', e);
      // Keep reconnecting flag set - store will handle retry or failure
      return false;
    }
  }, [isHost, joinLobby]);

  // Wire up reconnection callback to multiplayerStore
  // This enables automatic reconnection when the data channel closes
  useEffect(() => {
    if (status === 'connected' || status === 'hosting') {
      debugNetworking.log('[Lobby] Wiring reconnection callback to multiplayerStore');
      useMultiplayerStore.getState().setReconnectCallback(reconnect);
    }

    return () => {
      // Clean up on unmount
      useMultiplayerStore.getState().setReconnectCallback(null);
      isReconnectingRef.current = false;
    };
  }, [status, reconnect]);

  // Sync data channel to multiplayerStore for game integration (guest mode)
  useEffect(() => {
    if (hostConnection && hostConnection.readyState === 'open') {
      const store = useMultiplayerStore.getState();
      const hostPubkey = pubkeyRef.current ? `host-${pubkeyRef.current.slice(0, 8)}` : 'host';

      debugNetworking.log('[Lobby] Syncing host connection to multiplayerStore');

      // Use addPeer for consistency with multi-peer architecture
      store.addPeer(hostPubkey, hostConnection);
      store.setMultiplayer(true);
      store.setHost(false);
    }
  }, [hostConnection]);

  // Set up peer-to-slot mapping for guests once we receive lobby state
  useEffect(() => {
    if (!hostConnection || hostConnection.readyState !== 'open' || !receivedLobbyState) {
      return;
    }

    const store = useMultiplayerStore.getState();
    const hostPubkey = pubkeyRef.current ? `host-${pubkeyRef.current.slice(0, 8)}` : 'host';

    // Find the host's slot - the first human player that isn't a guest
    const hostSlot = receivedLobbyState.playerSlots.find(
      slot => slot.type === 'human' && !slot.isGuest
    );

    if (hostSlot) {
      debugNetworking.log(`[Lobby] Setting peer-slot mapping: ${hostPubkey} -> ${hostSlot.id}`);
      store.setPeerSlotMapping(hostPubkey, hostSlot.id);
    }
  }, [hostConnection, receivedLobbyState]);

  // Sync ALL guest data channels to multiplayerStore (for host mode - 8 player support)
  useEffect(() => {
    const connectedGuests = guests.filter(g => g.dataChannel?.readyState === 'open');

    if (connectedGuests.length > 0) {
      const store = useMultiplayerStore.getState();

      // Enable multiplayer mode
      store.setMultiplayer(true);
      store.setHost(true);

      // Add all connected guests to the peer channels and set up peer-slot mapping
      for (const guest of connectedGuests) {
        if (guest.dataChannel) {
          // Check if this peer is already added
          const existingChannel = store.getPeerChannel(guest.pubkey);
          if (!existingChannel) {
            debugNetworking.log(`[Lobby] Adding guest ${guest.name} (${guest.pubkey.slice(0, 8)}...) to multiplayerStore`);
            store.addPeer(guest.pubkey, guest.dataChannel);
          }
          // Set up peer-to-slot mapping for command validation
          // This maps the guest's peer ID to their assigned player slot
          store.setPeerSlotMapping(guest.pubkey, guest.slotId);
        }
      }

      debugNetworking.log(`[Lobby] Total connected guests in store: ${store.getConnectedPeerCount()}`);
    }
  }, [guests]);

  // Count guests with open data channels
  const connectedGuestCount = guests.filter(g => g.dataChannel?.readyState === 'open').length;

  // Publish public lobby listing
  const publishPublicListing = useCallback(async (lobbyData: {
    hostName: string;
    mapName: string;
    mapId: string;
    currentPlayers: number;
    maxPlayers: number;
    gameMode: string;
  }): Promise<boolean> => {
    const pool = poolRef.current;
    const secretKey = secretKeyRef.current;
    const relays = relaysRef.current;
    const code = lobbyCode;

    if (!pool || !secretKey || !code || relays.length === 0) {
      debugNetworking.warn('[Lobby] Cannot publish public listing - not initialized');
      return false;
    }

    try {
      const { publishPublicLobby } = await import('./usePublicLobbies');
      return await publishPublicLobby(pool, relays, secretKey, {
        ...lobbyData,
        code,
      });
    } catch (e) {
      debugNetworking.error('[Lobby] Failed to publish public listing:', e);
      return false;
    }
  }, [lobbyCode]);

  return {
    status,
    lobbyCode,
    error,
    guests,
    hostConnection,
    isHost,
    receivedLobbyState,
    mySlotId,
    joinLobby,
    leaveLobby,
    kickGuest,
    sendLobbyState,
    sendGameStart,
    onGameStart,
    reconnect,
    connectedGuestCount,
    publishPublicListing,
  };
}

// Re-export for backwards compatibility
export { useLobby as useMultiplayer };
