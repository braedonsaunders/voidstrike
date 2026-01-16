'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  generateOfferCode,
  generateAnswerCode,
  completeConnection,
  createPeerConnection,
  waitForConnection,
  NostrMatchmaking,
  type MatchedOpponent,
  type ReceivedSignal,
} from '@/engine/network/p2p';

export type P2PStatus =
  | 'idle'
  | 'generating_code'
  | 'waiting_for_peer'
  | 'connecting'
  | 'connected'
  | 'searching'
  | 'match_found'
  | 'error';

export interface P2PState {
  status: P2PStatus;
  error: string | null;
  offerCode: string | null;
  peerConnection: RTCPeerConnection | null;
  dataChannel: RTCDataChannel | null;
  nostrStatus: string | null;
  matchedOpponent: MatchedOpponent | null;
}

export interface UseP2PReturn {
  state: P2PState;
  // Connection code methods (Phase 1)
  hostGame: (options?: { mode?: '1v1' | '2v2'; map?: string }) => Promise<void>;
  joinWithCode: (code: string) => Promise<void>;
  completeWithAnswerCode: (answerCode: string) => Promise<void>;
  // Nostr matchmaking methods (Phase 3)
  findMatch: (options: { mode: '1v1' | '2v2' | 'ffa'; skill?: number }) => Promise<void>;
  cancelSearch: () => Promise<void>;
  // Common
  disconnect: () => void;
  sendMessage: (data: unknown) => void;
  onMessage: (handler: (data: unknown) => void) => void;
}

export function useP2P(): UseP2PReturn {
  const [state, setState] = useState<P2PState>({
    status: 'idle',
    error: null,
    offerCode: null,
    peerConnection: null,
    dataChannel: null,
    nostrStatus: null,
    matchedOpponent: null,
  });

  const nostrRef = useRef<NostrMatchmaking | null>(null);
  const messageHandlersRef = useRef<((data: unknown) => void)[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      nostrRef.current?.destroy();
      pcRef.current?.close();
    };
  }, []);

  /**
   * Set up data channel handlers
   */
  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dcRef.current = channel;

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const handler of messageHandlersRef.current) {
          handler(data);
        }
      } catch (e) {
        console.error('[P2P] Failed to parse message:', e);
      }
    };

    channel.onclose = () => {
      console.log('[P2P] Data channel closed');
      setState(s => ({ ...s, status: 'idle', dataChannel: null }));
    };

    channel.onerror = (e) => {
      console.error('[P2P] Data channel error:', e);
    };

    setState(s => ({ ...s, dataChannel: channel }));
  }, []);

  /**
   * Host a game using connection codes (Phase 1)
   */
  const hostGame = useCallback(async (options?: { mode?: '1v1' | '2v2'; map?: string }) => {
    try {
      setState(s => ({ ...s, status: 'generating_code', error: null, offerCode: null }));

      const pc = createPeerConnection();
      pcRef.current = pc;

      // Set up data channel
      pc.ondatachannel = (event) => {
        console.log('[P2P] Received data channel');
        setupDataChannel(event.channel);
      };

      // Generate offer code
      const { code } = await generateOfferCode(pc, options);

      // Get the data channel we created
      const channels = (pc as unknown as { _channels?: RTCDataChannel[] })._channels;
      if (channels && channels.length > 0) {
        setupDataChannel(channels[0]);
      }

      setState(s => ({
        ...s,
        status: 'waiting_for_peer',
        offerCode: code,
        peerConnection: pc,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create game';
      setState(s => ({ ...s, status: 'error', error: message }));
    }
  }, [setupDataChannel]);

  /**
   * Join a game using a connection code (Phase 1)
   */
  const joinWithCode = useCallback(async (code: string) => {
    try {
      setState(s => ({ ...s, status: 'connecting', error: null }));

      // Generate answer and get peer connection
      const { code: answerCode, pc } = await generateAnswerCode(code);
      pcRef.current = pc;

      // Set up data channel handler
      pc.ondatachannel = (event) => {
        console.log('[P2P] Received data channel');
        setupDataChannel(event.channel);
      };

      // Wait for connection
      await waitForConnection(pc, 15000);

      setState(s => ({
        ...s,
        status: 'connected',
        offerCode: answerCode, // This is the answer code to send back
        peerConnection: pc,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join game';
      setState(s => ({ ...s, status: 'error', error: message }));
    }
  }, [setupDataChannel]);

  /**
   * Complete connection with answer code (for host)
   */
  const completeWithAnswerCode = useCallback(async (answerCode: string) => {
    try {
      if (!pcRef.current) {
        throw new Error('No peer connection. Call hostGame first.');
      }

      setState(s => ({ ...s, status: 'connecting', error: null }));

      await completeConnection(pcRef.current, answerCode);
      await waitForConnection(pcRef.current, 15000);

      setState(s => ({ ...s, status: 'connected' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to complete connection';
      setState(s => ({ ...s, status: 'error', error: message }));
    }
  }, []);

  /**
   * Find a match using Nostr (Phase 3)
   */
  const findMatch = useCallback(async (options: { mode: '1v1' | '2v2' | 'ffa'; skill?: number }) => {
    try {
      setState(s => ({
        ...s,
        status: 'searching',
        error: null,
        nostrStatus: 'Initializing...',
        matchedOpponent: null,
      }));

      // Create Nostr matchmaking instance
      const nostr = new NostrMatchmaking();
      nostrRef.current = nostr;

      nostr.onStatusChange = (status) => {
        setState(s => ({ ...s, nostrStatus: status }));
      };

      nostr.onError = (error) => {
        setState(s => ({ ...s, status: 'error', error: error.message }));
      };

      nostr.onMatchFound = async (opponent) => {
        console.log('[P2P] Match found:', opponent.pubkey.slice(0, 8) + '...');
        setState(s => ({ ...s, status: 'match_found', matchedOpponent: opponent }));

        // Determine who initiates (lower pubkey)
        if (nostr.shouldInitiate(opponent.pubkey)) {
          console.log('[P2P] We initiate the connection');
          // Create WebRTC offer and send via Nostr
          const pc = createPeerConnection();
          pcRef.current = pc;

          pc.ondatachannel = (event) => {
            setupDataChannel(event.channel);
          };

          // Create data channel
          const channel = pc.createDataChannel('game', {
            ordered: false,
            maxRetransmits: 2,
          });
          setupDataChannel(channel);

          // Create offer
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          // Gather ICE candidates
          const iceCandidates: string[] = [];
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 3000);
            pc.onicecandidate = (event) => {
              if (event.candidate) {
                iceCandidates.push(event.candidate.candidate);
              } else {
                clearTimeout(timeout);
                resolve();
              }
            };
          });

          // Send offer via Nostr
          await nostr.sendOffer(opponent.pubkey, offer.sdp!, iceCandidates, {
            mode: options.mode,
          });

          setState(s => ({ ...s, peerConnection: pc, nostrStatus: 'Sent offer, waiting for answer...' }));
        } else {
          console.log('[P2P] Waiting for them to initiate');
          setState(s => ({ ...s, nostrStatus: 'Waiting for opponent to initiate...' }));
        }
      };

      nostr.onOfferReceived = async (signal) => {
        console.log('[P2P] Received offer from:', signal.fromPubkey.slice(0, 8) + '...');
        setState(s => ({ ...s, nostrStatus: 'Received offer, creating answer...' }));

        // Create peer connection and answer
        const pc = createPeerConnection();
        pcRef.current = pc;

        pc.ondatachannel = (event) => {
          setupDataChannel(event.channel);
        };

        // Set remote description
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });

        // Add ICE candidates
        for (const candidate of signal.ice) {
          try {
            await pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 });
          } catch (e) {
            console.warn('[P2P] Failed to add ICE candidate:', e);
          }
        }

        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Gather our ICE candidates
        const iceCandidates: string[] = [];
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 3000);
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              iceCandidates.push(event.candidate.candidate);
            } else {
              clearTimeout(timeout);
              resolve();
            }
          };
        });

        // Send answer via Nostr
        await nostr.sendAnswer(signal.fromPubkey, answer.sdp!, iceCandidates);

        setState(s => ({ ...s, peerConnection: pc, nostrStatus: 'Sent answer, connecting...' }));

        // Wait for connection
        try {
          await waitForConnection(pc, 15000);
          setState(s => ({ ...s, status: 'connected', nostrStatus: 'Connected!' }));
          nostr.destroy(); // No longer need Nostr
        } catch (e) {
          setState(s => ({ ...s, status: 'error', error: 'Connection timed out' }));
        }
      };

      nostr.onAnswerReceived = async (signal) => {
        console.log('[P2P] Received answer from:', signal.fromPubkey.slice(0, 8) + '...');
        setState(s => ({ ...s, nostrStatus: 'Received answer, connecting...' }));

        if (!pcRef.current) {
          console.error('[P2P] No peer connection');
          return;
        }

        // Set remote description
        await pcRef.current.setRemoteDescription({ type: 'answer', sdp: signal.sdp });

        // Add ICE candidates
        for (const candidate of signal.ice) {
          try {
            await pcRef.current.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 });
          } catch (e) {
            console.warn('[P2P] Failed to add ICE candidate:', e);
          }
        }

        // Wait for connection
        try {
          await waitForConnection(pcRef.current, 15000);
          setState(s => ({ ...s, status: 'connected', nostrStatus: 'Connected!' }));
          nostr.destroy(); // No longer need Nostr
        } catch (e) {
          setState(s => ({ ...s, status: 'error', error: 'Connection timed out' }));
        }
      };

      // Start seeking
      await nostr.seekGame(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to find match';
      setState(s => ({ ...s, status: 'error', error: message }));
    }
  }, [setupDataChannel]);

  /**
   * Cancel matchmaking search
   */
  const cancelSearch = useCallback(async () => {
    await nostrRef.current?.cancelSeek();
    nostrRef.current?.destroy();
    nostrRef.current = null;
    setState(s => ({ ...s, status: 'idle', nostrStatus: null, matchedOpponent: null }));
  }, []);

  /**
   * Disconnect from peer
   */
  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    nostrRef.current?.destroy();

    dcRef.current = null;
    pcRef.current = null;
    nostrRef.current = null;

    setState({
      status: 'idle',
      error: null,
      offerCode: null,
      peerConnection: null,
      dataChannel: null,
      nostrStatus: null,
      matchedOpponent: null,
    });
  }, []);

  /**
   * Send a message to the peer
   */
  const sendMessage = useCallback((data: unknown) => {
    if (dcRef.current && dcRef.current.readyState === 'open') {
      dcRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[P2P] Cannot send message: data channel not open');
    }
  }, []);

  /**
   * Register a message handler
   */
  const onMessage = useCallback((handler: (data: unknown) => void) => {
    messageHandlersRef.current.push(handler);
  }, []);

  return {
    state,
    hostGame,
    joinWithCode,
    completeWithAnswerCode,
    findMatch,
    cancelSearch,
    disconnect,
    sendMessage,
    onMessage,
  };
}
