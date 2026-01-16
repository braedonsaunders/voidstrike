/**
 * Lobby-based multiplayer hook
 *
 * Flow:
 * 1. Your lobby auto-generates a 4-char code
 * 2. Others can join your lobby using your code
 * 3. When they join, they fill an "Open" slot
 * 4. You can also join someone else's lobby using their code
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { Filter, NostrEvent } from 'nostr-tools';
import { getRelays } from '@/engine/network/p2p/NostrRelays';

// Short code alphabet (no confusing chars)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

// Nostr event kinds for lobby signaling
const EVENT_KINDS = {
  LOBBY_HOST: 30430,    // Host announces lobby
  LOBBY_JOIN: 30431,    // Guest requests to join
  LOBBY_ACCEPT: 30432,  // Host accepts guest
  WEBRTC_OFFER: 30433,  // WebRTC offer
  WEBRTC_ANSWER: 30434, // WebRTC answer
};

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
  // Actions
  joinLobby: (code: string, playerName: string) => Promise<void>;
  leaveLobby: () => void;
  kickGuest: (pubkey: string) => void;
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
    const timer = setTimeout(() => resolve(candidates), timeout);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        candidates.push(e.candidate.candidate);
      } else {
        clearTimeout(timer);
        resolve(candidates);
      }
    };
  });
}

/**
 * Publish to multiple relays, succeeding if at least one works
 * Doesn't throw if some relays fail
 */
async function publishToRelays(
  pool: SimplePool,
  relays: string[],
  event: NostrEvent
): Promise<boolean> {
  const results = await Promise.allSettled(
    relays.map(r => pool.publish([r], event))
  );

  const successCount = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[Lobby] Published to ${successCount}/${relays.length} relays`);

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

  const poolRef = useRef<SimplePool | null>(null);
  const secretKeyRef = useRef<Uint8Array | null>(null);
  const pubkeyRef = useRef<string | null>(null);
  const relaysRef = useRef<string[]>([]);
  const subRef = useRef<{ close: () => void } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null); // For guest mode

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

        // Publish lobby announcement
        const lobbyEvent = finalizeEvent({
          kind: EVENT_KINDS.LOBBY_HOST,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', `voidstrike-lobby-${code}`],
            ['code', code],
          ],
          content: JSON.stringify({ code }),
        }, secretKey);

        const published = await publishToRelays(pool, relays, lobbyEvent);
        if (!published) {
          throw new Error('Failed to publish lobby to any relay');
        }
        console.log('[Lobby] Published lobby with code:', code);

        // Subscribe to join requests FIRST (before publishing)
        // Use a wide time window to catch events across network delays
        const subscriptionStartTime = Math.floor(Date.now() / 1000) - 300; // 5 minutes back
        const filter: Filter = {
          kinds: [EVENT_KINDS.LOBBY_JOIN],
          '#code': [code],
          since: subscriptionStartTime,
        };

        console.log('[Lobby] Subscribing to join requests for code:', code);
        const sub = pool.subscribeMany(relays, filter, {
          onevent: async (event: NostrEvent) => {
            console.log('[Lobby] Received join request');
            try {
              const data = JSON.parse(event.content);
              const guestPubkey = event.pubkey;
              const guestName = data.name || 'Guest';

              // Try to fill an open slot
              const slotId = onGuestJoin?.(guestName);
              if (!slotId) {
                console.log('[Lobby] No open slots available');
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
                  ['code', code],
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
      subRef.current?.close();
      poolRef.current?.close(relaysRef.current);
      guests.forEach(g => g.pc.close());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const joinLobby = useCallback(async (code: string, playerName: string) => {
    try {
      setIsHost(false);
      setStatus('joining');
      setError(null);

      const normalizedCode = code.toUpperCase().trim();

      // Use existing pool or create new one
      const pool = poolRef.current || new SimplePool();
      if (!poolRef.current) poolRef.current = pool;

      const secretKey = secretKeyRef.current || generateSecretKey();
      const pubkey = pubkeyRef.current || getPublicKey(secretKey);

      const relays = relaysRef.current.length > 0 ? relaysRef.current : await getRelays(6);
      if (relaysRef.current.length === 0) relaysRef.current = relays;

      // Publish join request
      const joinEvent = finalizeEvent({
        kind: EVENT_KINDS.LOBBY_JOIN,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['code', normalizedCode],
        ],
        content: JSON.stringify({ name: playerName }),
      }, secretKey);

      const published = await publishToRelays(pool, relays, joinEvent);
      if (!published) {
        throw new Error('Failed to publish join request to any relay');
      }
      console.log('[Lobby] Sent join request for code:', normalizedCode);

      // Listen for offer from host - start subscription BEFORE sending join request
      // Wide time window to catch events
      const offerFilter: Filter = {
        kinds: [EVENT_KINDS.WEBRTC_OFFER],
        '#p': [pubkey],
        '#code': [normalizedCode],
        since: Math.floor(Date.now() / 1000) - 300, // 5 minutes back
      };

      console.log('[Lobby] Subscribing for offers with pubkey:', pubkey.slice(0, 8) + '...');

      let handled = false;

      const offerSub = pool.subscribeMany(relays, offerFilter, {
        onevent: async (event: NostrEvent) => {
          if (handled) return;
          handled = true;

          console.log('[Lobby] Received offer from host');
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
            console.error('[Lobby] Failed to join:', e);
            setError('Failed to connect to host');
            setStatus('error');
          }
        },
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!handled) {
          offerSub.close();
          setError('No lobby found with that code');
          setStatus('error');
        }
      }, 30000);

    } catch (e) {
      console.error('[Lobby] Join error:', e);
      setError(e instanceof Error ? e.message : 'Failed to join lobby');
      setStatus('error');
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

  return {
    status,
    lobbyCode,
    error,
    guests,
    hostConnection,
    isHost,
    joinLobby,
    leaveLobby,
    kickGuest,
  };
}

// Re-export for backwards compatibility
export { useLobby as useMultiplayer };
