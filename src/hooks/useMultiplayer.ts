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
import type { Filter, NostrEvent } from 'nostr-tools';
import { getRelays } from '@/engine/network/p2p/NostrRelays';
import type { PlayerSlot, StartingResources, GameSpeed } from '@/store/gameSetupStore';

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
    console.log(`[Lobby] Published to ${successCount}/${relays.length} relays`);
  } else {
    console.warn(`[Lobby] Failed to publish to any relay`);
  }

  return successCount > 0;
}

export function useLobby(
  onGuestJoin?: (guestName: string) => string | null, // Returns slot ID or null
  onGuestLeave?: (slotId: string) => void
): UseLobbyReturn {
  const [status, setStatus] = useState<LobbyStatus>('initializing');
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<GuestConnection[]>([]);
  const [hostConnection, setHostConnection] = useState<RTCDataChannel | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [receivedLobbyState, setReceivedLobbyState] = useState<LobbyState | null>(null);

  // Store joined lobby info for reconnection
  const joinedCodeRef = useRef<string | null>(null);
  const joinedNameRef = useRef<string | null>(null);
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
        console.log('[Lobby] Received message from host:', message.type);

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
            console.log('[Lobby] Game start signal received!');
            gameStartCallbackRef.current?.();
            break;
          }
        }
      } catch (e) {
        console.error('[Lobby] Failed to parse message:', e);
      }
    };

    hostConnection.addEventListener('message', handleMessage);
    return () => hostConnection.removeEventListener('message', handleMessage);
  }, [hostConnection]);

  // Initialize lobby (host mode)
  useEffect(() => {
    let mounted = true;

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

        console.log('[Lobby] Using relays:', relays);

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
        console.log('[Lobby] Published lobby with code:', code);

        // Subscribe to join requests
        // Use a wide time window to catch events across network delays
        const subscriptionStartTime = Math.floor(Date.now() / 1000) - 300; // 5 minutes back
        const filter: Filter = {
          kinds: [EVENT_KINDS.LOBBY_JOIN],
          '#t': [code], // Filter by 't' tag containing lobby code
          since: subscriptionStartTime,
        };

        console.log('[Lobby] Subscribing to join requests for code:', code, 'with filter:', JSON.stringify(filter));
        const sub = pool.subscribeMany(relays, filter, {
          oneose: () => {
            console.log('[Lobby] Join subscription caught up with stored events (EOSE). Now listening for new events.');
          },
          onevent: async (event: NostrEvent) => {
            console.log('[Lobby] >>> Received join request event:', event.id.slice(0, 8) + '...', 'tags:', JSON.stringify(event.tags));
            try {
              const data = JSON.parse(event.content);
              const guestPubkey = event.pubkey;
              const guestName = data.name || 'Guest';

              // Try to fill an open slot
              const slotId = onGuestJoin?.(guestName);
              if (!slotId) {
                console.log('[Lobby] No open slots available, sending rejection');
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
                console.log('[Lobby] Data channel open with guest:', guestName);
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
              console.log('[Lobby] Sent offer to guest');

              // Listen for answer
              const answerFilter: Filter = {
                kinds: [EVENT_KINDS.WEBRTC_ANSWER],
                authors: [guestPubkey],
                '#p': [pubkey],
                since: Math.floor(Date.now() / 1000) - 300, // 5 minutes back
              };
              console.log('[Lobby] Subscribing for answer from guest:', guestPubkey.slice(0, 8) + '...');

              const answerSub = pool.subscribeMany(relays, answerFilter, {
                onevent: async (answerEvent: NostrEvent) => {
                  console.log('[Lobby] Received answer from guest');
                  try {
                    const answerData = JSON.parse(answerEvent.content);
                    await pc.setRemoteDescription({ type: 'answer', sdp: answerData.sdp });

                    for (const ice of answerData.ice || []) {
                      try {
                        await pc.addIceCandidate({ candidate: ice, sdpMid: '0', sdpMLineIndex: 0 });
                      } catch (e) {
                        console.warn('[Lobby] ICE error:', e);
                      }
                    }
                  } catch (e) {
                    console.error('[Lobby] Failed to process answer:', e);
                  }
                },
              });

              // Handle disconnect
              pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                  console.log('[Lobby] Guest disconnected:', guestName);
                  onGuestLeave?.(slotId);
                  setGuests(prev => prev.filter(g => g.pubkey !== guestPubkey));
                  answerSub.close();
                }
              };

            } catch (e) {
              console.error('[Lobby] Failed to process join request:', e);
            }
          },
        });

        subRef.current = sub;
        setStatus('hosting');

      } catch (e) {
        console.error('[Lobby] Init error:', e);
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
      } catch { /* ignore */ }
      // Clear any pending join timeout to prevent stale state updates
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
      // Don't explicitly close the pool - nostr-tools throws unhandled errors
      // when websockets are already closing. Let browser garbage collect instead.
      poolRef.current = null;
      // Close peer connections
      guests.forEach(g => {
        try {
          g.pc.close();
        } catch { /* ignore */ }
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      console.log('[Lobby] Guest using relays:', relays);
      console.log('[Lobby] Guest pubkey:', pubkey.slice(0, 8) + '...');

      // Subscribe for offer FIRST (before sending join request)
      // This ensures we catch the offer even if host responds quickly
      const offerFilter: Filter = {
        kinds: [EVENT_KINDS.WEBRTC_OFFER],
        '#p': [pubkey],
        '#t': [normalizedCode], // Use 't' tag for lobby code
        since: Math.floor(Date.now() / 1000) - 300, // 5 minutes back
      };

      console.log('[Lobby] Subscribing for offers with filter:', JSON.stringify(offerFilter));

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

          console.log('[Lobby] Received offer from host:', event.id.slice(0, 8) + '...');
          try {
            const data = JSON.parse(event.content);
            const hostPubkey = event.pubkey;

            // Create peer connection
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            pcRef.current = pc;

            // Handle incoming data channel
            pc.ondatachannel = (e) => {
              console.log('[Lobby] Received data channel from host');
              e.channel.onopen = () => {
                console.log('[Lobby] Data channel open with host');
                setHostConnection(e.channel);
                setStatus('connected');
              };
              e.channel.onclose = () => {
                console.log('[Lobby] Host disconnected');
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
                console.warn('[Lobby] ICE error:', e);
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
            console.log('[Lobby] Sent answer to host');

          } catch (e) {
            console.error('[Lobby] Failed to process offer:', e);
            setError('Failed to connect to host');
            setIsHost(true); // Reset to host mode
            setStatus('hosting'); // Go back to hosting so user can try again
          }
        },
        oneose: () => {
          console.log('[Lobby] Offer subscription caught up (EOSE)');
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

          console.log('[Lobby] Received rejection from host');
          try {
            const data = JSON.parse(event.content);
            setError(data.reason || 'Lobby is full');
            setIsHost(true); // Reset to host mode so Join button reappears
            setStatus('hosting'); // Go back to hosting so user can try again
          } catch {
            setError('Lobby is full - no open slots available');
            setIsHost(true); // Reset to host mode so Join button reappears
            setStatus('hosting');
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

      console.log('[Lobby] Publishing join request with tags:', JSON.stringify(joinEvent.tags));
      const published = await publishToRelays(pool, relays, joinEvent);
      if (!published) {
        offerSub.close();
        rejectSub.close();
        throw new Error('Failed to publish join request to any relay');
      }
      console.log('[Lobby] Sent join request for code:', normalizedCode);

      // Timeout after 30 seconds - store ref for cleanup on unmount
      joinTimeoutRef.current = setTimeout(() => {
        if (!handled) {
          offerSub.close();
          rejectSub.close();
          setError('No lobby found with that code');
          setIsHost(true); // Reset to host mode so Join button reappears
          setStatus('hosting'); // Go back to hosting so user can try again
        }
        joinTimeoutRef.current = null;
      }, 30000);

    } catch (e) {
      console.error('[Lobby] Join error:', e);
      setError(e instanceof Error ? e.message : 'Failed to join lobby');
      setIsHost(true); // Reset to host mode so Join button reappears
      setStatus('hosting'); // Go back to hosting so user can try again
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

    console.log('[Lobby] Sending lobby state to', connectedGuests.length, 'guests');

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
        guest.dataChannel!.send(JSON.stringify(message));
      } catch (e) {
        console.error('[Lobby] Failed to send to guest:', e);
      }
    });
  }, [isHost, guests]);

  // Send game start signal to all guests (host only)
  // Returns number of guests successfully notified
  const sendGameStart = useCallback((): number => {
    if (!isHost) return 0;

    const connectedGuests = guests.filter(g => g.dataChannel?.readyState === 'open');
    console.log('[Lobby] Sending game start to', connectedGuests.length, 'guests');

    if (connectedGuests.length === 0) {
      console.warn('[Lobby] No connected guests to send game start to!');
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
        guest.dataChannel!.send(JSON.stringify(message));
        successCount++;
      } catch (e) {
        console.error('[Lobby] Failed to send game start to guest:', e);
      }
    });

    return successCount;
  }, [isHost, guests]);

  // Register callback for game start (guest only)
  const onGameStart = useCallback((callback: () => void) => {
    gameStartCallbackRef.current = callback;
  }, []);

  // Reconnection function for guests
  const reconnect = useCallback(async (): Promise<boolean> => {
    // Only guests need to reconnect - hosts wait for guests to reconnect to them
    if (isHost) {
      console.log('[Lobby] Host does not need to reconnect');
      return true;
    }

    const code = joinedCodeRef.current;
    const name = joinedNameRef.current;

    if (!code || !name) {
      console.error('[Lobby] Cannot reconnect - no stored lobby info');
      return false;
    }

    console.log('[Lobby] Attempting to reconnect to lobby:', code);

    try {
      // Close existing peer connection
      pcRef.current?.close();
      pcRef.current = null;
      setHostConnection(null);

      // Re-join the lobby
      await joinLobby(code, name);

      // Check if we successfully connected
      return status === 'connected';
    } catch (e) {
      console.error('[Lobby] Reconnection failed:', e);
      return false;
    }
  }, [isHost, joinLobby, status]);

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
      console.warn('[Lobby] Cannot publish public listing - not initialized');
      return false;
    }

    try {
      const { publishPublicLobby } = await import('./usePublicLobbies');
      return await publishPublicLobby(pool, relays, secretKey, {
        ...lobbyData,
        code,
      });
    } catch (e) {
      console.error('[Lobby] Failed to publish public listing:', e);
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
