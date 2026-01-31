/**
 * Peer Relay Network
 * Routes data through other players when direct connection fails (NAT traversal fallback)
 * Uses end-to-end encryption so relay nodes cannot read the data
 */

import { debugNetworking } from '@/utils/debugLogger';

type EventHandler = (data: { from: string; data: unknown; relayed: boolean; via?: string[] }) => void;

/**
 * Message types for relay protocol
 */
interface RelayMessage {
  type: 'relay-data' | 'peer-list-request' | 'peer-list-response' | 'relay-ping';
  from: string;
  to: string;
  via?: string[];
  payload?: string;
  peers?: string[];
  nonce?: string;
}

/**
 * Peer Relay Network for NAT traversal fallback
 */
export class PeerRelayNetwork {
  private localId: string;
  private directPeers: Map<string, RTCDataChannel> = new Map();
  private relayRoutes: Map<string, string[]> = new Map();
  private knownPeers: Set<string> = new Set();
  private keyPair: CryptoKeyPair | null = null;
  private peerPublicKeys: Map<string, CryptoKey> = new Map();
  private eventHandlers: Map<string, EventHandler[]> = new Map();

  constructor(localId: string) {
    this.localId = localId;
  }

  /**
   * Initialize encryption keys
   */
  async initialize(): Promise<void> {
    this.keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    debugNetworking.log('[PeerRelay] Initialized with local ID:', this.localId.slice(0, 8) + '...');
  }

  /**
   * Get our public key for sharing with peers
   */
  async getPublicKeyJwk(): Promise<JsonWebKey | null> {
    if (!this.keyPair) return null;
    return crypto.subtle.exportKey('jwk', this.keyPair.publicKey);
  }

  /**
   * Import a peer's public key
   */
  async importPeerPublicKey(peerId: string, jwk: JsonWebKey): Promise<void> {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
    this.peerPublicKeys.set(peerId, key);
    debugNetworking.log('[PeerRelay] Imported public key for peer:', peerId.slice(0, 8) + '...');
  }

  /**
   * Register a direct peer connection
   */
  addDirectPeer(peerId: string, channel: RTCDataChannel): void {
    this.directPeers.set(peerId, channel);
    this.knownPeers.add(peerId);

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as RelayMessage;
        this.handleMessage(peerId, message);
      } catch {
        // Not a relay message, pass through as direct message
        this.emit('message', {
          from: peerId,
          data: JSON.parse(event.data),
          relayed: false,
        });
      }
    };

    // Ask them who they know
    this.requestPeerList(peerId);

    debugNetworking.log('[PeerRelay] Added direct peer:', peerId.slice(0, 8) + '...');
  }

  /**
   * Remove a peer connection
   */
  removePeer(peerId: string): void {
    this.directPeers.delete(peerId);
    this.knownPeers.delete(peerId);
    this.peerPublicKeys.delete(peerId);

    // Clear routes that went through this peer
    for (const [target, route] of this.relayRoutes) {
      if (route.includes(peerId)) {
        this.relayRoutes.delete(target);
      }
    }

    debugNetworking.log('[PeerRelay] Removed peer:', peerId.slice(0, 8) + '...');
  }

  /**
   * Check if we can reach a peer (direct or relayed)
   */
  async canReach(targetId: string): Promise<boolean> {
    if (this.directPeers.has(targetId)) return true;

    const route = await this.findRelayRoute(targetId);
    return route.length > 0;
  }

  /**
   * Send data to a peer (direct or relayed) with retry logic
   */
  async sendTo(targetId: string, data: unknown): Promise<void> {
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.sendToInternal(targetId, data);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        // Invalidate route on failure to force fresh lookup
        this.relayRoutes.delete(targetId);
        debugNetworking.warn(
          `[PeerRelay] Send attempt ${attempt + 1}/${MAX_RETRIES} failed:`,
          lastError.message
        );
      }
    }

    throw lastError ?? new Error(`Failed to send to peer ${targetId.slice(0, 8)}...`);
  }

  /**
   * Internal send implementation - throws on failure
   */
  private async sendToInternal(targetId: string, data: unknown): Promise<void> {
    const payload = JSON.stringify(data);

    // Try direct connection first, but only if channel is open
    const directChannel = this.directPeers.get(targetId);
    if (directChannel) {
      if (directChannel.readyState === 'open') {
        this.sendViaChannel(directChannel, payload, targetId);
        return;
      }
      // Channel exists but is closed/closing - remove stale entry and try relay
      this.directPeers.delete(targetId);
      debugNetworking.log(
        `[PeerRelay] Direct channel to ${targetId.slice(0, 8)}... is ${directChannel.readyState}, falling back to relay`
      );
    }

    // Find or validate relay route
    let route = this.relayRoutes.get(targetId);
    if (!route || route.length === 0) {
      route = await this.findRelayRoute(targetId);
      if (route.length === 0) {
        throw new Error(`No route to peer ${targetId.slice(0, 8)}...`);
      }
      this.relayRoutes.set(targetId, route);
    }

    // Encrypt payload for target (end-to-end encryption through relay)
    const encrypted = await this.encryptForPeer(targetId, payload);

    const message: RelayMessage = {
      type: 'relay-data',
      from: this.localId,
      to: targetId,
      via: [this.localId],
      payload: encrypted,
    };

    // Send to first hop
    const firstHop = route[0];
    const channel = this.directPeers.get(firstHop);
    if (!channel) {
      throw new Error(`First hop ${firstHop.slice(0, 8)}... not connected`);
    }

    this.sendViaChannel(channel, JSON.stringify(message), firstHop);
  }

  /**
   * Atomically check state and send via channel
   * Throws InvalidStateError if channel is not open
   */
  private sendViaChannel(channel: RTCDataChannel, payload: string, peerId: string): void {
    // Atomic check-and-send: if readyState changes between check and send,
    // the send() call will throw InvalidStateError which we propagate
    if (channel.readyState !== 'open') {
      throw new Error(`Channel to ${peerId.slice(0, 8)}... is ${channel.readyState}, not open`);
    }
    // Note: There's still a theoretical TOCTOU window here, but send() will throw
    // InvalidStateError if the channel closes, which we catch in sendTo's retry loop
    channel.send(payload);
  }

  /**
   * Broadcast to all connected peers
   */
  broadcast(data: unknown): void {
    const payload = JSON.stringify(data);
    for (const channel of this.directPeers.values()) {
      if (channel.readyState === 'open') {
        channel.send(payload);
      }
    }
  }

  /**
   * Event listener
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Remove event listener
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emit(event: string, data: { from: string; data: unknown; relayed: boolean; via?: string[] }): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  /**
   * Get list of direct peer IDs
   */
  getDirectPeerIds(): string[] {
    return Array.from(this.directPeers.keys());
  }

  /**
   * Get list of all known peer IDs
   */
  getAllKnownPeerIds(): string[] {
    return Array.from(this.knownPeers);
  }

  // Private methods

  private async findRelayRoute(targetId: string): Promise<string[]> {
    // BFS through known peers
    const visited = new Set<string>([this.localId]);
    const queue: Array<{ peer: string; path: string[] }> = [];

    // Start with direct peers
    for (const peerId of this.directPeers.keys()) {
      queue.push({ peer: peerId, path: [peerId] });
    }

    while (queue.length > 0) {
      const { peer, path } = queue.shift()!;

      if (peer === targetId) {
        return path;
      }

      if (visited.has(peer)) continue;
      visited.add(peer);

      // Ask this peer who they know
      const theirPeers = await this.requestPeerList(peer);
      for (const nextPeer of theirPeers) {
        if (!visited.has(nextPeer)) {
          queue.push({ peer: nextPeer, path: [...path, nextPeer] });
        }
      }
    }

    return []; // No route found
  }

  private handleMessage(fromPeer: string, message: RelayMessage): void {
    switch (message.type) {
      case 'relay-data':
        this.handleRelayData(message);
        break;
      case 'peer-list-request':
        this.handlePeerListRequest(fromPeer);
        break;
      case 'peer-list-response':
        // Handled in requestPeerList promise
        break;
    }
  }

  private async handleRelayData(message: RelayMessage): Promise<void> {
    if (message.to === this.localId) {
      // We're the destination - decrypt and emit
      try {
        const decrypted = await this.decryptFromPeer(message.from, message.payload!);
        this.emit('message', {
          from: message.from,
          data: JSON.parse(decrypted),
          relayed: true,
          via: message.via,
        });
      } catch (e) {
        debugNetworking.error('[PeerRelay] Failed to decrypt relay data:', e);
      }
    } else {
      // We're a relay - forward to next hop
      const route = this.relayRoutes.get(message.to);
      if (route && route.length > 0) {
        const nextHop = route[0];
        const channel = this.directPeers.get(nextHop);
        if (channel && channel.readyState === 'open') {
          message.via = [...(message.via || []), this.localId];
          channel.send(JSON.stringify(message));
        }
      }
    }
  }

  private handlePeerListRequest(fromPeer: string): void {
    const channel = this.directPeers.get(fromPeer);
    if (!channel) return;

    const response: RelayMessage = {
      type: 'peer-list-response',
      from: this.localId,
      to: fromPeer,
      peers: Array.from(this.knownPeers),
    };

    channel.send(JSON.stringify(response));
  }

  private requestPeerList(peerId: string): Promise<string[]> {
    return new Promise((resolve) => {
      const channel = this.directPeers.get(peerId);
      if (!channel || channel.readyState !== 'open') {
        resolve([]);
        return;
      }

      const timeout = setTimeout(() => {
        channel.removeEventListener('message', messageHandler);
        resolve([]);
      }, 3000);

      // Use addEventListener to avoid overwriting existing handlers
      const messageHandler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data) as RelayMessage;
          if (msg.type === 'peer-list-response' && msg.from === peerId) {
            clearTimeout(timeout);
            channel.removeEventListener('message', messageHandler);

            // Add their peers to our known peers
            for (const peer of msg.peers || []) {
              this.knownPeers.add(peer);
            }

            resolve(msg.peers || []);
          }
        } catch {
          // Not a relay message, let other handlers process it
        }
      };

      channel.addEventListener('message', messageHandler);

      const request: RelayMessage = {
        type: 'peer-list-request',
        from: this.localId,
        to: peerId,
      };

      channel.send(JSON.stringify(request));
    });
  }

  private async encryptForPeer(peerId: string, data: string): Promise<string> {
    const peerPublicKey = this.peerPublicKeys.get(peerId);
    if (!peerPublicKey || !this.keyPair) {
      // Encryption is required for relay messages - relay nodes must not read game commands
      throw new Error(`Cannot encrypt for peer ${peerId.slice(0, 8)}...: missing encryption keys`);
    }

    // Derive shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPublicKey },
      this.keyPair.privateKey,
      256
    );

    // Import as AES key
    const aesKey = await crypto.subtle.importKey(
      'raw',
      sharedBits,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    // Encrypt
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      new TextEncoder().encode(data)
    );

    // Return IV + ciphertext as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  private async decryptFromPeer(peerId: string, encrypted: string): Promise<string> {
    const peerPublicKey = this.peerPublicKeys.get(peerId);
    if (!peerPublicKey || !this.keyPair) {
      // Fall back to unencrypted
      return atob(encrypted);
    }

    // Derive shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPublicKey },
      this.keyPair.privateKey,
      256
    );

    // Import as AES key
    const aesKey = await crypto.subtle.importKey(
      'raw',
      sharedBits,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decode
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }
}
