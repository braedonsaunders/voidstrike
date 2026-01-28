import { create } from 'zustand';
import { debugNetworking } from '@/utils/debugLogger';

/**
 * Multiplayer Store
 * Holds the P2P connection state for multiplayer games with resilience features:
 * - Connection state tracking
 * - Command buffering during disconnects
 * - Network pause state
 * - Reconnection tracking
 * - Desync detection state
 * - Latency measurement and connection quality
 */

// Connection status for detailed state tracking
export type ConnectionStatus =
  | 'disconnected'     // Not connected
  | 'connecting'       // Initial connection in progress
  | 'connected'        // Fully connected and operational
  | 'reconnecting'     // Lost connection, attempting to reconnect
  | 'waiting'          // Waiting for remote player (they may be reconnecting)
  | 'failed';          // Connection failed permanently

// Desync state
export type DesyncState =
  | 'synced'           // Game states match
  | 'checking'         // Verifying checksums
  | 'desynced';        // Confirmed desync - game should end

// Connection quality based on latency and jitter
export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'critical';

// Latency measurement data
export interface LatencyStats {
  currentRTT: number;           // Most recent RTT in ms
  averageRTT: number;           // Exponential moving average RTT
  minRTT: number;               // Minimum observed RTT
  maxRTT: number;               // Maximum observed RTT
  jitter: number;               // RTT variance (ms)
  packetsLost: number;          // Number of pings without pong response
  packetsSent: number;          // Total pings sent
  lastPingTime: number;         // Timestamp of last ping sent
  lastPongTime: number;         // Timestamp of last pong received
}

export interface BufferedCommand {
  command: unknown;
  timestamp: number;
}

export interface MultiplayerState {
  // Connection state
  isMultiplayer: boolean;
  isConnected: boolean;
  isHost: boolean;
  connectionStatus: ConnectionStatus;

  // Network pause (game paused waiting for connection)
  isNetworkPaused: boolean;
  networkPauseReason: string | null;
  networkPauseStartTime: number | null;

  // Reconnection tracking
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  lastReconnectTime: number | null;

  // Command buffering
  commandBuffer: BufferedCommand[];
  maxBufferedCommands: number;

  // Desync state
  desyncState: DesyncState;
  desyncTick: number | null;

  // Peer info
  localPeerId: string | null;
  remotePeerId: string | null;

  // WebRTC objects
  dataChannel: RTCDataChannel | null;

  // Reconnection callback (set by lobby hook)
  reconnectCallback: (() => Promise<boolean>) | null;

  // Message handlers
  messageHandlers: ((data: unknown) => void)[];

  // Latency measurement
  latencyStats: LatencyStats;
  connectionQuality: ConnectionQuality;
  pendingPings: Map<number, number>; // pingId -> timestamp
  pingInterval: ReturnType<typeof setInterval> | null;
  pingTimeoutMs: number; // How long to wait for pong before considering lost

  // Actions
  setMultiplayer: (isMultiplayer: boolean) => void;
  setConnected: (isConnected: boolean) => void;
  setHost: (isHost: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setLocalPeerId: (id: string | null) => void;
  setRemotePeerId: (id: string | null) => void;
  setDataChannel: (channel: RTCDataChannel | null) => void;
  setReconnectCallback: (callback: (() => Promise<boolean>) | null) => void;

  // Network pause
  setNetworkPaused: (paused: boolean, reason?: string) => void;

  // Desync
  setDesyncState: (state: DesyncState, tick?: number) => void;

  // Command buffering
  bufferCommand: (command: unknown) => void;
  flushCommandBuffer: () => BufferedCommand[];
  clearCommandBuffer: () => void;

  // Message handling
  sendMessage: (data: unknown) => boolean;
  addMessageHandler: (handler: (data: unknown) => void) => void;
  removeMessageHandler: (handler: (data: unknown) => void) => void;

  // Reconnection
  attemptReconnect: () => Promise<boolean>;

  // Latency measurement
  startPingInterval: () => void;
  stopPingInterval: () => void;
  sendPing: () => void;
  handlePong: (pingId: number, timestamp: number) => void;
  updateConnectionQuality: () => void;
  getAdaptiveCommandDelay: (tickRate: number) => number;

  // Reset
  reset: () => void;
}

// Default latency stats
const defaultLatencyStats: LatencyStats = {
  currentRTT: 0,
  averageRTT: 0,
  minRTT: Infinity,
  maxRTT: 0,
  jitter: 0,
  packetsLost: 0,
  packetsSent: 0,
  lastPingTime: 0,
  lastPongTime: 0,
};

const initialState = {
  isMultiplayer: false,
  isConnected: false,
  isHost: false,
  connectionStatus: 'disconnected' as ConnectionStatus,
  isNetworkPaused: false,
  networkPauseReason: null,
  networkPauseStartTime: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 4,
  lastReconnectTime: null,
  commandBuffer: [] as BufferedCommand[],
  maxBufferedCommands: 500, // Increased for longer disconnect tolerance
  desyncState: 'synced' as DesyncState,
  desyncTick: null,
  localPeerId: null,
  remotePeerId: null,
  dataChannel: null,
  reconnectCallback: null,
  messageHandlers: [] as ((data: unknown) => void)[],
  // Latency measurement
  latencyStats: { ...defaultLatencyStats },
  connectionQuality: 'excellent' as ConnectionQuality,
  pendingPings: new Map<number, number>(),
  pingInterval: null as ReturnType<typeof setInterval> | null,
  pingTimeoutMs: 2000, // 2 seconds timeout for pong response
};

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  ...initialState,

  setMultiplayer: (isMultiplayer) => set({ isMultiplayer }),
  setConnected: (isConnected) => {
    if (isConnected) {
      set({
        isConnected: true,
        connectionStatus: 'connected',
        reconnectAttempts: 0,
      });
    } else {
      set({ isConnected: false });
    }
  },
  setHost: (isHost) => set({ isHost }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLocalPeerId: (id) => set({ localPeerId: id }),
  setRemotePeerId: (id) => set({ remotePeerId: id }),
  setReconnectCallback: (callback) => set({ reconnectCallback: callback }),

  setDataChannel: (channel) => {
    // Set up message handler on the channel
    // IMPORTANT: Use addEventListener instead of onmessage assignment to avoid
    // overwriting handlers set by other systems (like useLobby for lobby messages)
    if (channel) {
      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);

          // Handle ping/pong internally for latency measurement
          if (data.type === 'ping') {
            // Respond with pong immediately
            try {
              channel.send(JSON.stringify({
                type: 'pong',
                pingId: data.pingId,
                timestamp: data.timestamp,
              }));
            } catch (e) {
              debugNetworking.warn('[Multiplayer] Failed to send pong:', e);
            }
            return; // Don't pass to other handlers
          }

          if (data.type === 'pong') {
            // Handle pong response
            get().handlePong(data.pingId, data.timestamp);
            return; // Don't pass to other handlers
          }

          // Pass to registered handlers
          const handlers = get().messageHandlers;
          for (const handler of handlers) {
            handler(data);
          }
        } catch (e) {
          debugNetworking.error('[Multiplayer] Failed to parse message:', e);
        }
      };

      const closeHandler = () => {
        debugNetworking.log('[Multiplayer] Data channel closed');
        const currentState = get();

        // Stop ping interval on disconnect
        get().stopPingInterval();

        // Only trigger reconnection flow if we were previously connected
        if (currentState.isConnected && currentState.isMultiplayer) {
          set({
            isConnected: false,
            connectionStatus: 'reconnecting',
            isNetworkPaused: true,
            networkPauseReason: 'Connection lost. Attempting to reconnect...',
            networkPauseStartTime: Date.now(),
            dataChannel: null,
          });

          // Attempt reconnection
          get().attemptReconnect();
        } else {
          set({ isConnected: false, dataChannel: null });
        }
      };

      const errorHandler = (e: Event) => {
        debugNetworking.error('[Multiplayer] Data channel error:', e);
      };

      // Use addEventListener to not overwrite other handlers
      channel.addEventListener('message', messageHandler);
      channel.addEventListener('close', closeHandler);
      channel.addEventListener('error', errorHandler);

      // Connection restored - flush any buffered commands
      set({
        dataChannel: channel,
        isConnected: true,
        connectionStatus: 'connected',
        isNetworkPaused: false,
        networkPauseReason: null,
        networkPauseStartTime: null,
        reconnectAttempts: 0,
      });

      // Flush buffered commands
      const bufferedCommands = get().flushCommandBuffer();
      if (bufferedCommands.length > 0) {
        debugNetworking.log(`[Multiplayer] Flushing ${bufferedCommands.length} buffered commands`);
        for (const { command } of bufferedCommands) {
          get().sendMessage(command);
        }
      }

      // Start ping interval for latency measurement
      get().startPingInterval();
    } else {
      // Stopping - clean up ping interval
      get().stopPingInterval();
      set({ dataChannel: channel });
    }
  },

  setNetworkPaused: (paused, reason) => {
    if (paused) {
      set({
        isNetworkPaused: true,
        networkPauseReason: reason ?? 'Waiting for connection...',
        networkPauseStartTime: Date.now(),
      });
    } else {
      set({
        isNetworkPaused: false,
        networkPauseReason: null,
        networkPauseStartTime: null,
      });
    }
  },

  setDesyncState: (state, tick) => {
    set({
      desyncState: state,
      desyncTick: tick ?? null,
    });
  },

  bufferCommand: (command) => {
    const state = get();
    const bufferUsage = state.commandBuffer.length / state.maxBufferedCommands;

    // Early warning at 80% capacity
    if (bufferUsage >= 0.8 && bufferUsage < 1.0) {
      debugNetworking.warn(
        `[Multiplayer] WARNING: Command buffer at ${Math.round(bufferUsage * 100)}% capacity ` +
        `(${state.commandBuffer.length}/${state.maxBufferedCommands}). ` +
        `Network may be experiencing issues.`
      );
      // Trigger network pause to prevent further buildup
      if (!state.isNetworkPaused) {
        get().setNetworkPaused(true, 'Command buffer nearly full - waiting for network');
      }
    }

    if (state.commandBuffer.length >= state.maxBufferedCommands) {
      // CRITICAL: Buffer overflow means commands will be lost, causing desync
      // Instead of silently dropping, report this as a fatal error
      console.error('[Multiplayer] CRITICAL: Command buffer overflow! This will cause desync.');
      // Mark as desynced since we're about to lose commands
      set({
        desyncState: 'desynced',
        desyncTick: null, // Unknown which tick
      });
      // Still buffer the new command, dropping oldest as last resort
      const newBuffer = [...state.commandBuffer.slice(1), { command, timestamp: Date.now() }];
      set({ commandBuffer: newBuffer });
      return;
    }
    set({
      commandBuffer: [
        ...state.commandBuffer,
        { command, timestamp: Date.now() },
      ],
    });
  },

  flushCommandBuffer: () => {
    const buffer = get().commandBuffer;
    set({ commandBuffer: [] });
    return buffer;
  },

  clearCommandBuffer: () => {
    set({ commandBuffer: [] });
  },

  sendMessage: (data) => {
    const { dataChannel, isNetworkPaused, connectionStatus } = get();

    // If disconnected/reconnecting, buffer the command
    if (connectionStatus === 'reconnecting' || connectionStatus === 'waiting') {
      debugNetworking.log('[Multiplayer] Buffering command during reconnection');
      get().bufferCommand(data);
      return false;
    }

    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify(data));
        return true;
      } catch (e) {
        debugNetworking.error('[Multiplayer] Failed to send message:', e);
        // Buffer on send failure
        get().bufferCommand(data);
        return false;
      }
    } else {
      debugNetworking.warn('[Multiplayer] Cannot send message: channel not open');
      // Buffer the command
      get().bufferCommand(data);
      return false;
    }
  },

  addMessageHandler: (handler) => {
    set((state) => ({
      messageHandlers: [...state.messageHandlers, handler],
    }));
  },

  removeMessageHandler: (handler) => {
    set((state) => ({
      messageHandlers: state.messageHandlers.filter((h) => h !== handler),
    }));
  },

  attemptReconnect: async () => {
    const state = get();

    if (state.reconnectAttempts >= state.maxReconnectAttempts) {
      debugNetworking.log('[Multiplayer] Max reconnection attempts reached');
      set({
        connectionStatus: 'failed',
        isNetworkPaused: true,
        networkPauseReason: 'Connection lost. Unable to reconnect.',
      });
      return false;
    }

    const attempt = state.reconnectAttempts + 1;
    set({ reconnectAttempts: attempt });

    // Exponential backoff: 2s, 4s, 8s, 16s
    const delay = Math.pow(2, attempt) * 1000;
    debugNetworking.log(`[Multiplayer] Reconnection attempt ${attempt}/${state.maxReconnectAttempts} in ${delay}ms`);

    set({
      networkPauseReason: `Connection lost. Reconnecting (attempt ${attempt}/${state.maxReconnectAttempts})...`,
    });

    await new Promise((resolve) => setTimeout(resolve, delay));

    // Try to reconnect using the callback
    const callback = get().reconnectCallback;
    if (callback) {
      try {
        const success = await callback();
        if (success) {
          debugNetworking.log('[Multiplayer] Reconnection successful');
          return true;
        }
      } catch (e) {
        debugNetworking.error('[Multiplayer] Reconnection failed:', e);
      }
    }

    // Recurse for next attempt
    return get().attemptReconnect();
  },

  // Latency measurement - start periodic pings
  startPingInterval: () => {
    const state = get();
    // Don't start if already running
    if (state.pingInterval) return;

    debugNetworking.log('[Multiplayer] Starting ping interval');

    // Send initial ping immediately
    get().sendPing();

    // Then send pings every 1 second
    const interval = setInterval(() => {
      get().sendPing();
    }, 1000);

    set({ pingInterval: interval });
  },

  stopPingInterval: () => {
    const { pingInterval } = get();
    if (pingInterval) {
      clearInterval(pingInterval);
      set({ pingInterval: null });
    }
  },

  sendPing: () => {
    const state = get();
    if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
      return;
    }

    const pingId = Date.now();
    const now = performance.now();

    // Track pending ping
    const newPendingPings = new Map(state.pendingPings);
    newPendingPings.set(pingId, now);

    // Clean up old pending pings (older than timeout)
    const timeout = state.pingTimeoutMs;
    for (const [id, timestamp] of newPendingPings) {
      if (now - timestamp > timeout) {
        newPendingPings.delete(id);
        // Count as lost packet
        set((s) => ({
          latencyStats: {
            ...s.latencyStats,
            packetsLost: s.latencyStats.packetsLost + 1,
          },
        }));
      }
    }

    set({
      pendingPings: newPendingPings,
      latencyStats: {
        ...state.latencyStats,
        packetsSent: state.latencyStats.packetsSent + 1,
        lastPingTime: now,
      },
    });

    // Send ping message
    try {
      state.dataChannel.send(JSON.stringify({
        type: 'ping',
        pingId,
        timestamp: pingId,
      }));
    } catch (e) {
      debugNetworking.warn('[Multiplayer] Failed to send ping:', e);
    }
  },

  handlePong: (pingId: number, _timestamp: number) => {
    const state = get();
    const sentTime = state.pendingPings.get(pingId);

    if (!sentTime) {
      // Pong for unknown ping (possibly timed out)
      return;
    }

    const now = performance.now();
    const rtt = now - sentTime;

    // Remove from pending
    const newPendingPings = new Map(state.pendingPings);
    newPendingPings.delete(pingId);

    // Calculate new stats
    const stats = state.latencyStats;
    const alpha = 0.2; // EMA smoothing factor (higher = more responsive)
    const newAvgRTT = stats.averageRTT === 0
      ? rtt
      : stats.averageRTT * (1 - alpha) + rtt * alpha;

    // Calculate jitter (variance in RTT)
    const jitterAlpha = 0.1;
    const rttDiff = Math.abs(rtt - stats.averageRTT);
    const newJitter = stats.jitter * (1 - jitterAlpha) + rttDiff * jitterAlpha;

    set({
      pendingPings: newPendingPings,
      latencyStats: {
        ...stats,
        currentRTT: rtt,
        averageRTT: newAvgRTT,
        minRTT: Math.min(stats.minRTT, rtt),
        maxRTT: Math.max(stats.maxRTT, rtt),
        jitter: newJitter,
        lastPongTime: now,
      },
    });

    // Update connection quality based on new stats
    get().updateConnectionQuality();
  },

  updateConnectionQuality: () => {
    const { latencyStats } = get();
    const { averageRTT, jitter, packetsLost, packetsSent } = latencyStats;

    // Calculate packet loss percentage
    const lossRate = packetsSent > 0 ? packetsLost / packetsSent : 0;

    // Determine quality based on RTT, jitter, and packet loss
    let quality: ConnectionQuality;

    if (averageRTT < 50 && jitter < 20 && lossRate < 0.01) {
      quality = 'excellent';
    } else if (averageRTT < 100 && jitter < 40 && lossRate < 0.05) {
      quality = 'good';
    } else if (averageRTT < 200 && jitter < 80 && lossRate < 0.10) {
      quality = 'poor';
    } else {
      quality = 'critical';
    }

    set({ connectionQuality: quality });

    // Log quality changes
    const currentQuality = get().connectionQuality;
    if (currentQuality !== quality) {
      debugNetworking.log(`[Multiplayer] Connection quality: ${quality} (RTT: ${averageRTT.toFixed(1)}ms, Jitter: ${jitter.toFixed(1)}ms, Loss: ${(lossRate * 100).toFixed(1)}%)`);
    }
  },

  // Calculate adaptive command delay based on measured RTT
  getAdaptiveCommandDelay: (tickRate: number) => {
    const { latencyStats, connectionQuality } = get();
    const tickDurationMs = 1000 / tickRate;

    // Base delay on average RTT + jitter buffer
    const rttBuffer = latencyStats.averageRTT + latencyStats.jitter * 2;

    // Convert to ticks, rounding up
    let delayTicks = Math.ceil(rttBuffer / tickDurationMs);

    // Add safety margin based on connection quality
    switch (connectionQuality) {
      case 'excellent':
        delayTicks += 1;
        break;
      case 'good':
        delayTicks += 2;
        break;
      case 'poor':
        delayTicks += 3;
        break;
      case 'critical':
        delayTicks += 4;
        break;
    }

    // Clamp to reasonable bounds (2-10 ticks = 100-500ms at 20 TPS)
    const minDelay = 2;
    const maxDelay = 10;
    return Math.max(minDelay, Math.min(maxDelay, delayTicks));
  },

  reset: () => {
    const { dataChannel, pingInterval } = get();
    if (dataChannel) {
      dataChannel.close();
    }
    if (pingInterval) {
      clearInterval(pingInterval);
    }
    set({
      ...initialState,
      messageHandlers: [],
      latencyStats: { ...defaultLatencyStats },
      pendingPings: new Map(),
    });
  },
}));

// Utility functions for use outside React components
export function isMultiplayerMode(): boolean {
  return useMultiplayerStore.getState().isMultiplayer;
}

export function isNetworkPaused(): boolean {
  return useMultiplayerStore.getState().isNetworkPaused;
}

export function getConnectionStatus(): ConnectionStatus {
  return useMultiplayerStore.getState().connectionStatus;
}

export function getDesyncState(): DesyncState {
  return useMultiplayerStore.getState().desyncState;
}

export function sendMultiplayerMessage(data: unknown): boolean {
  return useMultiplayerStore.getState().sendMessage(data);
}

export function addMultiplayerMessageHandler(handler: (data: unknown) => void): void {
  useMultiplayerStore.getState().addMessageHandler(handler);
}

export function removeMultiplayerMessageHandler(handler: (data: unknown) => void): void {
  useMultiplayerStore.getState().removeMessageHandler(handler);
}

// Trigger network pause from game code
export function triggerNetworkPause(reason: string): void {
  useMultiplayerStore.getState().setNetworkPaused(true, reason);
}

// Resume from network pause
export function resumeFromNetworkPause(): void {
  useMultiplayerStore.getState().setNetworkPaused(false);
}

// Report desync
export function reportDesync(tick: number): void {
  useMultiplayerStore.getState().setDesyncState('desynced', tick);
}

// Get latency stats
export function getLatencyStats(): LatencyStats {
  return useMultiplayerStore.getState().latencyStats;
}

// Get connection quality
export function getConnectionQuality(): ConnectionQuality {
  return useMultiplayerStore.getState().connectionQuality;
}

// Get adaptive command delay based on current latency
export function getAdaptiveCommandDelay(tickRate: number): number {
  return useMultiplayerStore.getState().getAdaptiveCommandDelay(tickRate);
}

// Start latency measurement
export function startLatencyMeasurement(): void {
  useMultiplayerStore.getState().startPingInterval();
}

// Stop latency measurement
export function stopLatencyMeasurement(): void {
  useMultiplayerStore.getState().stopPingInterval();
}
