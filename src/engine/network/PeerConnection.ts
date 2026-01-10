import { GameMessage, ConnectionState, DEFAULT_ICE_SERVERS } from './types';
import { SignalingService } from './SignalingService';

/**
 * PeerConnection wraps a single WebRTC connection to another player.
 *
 * It handles:
 * - RTCPeerConnection lifecycle
 * - DataChannel for game messages
 * - ICE candidate exchange
 * - Connection state monitoring
 * - Latency measurement
 */
export class PeerConnection {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private signaling: SignalingService;

  private localId: string;
  private remoteId: string;
  private remoteUsername: string;

  private _connectionState: ConnectionState = 'disconnected';
  private _latency: number = 0;
  private _lastSeen: number = 0;

  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private hasRemoteDescription: boolean = false;

  // Callbacks
  onMessage: ((message: GameMessage) => void) | null = null;
  onConnected: (() => void) | null = null;
  onDisconnected: ((reason?: string) => void) | null = null;
  onStateChange: ((state: ConnectionState) => void) | null = null;

  constructor(
    localId: string,
    remoteId: string,
    remoteUsername: string,
    signaling: SignalingService,
    iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS
  ) {
    this.localId = localId;
    this.remoteId = remoteId;
    this.remoteUsername = remoteUsername;
    this.signaling = signaling;

    // Create peer connection
    this.pc = new RTCPeerConnection({ iceServers });
    this.setupPeerConnection();
  }

  private setupPeerConnection(): void {
    // ICE candidate handling - send to remote peer via signaling
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(this.remoteId, event.candidate.toJSON());
      }
    };

    // ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log(`PeerConnection [${this.remoteId}]: ICE state: ${this.pc.iceConnectionState}`);

      switch (this.pc.iceConnectionState) {
        case 'checking':
          this.setConnectionState('connecting');
          break;
        case 'connected':
        case 'completed':
          // Connection state is set when data channel opens
          break;
        case 'disconnected':
          this.setConnectionState('reconnecting');
          break;
        case 'failed':
          this.setConnectionState('failed');
          this.onDisconnected?.('ICE connection failed');
          break;
        case 'closed':
          this.setConnectionState('disconnected');
          this.onDisconnected?.('Connection closed');
          break;
      }
    };

    // Handle incoming data channel (for non-initiators)
    this.pc.ondatachannel = (event) => {
      console.log(`PeerConnection [${this.remoteId}]: Received data channel`);
      this.setupDataChannel(event.channel);
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log(`PeerConnection [${this.remoteId}]: Connection state: ${this.pc.connectionState}`);

      if (this.pc.connectionState === 'failed') {
        this.setConnectionState('failed');
        this.onDisconnected?.('Connection failed');
      }
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log(`PeerConnection [${this.remoteId}]: DataChannel open`);
      this.setConnectionState('connected');
      this._lastSeen = Date.now();
      this.onConnected?.();
    };

    channel.onclose = () => {
      console.log(`PeerConnection [${this.remoteId}]: DataChannel closed`);
      this.setConnectionState('disconnected');
      this.onDisconnected?.('Data channel closed');
    };

    channel.onerror = (error) => {
      console.error(`PeerConnection [${this.remoteId}]: DataChannel error`, error);
    };

    channel.onmessage = (event) => {
      this._lastSeen = Date.now();

      try {
        const message = JSON.parse(event.data) as GameMessage;
        this.onMessage?.(message);

        // Handle ping/pong for latency measurement
        if (message.type === 'pong') {
          const pingData = message.data as { originalTimestamp: number };
          this._latency = Date.now() - pingData.originalTimestamp;
        }
      } catch (error) {
        console.error(`PeerConnection [${this.remoteId}]: Failed to parse message`, error);
      }
    };
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      this.onStateChange?.(state);
    }
  }

  /**
   * Create and send an SDP offer (for initiator)
   */
  async createOffer(): Promise<void> {
    console.log(`PeerConnection [${this.remoteId}]: Creating offer`);

    // Create data channel before creating offer
    const channel = this.pc.createDataChannel('game', {
      ordered: false,      // We handle ordering via tick numbers
      maxRetransmits: 2,   // Light reliability for game messages
    });
    this.setupDataChannel(channel);

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      if (this.pc.localDescription) {
        await this.signaling.sendOffer(this.remoteId, this.pc.localDescription);
      }
    } catch (error) {
      console.error(`PeerConnection [${this.remoteId}]: Failed to create offer`, error);
      this.setConnectionState('failed');
    }
  }

  /**
   * Handle incoming SDP offer (for responder)
   */
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`PeerConnection [${this.remoteId}]: Handling offer`);

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.hasRemoteDescription = true;

      // Process any pending ICE candidates
      for (const candidate of this.pendingIceCandidates) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.pendingIceCandidates = [];

      // Create and send answer
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      if (this.pc.localDescription) {
        await this.signaling.sendAnswer(this.remoteId, this.pc.localDescription);
      }
    } catch (error) {
      console.error(`PeerConnection [${this.remoteId}]: Failed to handle offer`, error);
      this.setConnectionState('failed');
    }
  }

  /**
   * Handle incoming SDP answer
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`PeerConnection [${this.remoteId}]: Handling answer`);

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.hasRemoteDescription = true;

      // Process any pending ICE candidates
      for (const candidate of this.pendingIceCandidates) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.pendingIceCandidates = [];
    } catch (error) {
      console.error(`PeerConnection [${this.remoteId}]: Failed to handle answer`, error);
      this.setConnectionState('failed');
    }
  }

  /**
   * Handle incoming ICE candidate
   */
  async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.hasRemoteDescription) {
      // Queue candidate until remote description is set
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error(`PeerConnection [${this.remoteId}]: Failed to add ICE candidate`, error);
    }
  }

  /**
   * Send a game message to this peer
   */
  send(message: GameMessage): boolean {
    if (this.dataChannel?.readyState !== 'open') {
      return false;
    }

    try {
      this.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`PeerConnection [${this.remoteId}]: Failed to send message`, error);
      return false;
    }
  }

  /**
   * Send a ping to measure latency
   */
  ping(): void {
    this.send({
      type: 'ping',
      tick: 0,
      senderId: this.localId,
      data: {},
      timestamp: Date.now(),
      sequence: 0,
    });
  }

  /**
   * Close the connection
   */
  close(): void {
    console.log(`PeerConnection [${this.remoteId}]: Closing`);

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    this.pc.close();
    this.setConnectionState('disconnected');
  }

  // Getters
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  get latency(): number {
    return this._latency;
  }

  get lastSeen(): number {
    return this._lastSeen;
  }

  get peerId(): string {
    return this.remoteId;
  }

  get peerUsername(): string {
    return this.remoteUsername;
  }

  get dataChannelState(): RTCDataChannelState | null {
    return this.dataChannel?.readyState || null;
  }
}
