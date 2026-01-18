/**
 * Nostr-based matchmaking for finding games
 * Uses Nostr relays for real-time game discovery
 */

import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type Event,
  type Filter,
} from 'nostr-tools';
import pako from 'pako';
import { getRelays, NostrRelayError } from './NostrRelays';
import { debugNetworking } from '@/utils/debugLogger';

// Nostr event kinds for VOIDSTRIKE (ephemeral range 20000-29999)
const EVENT_KINDS = {
  GAME_SEEK: 20420,      // "I'm looking for a game"
  GAME_OFFER: 20421,     // "Here's my WebRTC offer"
  GAME_ANSWER: 20422,    // "Here's my WebRTC answer"
  GAME_CANCEL: 20423,    // "I'm no longer looking"
};

const GAME_VERSION = '0.1.0';
const GAME_TAG = 'voidstrike';

/**
 * Game seek event content
 */
interface GameSeekContent {
  version: string;
  mode: '1v1' | '2v2' | 'ffa';
  skill?: number;
}

/**
 * WebRTC signal content (offer/answer)
 */
interface RTCSignalContent {
  sdp: string;
  ice: string[];
  mode: string;
  map?: string;
}

/**
 * Matched opponent info
 */
export interface MatchedOpponent {
  pubkey: string;
  mode: '1v1' | '2v2' | 'ffa';
  skill?: number;
  timestamp: number;
}

/**
 * Received offer/answer
 */
export interface ReceivedSignal {
  sdp: string;
  ice: string[];
  mode: string;
  map?: string;
  fromPubkey: string;
}

export class NostrMatchmakingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NostrMatchmakingError';
  }
}

/**
 * Compress SDP for transmission
 */
function compressSDP(sdp: string): string {
  // Remove verbose lines
  const cleaned = sdp
    .split('\r\n')
    .filter(line => !line.startsWith('a=extmap'))
    .filter(line => !line.startsWith('a=rtcp-fb'))
    .join('\r\n');

  const compressed = pako.deflate(cleaned);
  return btoa(String.fromCharCode(...compressed));
}

/**
 * Decompress SDP
 */
function decompressSDP(compressed: string): string {
  const bytes = Uint8Array.from(atob(compressed), c => c.charCodeAt(0));
  return pako.inflate(bytes, { to: 'string' });
}

/**
 * Nostr-based matchmaking service
 */
export class NostrMatchmaking {
  private pool: SimplePool;
  private secretKey: Uint8Array;
  private publicKey: string;
  private relays: string[] = [];
  private subscriptions: Map<string, { close: () => void }> = new Map();
  private connected = false;

  // Callbacks
  public onMatchFound?: (opponent: MatchedOpponent) => void;
  public onOfferReceived?: (signal: ReceivedSignal) => void;
  public onAnswerReceived?: (signal: ReceivedSignal) => void;
  public onError?: (error: Error) => void;
  public onStatusChange?: (status: string) => void;

  constructor() {
    this.pool = new SimplePool();

    // Generate ephemeral keypair
    this.secretKey = generateSecretKey();
    this.publicKey = getPublicKey(this.secretKey);

    debugNetworking.log('[Nostr] Generated ephemeral pubkey:', this.publicKey.slice(0, 16) + '...');
  }

  /**
   * Connect to Nostr relays
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.onStatusChange?.('Fetching Nostr relays...');

    try {
      this.relays = await getRelays(8);
      this.connected = true;
      this.onStatusChange?.(`Connected to ${this.relays.length} relays`);
      debugNetworking.log('[Nostr] Connected to relays:', this.relays);
    } catch (error) {
      this.connected = false;
      if (error instanceof NostrRelayError) {
        throw new NostrMatchmakingError(error.message);
      }
      throw new NostrMatchmakingError('Failed to connect to Nostr relays');
    }
  }

  /**
   * Start looking for a game
   */
  async seekGame(options: {
    mode: '1v1' | '2v2' | 'ffa';
    skill?: number;
  }): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    this.onStatusChange?.('Publishing game seek...');

    // Publish "seeking game" event
    const content: GameSeekContent = {
      version: GAME_VERSION,
      mode: options.mode,
      skill: options.skill,
    };

    const event = finalizeEvent({
      kind: EVENT_KINDS.GAME_SEEK,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', GAME_TAG],
        ['mode', options.mode],
        ['version', GAME_VERSION],
        ...(options.skill ? [['skill', String(options.skill)]] : []),
      ],
      content: JSON.stringify(content),
    }, this.secretKey);

    await Promise.any(this.relays.map(relay =>
      this.pool.publish([relay], event)
    ));

    debugNetworking.log('[Nostr] Published game seek event');
    this.onStatusChange?.('Searching for opponents...');

    // Subscribe to other seekers
    const seekFilter: Filter = {
      kinds: [EVENT_KINDS.GAME_SEEK],
      '#d': [GAME_TAG],
      '#mode': [options.mode],
      since: Math.floor(Date.now() / 1000) - 300, // Last 5 minutes
    };

    const sub = this.pool.subscribeMany(this.relays, seekFilter, {
      onevent: (event) => this.handleSeekEvent(event, options),
      oneose: () => {
        debugNetworking.log('[Nostr] Initial seek scan complete');
      },
    });

    this.subscriptions.set('seek', sub);

    // Subscribe to direct offers
    const offerFilter: Filter = {
      kinds: [EVENT_KINDS.GAME_OFFER],
      '#p': [this.publicKey],
      since: Math.floor(Date.now() / 1000) - 60,
    };

    const offerSub = this.pool.subscribeMany(this.relays, offerFilter, {
      onevent: (event) => this.handleOfferEvent(event),
    });

    this.subscriptions.set('offers', offerSub);
  }

  /**
   * Send WebRTC offer to a specific player
   */
  async sendOffer(
    targetPubkey: string,
    sdp: string,
    iceCandidates: string[],
    options?: { mode?: string; map?: string }
  ): Promise<void> {
    if (!this.connected) {
      throw new NostrMatchmakingError('Not connected to Nostr relays');
    }

    const content: RTCSignalContent = {
      sdp: compressSDP(sdp),
      ice: iceCandidates,
      mode: options?.mode || '1v1',
      map: options?.map,
    };

    const event = finalizeEvent({
      kind: EVENT_KINDS.GAME_OFFER,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', targetPubkey],
      ],
      content: JSON.stringify(content),
    }, this.secretKey);

    await Promise.any(this.relays.map(relay =>
      this.pool.publish([relay], event)
    ));

    debugNetworking.log('[Nostr] Sent offer to', targetPubkey.slice(0, 8) + '...');

    // Subscribe to their answer
    const answerFilter: Filter = {
      kinds: [EVENT_KINDS.GAME_ANSWER],
      '#p': [this.publicKey],
      authors: [targetPubkey],
      since: Math.floor(Date.now() / 1000) - 60,
    };

    const answerSub = this.pool.subscribeMany(this.relays, answerFilter, {
      onevent: (event) => this.handleAnswerEvent(event),
    });

    this.subscriptions.set(`answer-${targetPubkey}`, answerSub);
  }

  /**
   * Send WebRTC answer to complete handshake
   */
  async sendAnswer(
    targetPubkey: string,
    sdp: string,
    iceCandidates: string[]
  ): Promise<void> {
    if (!this.connected) {
      throw new NostrMatchmakingError('Not connected to Nostr relays');
    }

    const content: RTCSignalContent = {
      sdp: compressSDP(sdp),
      ice: iceCandidates,
      mode: '1v1',
    };

    const event = finalizeEvent({
      kind: EVENT_KINDS.GAME_ANSWER,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', targetPubkey],
      ],
      content: JSON.stringify(content),
    }, this.secretKey);

    await Promise.any(this.relays.map(relay =>
      this.pool.publish([relay], event)
    ));

    debugNetworking.log('[Nostr] Sent answer to', targetPubkey.slice(0, 8) + '...');
  }

  /**
   * Cancel matchmaking
   */
  async cancelSeek(): Promise<void> {
    // Close all subscriptions
    for (const sub of this.subscriptions.values()) {
      sub.close();
    }
    this.subscriptions.clear();

    if (!this.connected) return;

    // Publish cancel event
    const event = finalizeEvent({
      kind: EVENT_KINDS.GAME_CANCEL,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', GAME_TAG]],
      content: '',
    }, this.secretKey);

    try {
      await Promise.any(this.relays.map(relay =>
        this.pool.publish([relay], event)
      ));
    } catch {
      // Ignore errors during cancel
    }

    debugNetworking.log('[Nostr] Cancelled matchmaking');
  }

  /**
   * Clean up
   */
  destroy(): void {
    for (const sub of this.subscriptions.values()) {
      sub.close();
    }
    this.subscriptions.clear();
    this.pool.close(this.relays);
    this.connected = false;
  }

  /**
   * Get our public key
   */
  get myPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Check if we should initiate (lower pubkey sends offer)
   */
  shouldInitiate(theirPubkey: string): boolean {
    return this.publicKey < theirPubkey;
  }

  // Private handlers

  private handleSeekEvent(event: Event, ourOptions: { mode: string; skill?: number }): void {
    // Ignore our own events
    if (event.pubkey === this.publicKey) return;

    try {
      const content = JSON.parse(event.content) as GameSeekContent;

      // Version compatibility check
      if (content.version !== GAME_VERSION) {
        debugNetworking.log('[Nostr] Ignoring seeker with different version:', content.version);
        return;
      }

      // Skill bracket check (optional, within 300 points)
      if (ourOptions.skill && content.skill) {
        const skillDiff = Math.abs(ourOptions.skill - content.skill);
        if (skillDiff > 300) {
          debugNetworking.log('[Nostr] Ignoring seeker outside skill range:', skillDiff);
          return;
        }
      }

      debugNetworking.log('[Nostr] Found potential match:', event.pubkey.slice(0, 8) + '...');

      this.onMatchFound?.({
        pubkey: event.pubkey,
        mode: content.mode,
        skill: content.skill,
        timestamp: event.created_at,
      });
    } catch (e) {
      console.error('[Nostr] Failed to parse seek event:', e);
    }
  }

  private handleOfferEvent(event: Event): void {
    if (event.pubkey === this.publicKey) return;

    try {
      const content = JSON.parse(event.content) as RTCSignalContent;
      debugNetworking.log('[Nostr] Received offer from', event.pubkey.slice(0, 8) + '...');

      this.onOfferReceived?.({
        sdp: decompressSDP(content.sdp),
        ice: content.ice,
        mode: content.mode,
        map: content.map,
        fromPubkey: event.pubkey,
      });
    } catch (e) {
      console.error('[Nostr] Failed to parse offer:', e);
    }
  }

  private handleAnswerEvent(event: Event): void {
    if (event.pubkey === this.publicKey) return;

    try {
      const content = JSON.parse(event.content) as RTCSignalContent;
      debugNetworking.log('[Nostr] Received answer from', event.pubkey.slice(0, 8) + '...');

      this.onAnswerReceived?.({
        sdp: decompressSDP(content.sdp),
        ice: content.ice,
        mode: content.mode,
        fromPubkey: event.pubkey,
      });
    } catch (e) {
      console.error('[Nostr] Failed to parse answer:', e);
    }
  }
}
