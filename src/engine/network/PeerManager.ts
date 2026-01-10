import {
  GameMessage,
  SignalingMessage,
  LobbyPlayer,
  PeerState,
  NetworkState,
  DEFAULT_ICE_SERVERS,
} from './types';
import { SignalingService } from './SignalingService';
import { PeerConnection } from './PeerConnection';

/**
 * PeerManager manages all WebRTC connections in a full mesh topology.
 *
 * In a full mesh, every player connects directly to every other player.
 * For N players, each player has N-1 connections.
 *
 * Connection initiation: To prevent both peers from sending offers
 * simultaneously, the peer with the lexicographically smaller ID initiates.
 */
export class PeerManager {
  private signaling: SignalingService;
  private peers: Map<string, PeerConnection> = new Map();
  private localPlayer: LobbyPlayer;
  private remotePlayers: LobbyPlayer[];
  private iceServers: RTCIceServer[];

  // Connection tracking
  private expectedPeerCount: number;
  private connectionTimeout: number = 30000; // 30 seconds to connect
  private connectionTimer: NodeJS.Timeout | null = null;

  // Latency measurement
  private pingInterval: NodeJS.Timeout | null = null;
  private pingIntervalMs: number = 5000; // Ping every 5 seconds

  // Callbacks
  onAllConnected: (() => void) | null = null;
  onPeerConnected: ((peerId: string) => void) | null = null;
  onPeerDisconnected: ((peerId: string, reason?: string) => void) | null = null;
  onGameMessage: ((message: GameMessage) => void) | null = null;
  onConnectionFailed: ((reason: string) => void) | null = null;
  onNetworkStateChange: ((state: NetworkState) => void) | null = null;

  constructor(
    lobbyId: string,
    localPlayer: LobbyPlayer,
    allPlayers: LobbyPlayer[],
    iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS
  ) {
    this.localPlayer = localPlayer;
    this.remotePlayers = allPlayers.filter(p => p.id !== localPlayer.id);
    this.expectedPeerCount = this.remotePlayers.length;
    this.iceServers = iceServers;

    // Create signaling service
    this.signaling = new SignalingService(
      lobbyId,
      localPlayer.id,
      (message) => this.handleSignalingMessage(message)
    );
  }

  /**
   * Initialize connections to all peers
   */
  async initialize(): Promise<boolean> {
    console.log(`PeerManager: Initializing with ${this.remotePlayers.length} remote players`);

    // Connect to signaling channel
    const connected = await this.signaling.connect();
    if (!connected) {
      this.onConnectionFailed?.('Failed to connect to signaling server');
      return false;
    }

    // Create peer connections for all remote players
    for (const player of this.remotePlayers) {
      this.createPeerConnection(player);
    }

    // Start connection timeout
    this.connectionTimer = setTimeout(() => {
      if (!this.allConnected) {
        const unconnected = this.remotePlayers
          .filter(p => !this.peers.get(p.id)?.isConnected)
          .map(p => p.username);
        this.onConnectionFailed?.(`Connection timeout. Waiting for: ${unconnected.join(', ')}`);
      }
    }, this.connectionTimeout);

    // Initiate connections based on ID comparison
    // Lower ID initiates to prevent simultaneous offers
    for (const player of this.remotePlayers) {
      if (this.localPlayer.id < player.id) {
        console.log(`PeerManager: Initiating connection to ${player.username}`);
        const peer = this.peers.get(player.id);
        if (peer) {
          await peer.createOffer();
        }
      }
    }

    return true;
  }

  private createPeerConnection(player: LobbyPlayer): void {
    const peer = new PeerConnection(
      this.localPlayer.id,
      player.id,
      player.username,
      this.signaling,
      this.iceServers
    );

    peer.onMessage = (message) => {
      this.onGameMessage?.(message);

      // Handle pong responses for latency
      if (message.type === 'pong') {
        this.emitNetworkStateChange();
      }
    };

    peer.onConnected = () => {
      console.log(`PeerManager: Connected to ${player.username}`);
      this.onPeerConnected?.(player.id);
      this.checkAllConnected();
      this.emitNetworkStateChange();
    };

    peer.onDisconnected = (reason) => {
      console.log(`PeerManager: Disconnected from ${player.username}: ${reason}`);
      this.onPeerDisconnected?.(player.id, reason);
      this.emitNetworkStateChange();
    };

    peer.onStateChange = () => {
      this.emitNetworkStateChange();
    };

    this.peers.set(player.id, peer);
  }

  private handleSignalingMessage(message: SignalingMessage): void {
    const peer = this.peers.get(message.from);
    if (!peer) {
      console.warn(`PeerManager: Received message from unknown peer: ${message.from}`);
      return;
    }

    switch (message.type) {
      case 'offer':
        peer.handleOffer(message.payload as RTCSessionDescriptionInit);
        break;
      case 'answer':
        peer.handleAnswer(message.payload as RTCSessionDescriptionInit);
        break;
      case 'ice-candidate':
        peer.handleIceCandidate(message.payload as RTCIceCandidateInit);
        break;
      case 'ready':
        console.log(`PeerManager: Peer ${message.from} is ready`);
        break;
    }
  }

  private checkAllConnected(): void {
    if (this.allConnected) {
      console.log('PeerManager: All peers connected!');

      // Clear connection timeout
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }

      // Close signaling - no longer needed
      this.signaling.disconnect();

      // Start ping interval for latency measurement
      this.startPingInterval();

      this.onAllConnected?.();
    }
  }

  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (peer.isConnected) {
          peer.ping();
        }
      }
    }, this.pingIntervalMs);
  }

  private emitNetworkStateChange(): void {
    const state = this.getNetworkState();
    this.onNetworkStateChange?.(state);
  }

  /**
   * Get current network state
   */
  getNetworkState(): NetworkState {
    const peerStates = new Map<string, PeerState>();
    let totalLatency = 0;
    let connectedCount = 0;

    for (const [id, peer] of this.peers) {
      const player = this.remotePlayers.find(p => p.id === id);

      peerStates.set(id, {
        id,
        username: player?.username || 'Unknown',
        connectionState: peer.connectionState,
        dataChannelState: peer.dataChannelState,
        latency: peer.latency,
        lastSeen: peer.lastSeen,
      });

      if (peer.isConnected) {
        totalLatency += peer.latency;
        connectedCount++;
      }
    }

    const averageLatency = connectedCount > 0 ? totalLatency / connectedCount : 0;

    // Determine connection quality
    let connectionQuality: NetworkState['connectionQuality'] = 'excellent';
    if (averageLatency > 200) {
      connectionQuality = 'critical';
    } else if (averageLatency > 100) {
      connectionQuality = 'poor';
    } else if (averageLatency > 50) {
      connectionQuality = 'good';
    }

    return {
      localPlayerId: this.localPlayer.id,
      peers: peerStates,
      isHost: this.localPlayer.isHost,
      connectionQuality,
      averageLatency,
    };
  }

  /**
   * Broadcast a message to all connected peers
   */
  broadcast(message: Omit<GameMessage, 'senderId'>): void {
    const fullMessage: GameMessage = {
      ...message,
      senderId: this.localPlayer.id,
    };

    for (const peer of this.peers.values()) {
      if (peer.isConnected) {
        peer.send(fullMessage);
      }
    }
  }

  /**
   * Send a message to a specific peer
   */
  sendTo(peerId: string, message: Omit<GameMessage, 'senderId'>): boolean {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.isConnected) {
      return false;
    }

    return peer.send({
      ...message,
      senderId: this.localPlayer.id,
    });
  }

  /**
   * Check if all peers are connected
   */
  get allConnected(): boolean {
    if (this.peers.size !== this.expectedPeerCount) {
      return false;
    }

    for (const peer of this.peers.values()) {
      if (!peer.isConnected) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get count of connected peers
   */
  get connectedPeerCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.isConnected) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get average latency across all peers
   */
  get averageLatency(): number {
    let total = 0;
    let count = 0;

    for (const peer of this.peers.values()) {
      if (peer.isConnected && peer.latency > 0) {
        total += peer.latency;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  /**
   * Disconnect from all peers and cleanup
   */
  disconnect(): void {
    console.log('PeerManager: Disconnecting');

    // Clear timers
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close signaling
    this.signaling.disconnect();

    // Close all peer connections
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
  }
}
