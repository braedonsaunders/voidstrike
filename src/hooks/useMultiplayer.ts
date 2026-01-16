/**
 * Simplified multiplayer hook using short game codes + Nostr signaling
 *
 * Flow:
 * 1. Host generates a 4-char code (e.g., "ABCD")
 * 2. Joiner enters the code
 * 3. Both connect to Nostr and find each other using the code
 * 4. WebRTC signals exchanged automatically via Nostr
 * 5. Direct P2P connection established
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { Filter, NostrEvent } from 'nostr-tools';
import { getRelays } from '@/engine/network/p2p/NostrRelays';

// Short code alphabet (no confusing chars)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

// Nostr event kinds for game signaling
const EVENT_KINDS = {
  GAME_HOST: 30420,    // Host announces game with code
  GAME_JOIN: 30421,    // Joiner requests to join
  GAME_OFFER: 30422,   // WebRTC offer
  GAME_ANSWER: 30423,  // WebRTC answer
};

// STUN servers
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type ConnectionStatus =
  | 'idle'
  | 'generating'
  | 'hosting'
  | 'joining'
  | 'connecting'
  | 'connected'
  | 'error';

interface UseMultiplayerReturn {
  status: ConnectionStatus;
  gameCode: string | null;
  error: string | null;
  dataChannel: RTCDataChannel | null;
  isHost: boolean;
  hostGame: () => Promise<void>;
  joinGame: (code: string) => Promise<void>;
  disconnect: () => void;
}

function generateGameCode(): string {
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

export function useMultiplayer(): UseMultiplayerReturn {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [isHost, setIsHost] = useState<boolean>(false);

  const poolRef = useRef<SimplePool | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const secretKeyRef = useRef<Uint8Array | null>(null);
  const relaysRef = useRef<string[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    poolRef.current?.close(relaysRef.current);
    poolRef.current = null;
    setDataChannel(null);
    cleanupRef.current = null;
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('idle');
    setGameCode(null);
    setError(null);
    setIsHost(false);
  }, [cleanup]);

  const hostGame = useCallback(async () => {
    try {
      cleanup();
      setIsHost(true);
      setStatus('generating');
      setError(null);

      // Generate code and keys
      const code = generateGameCode();
      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);
      secretKeyRef.current = secretKey;
      setGameCode(code);

      // Get relays
      const relays = await getRelays(6);
      relaysRef.current = relays;

      // Create pool
      const pool = new SimplePool();
      poolRef.current = pool;

      // Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      // Create data channel
      const channel = pc.createDataChannel('game', { ordered: true });
      channel.onopen = () => {
        console.log('[Multiplayer] Data channel open!');
        setDataChannel(channel);
        setStatus('connected');
      };
      channel.onerror = (e) => console.error('[Multiplayer] Channel error:', e);

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const iceCandidates = await gatherICE(pc);

      // Publish host event with offer
      const hostEvent = finalizeEvent({
        kind: EVENT_KINDS.GAME_HOST,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `voidstrike-${code}`],
          ['code', code],
        ],
        content: JSON.stringify({
          sdp: offer.sdp,
          ice: iceCandidates,
        }),
      }, secretKey);

      await Promise.any(relays.map(r => pool.publish([r], hostEvent)));
      console.log('[Multiplayer] Published host event for code:', code);

      setStatus('hosting');

      // Subscribe to join requests
      const filter: Filter = {
        kinds: [EVENT_KINDS.GAME_ANSWER],
        '#d': [`voidstrike-${code}`],
        since: Math.floor(Date.now() / 1000) - 60,
      };

      const sub = pool.subscribeMany(relays, filter, {
        onevent: async (event: NostrEvent) => {
          console.log('[Multiplayer] Received answer!');
          try {
            const data = JSON.parse(event.content);

            // Set remote description
            await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });

            // Add ICE candidates
            for (const ice of data.ice || []) {
              try {
                await pc.addIceCandidate({ candidate: ice, sdpMid: '0', sdpMLineIndex: 0 });
              } catch (e) {
                console.warn('[Multiplayer] ICE error:', e);
              }
            }

            setStatus('connecting');
          } catch (e) {
            console.error('[Multiplayer] Failed to process answer:', e);
          }
        },
      });

      cleanupRef.current = () => {
        sub.close();
        cleanup();
      };

    } catch (e) {
      console.error('[Multiplayer] Host error:', e);
      setError(e instanceof Error ? e.message : 'Failed to host game');
      setStatus('error');
    }
  }, [cleanup]);

  const joinGame = useCallback(async (code: string) => {
    try {
      cleanup();
      setIsHost(false);
      setStatus('joining');
      setError(null);
      setGameCode(code.toUpperCase());

      const normalizedCode = code.toUpperCase().trim();

      // Generate keys
      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);
      secretKeyRef.current = secretKey;

      // Get relays
      const relays = await getRelays(6);
      relaysRef.current = relays;

      // Create pool
      const pool = new SimplePool();
      poolRef.current = pool;

      // Subscribe to host events
      const filter: Filter = {
        kinds: [EVENT_KINDS.GAME_HOST],
        '#code': [normalizedCode],
        since: Math.floor(Date.now() / 1000) - 300, // Last 5 minutes
      };

      console.log('[Multiplayer] Looking for host with code:', normalizedCode);

      let foundHost = false;

      const sub = pool.subscribeMany(relays, filter, {
        onevent: async (event: NostrEvent) => {
          if (foundHost) return;
          foundHost = true;

          console.log('[Multiplayer] Found host!');

          try {
            const data = JSON.parse(event.content);

            // Create peer connection
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            pcRef.current = pc;

            // Handle incoming data channel
            pc.ondatachannel = (e) => {
              console.log('[Multiplayer] Received data channel!');
              e.channel.onopen = () => {
                console.log('[Multiplayer] Data channel open!');
                setDataChannel(e.channel);
                setStatus('connected');
              };
            };

            // Set remote description (offer)
            await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });

            // Add ICE candidates
            for (const ice of data.ice || []) {
              try {
                await pc.addIceCandidate({ candidate: ice, sdpMid: '0', sdpMLineIndex: 0 });
              } catch (e) {
                console.warn('[Multiplayer] ICE error:', e);
              }
            }

            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const iceCandidates = await gatherICE(pc);

            const answerEvent = finalizeEvent({
              kind: EVENT_KINDS.GAME_ANSWER,
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                ['d', `voidstrike-${normalizedCode}`],
                ['p', event.pubkey],
              ],
              content: JSON.stringify({
                sdp: answer.sdp,
                ice: iceCandidates,
              }),
            }, secretKey);

            await Promise.any(relays.map(r => pool.publish([r], answerEvent)));
            console.log('[Multiplayer] Sent answer!');

            setStatus('connecting');

          } catch (e) {
            console.error('[Multiplayer] Failed to join:', e);
            setError('Failed to connect to host');
            setStatus('error');
          }
        },
        oneose: () => {
          // If no host found after initial scan, keep waiting
          if (!foundHost) {
            console.log('[Multiplayer] No host found yet, waiting...');
          }
        },
      });

      cleanupRef.current = () => {
        sub.close();
        cleanup();
      };

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!foundHost && status === 'joining') {
          setError('No game found with that code. Make sure the host is waiting.');
          setStatus('error');
        }
      }, 30000);

    } catch (e) {
      console.error('[Multiplayer] Join error:', e);
      setError(e instanceof Error ? e.message : 'Failed to join game');
      setStatus('error');
    }
  }, [cleanup, status]);

  return {
    status,
    gameCode,
    error,
    dataChannel,
    isHost,
    hostGame,
    joinGame,
    disconnect,
  };
}
