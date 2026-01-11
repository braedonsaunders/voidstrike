import { supabase } from '@/lib/supabase';
import { SignalingMessage, SignalingMessageType } from './types';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { debugNetworking } from '@/utils/debugLogger';

/**
 * SignalingService handles WebRTC signaling through Supabase Realtime.
 *
 * It exchanges SDP offers/answers and ICE candidates between peers
 * to establish direct P2P connections. Once WebRTC connections are
 * established, this service is no longer needed and should be disconnected.
 */
export class SignalingService {
  private channel: RealtimeChannel | null = null;
  private lobbyId: string;
  private localPlayerId: string;
  private onMessage: (message: SignalingMessage) => void;
  private isConnected: boolean = false;

  constructor(
    lobbyId: string,
    localPlayerId: string,
    onMessage: (message: SignalingMessage) => void
  ) {
    this.lobbyId = lobbyId;
    this.localPlayerId = localPlayerId;
    this.onMessage = onMessage;
  }

  /**
   * Connect to the signaling channel
   */
  async connect(): Promise<boolean> {
    if (!supabase) {
      debugNetworking.error('SignalingService: Supabase not available');
      return false;
    }

    if (this.isConnected) {
      return true;
    }

    // Capture reference for use in callback
    const client = supabase;

    return new Promise((resolve) => {
      this.channel = client
        .channel(`signaling:${this.lobbyId}`, {
          config: {
            broadcast: {
              self: false, // Don't receive our own messages
            },
          },
        })
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          const message = payload as SignalingMessage;

          // Only process messages meant for us or broadcast to all
          if (message.to === this.localPlayerId || message.to === 'all') {
            // Don't process our own messages
            if (message.from !== this.localPlayerId) {
              this.onMessage(message);
            }
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.isConnected = true;
            debugNetworking.log(`SignalingService: Connected to channel signaling:${this.lobbyId}`);
            resolve(true);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            debugNetworking.error(`SignalingService: Failed to connect - ${status}`);
            resolve(false);
          }
        });
    });
  }

  /**
   * Send a signaling message to a specific peer or all peers
   */
  async send(
    type: SignalingMessageType,
    to: string,
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit | string
  ): Promise<boolean> {
    if (!this.channel || !this.isConnected) {
      debugNetworking.error('SignalingService: Not connected');
      return false;
    }

    const message: SignalingMessage = {
      type,
      from: this.localPlayerId,
      to,
      payload,
      timestamp: Date.now(),
    };

    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: message,
      });
      return true;
    } catch (error) {
      debugNetworking.error('SignalingService: Failed to send message', error);
      return false;
    }
  }

  /**
   * Send an SDP offer to a specific peer
   */
  async sendOffer(toPeerId: string, offer: RTCSessionDescriptionInit): Promise<boolean> {
    debugNetworking.log(`SignalingService: Sending offer to ${toPeerId}`);
    return this.send('offer', toPeerId, offer);
  }

  /**
   * Send an SDP answer to a specific peer
   */
  async sendAnswer(toPeerId: string, answer: RTCSessionDescriptionInit): Promise<boolean> {
    debugNetworking.log(`SignalingService: Sending answer to ${toPeerId}`);
    return this.send('answer', toPeerId, answer);
  }

  /**
   * Send an ICE candidate to a specific peer
   */
  async sendIceCandidate(toPeerId: string, candidate: RTCIceCandidateInit): Promise<boolean> {
    return this.send('ice-candidate', toPeerId, candidate);
  }

  /**
   * Broadcast ready signal to all peers
   */
  async broadcastReady(): Promise<boolean> {
    debugNetworking.log('SignalingService: Broadcasting ready signal');
    return this.send('ready', 'all', 'ready');
  }

  /**
   * Disconnect from the signaling channel
   */
  disconnect(): void {
    if (this.channel && supabase) {
      debugNetworking.log('SignalingService: Disconnecting');
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if connected to signaling channel
   */
  get connected(): boolean {
    return this.isConnected;
  }
}
