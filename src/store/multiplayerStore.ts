import { create } from 'zustand';

/**
 * Multiplayer Store
 * Holds the P2P connection state for multiplayer games with resilience features:
 * - Connection state tracking
 * - Command buffering during disconnects
 * - Network pause state
 * - Reconnection tracking
 * - Desync detection state
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

  // Reset
  reset: () => void;
}

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
  maxBufferedCommands: 100,
  desyncState: 'synced' as DesyncState,
  desyncTick: null,
  localPeerId: null,
  remotePeerId: null,
  dataChannel: null,
  reconnectCallback: null,
  messageHandlers: [] as ((data: unknown) => void)[],
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
          const handlers = get().messageHandlers;
          for (const handler of handlers) {
            handler(data);
          }
        } catch (e) {
          console.error('[Multiplayer] Failed to parse message:', e);
        }
      };

      const closeHandler = () => {
        console.log('[Multiplayer] Data channel closed');
        const currentState = get();

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
        console.error('[Multiplayer] Data channel error:', e);
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
        console.log(`[Multiplayer] Flushing ${bufferedCommands.length} buffered commands`);
        for (const { command } of bufferedCommands) {
          get().sendMessage(command);
        }
      }
    } else {
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
    if (state.commandBuffer.length >= state.maxBufferedCommands) {
      console.warn('[Multiplayer] Command buffer full, dropping oldest command');
      state.commandBuffer.shift();
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
      console.log('[Multiplayer] Buffering command during reconnection');
      get().bufferCommand(data);
      return false;
    }

    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify(data));
        return true;
      } catch (e) {
        console.error('[Multiplayer] Failed to send message:', e);
        // Buffer on send failure
        get().bufferCommand(data);
        return false;
      }
    } else {
      console.warn('[Multiplayer] Cannot send message: channel not open');
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
      console.log('[Multiplayer] Max reconnection attempts reached');
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
    console.log(`[Multiplayer] Reconnection attempt ${attempt}/${state.maxReconnectAttempts} in ${delay}ms`);

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
          console.log('[Multiplayer] Reconnection successful');
          return true;
        }
      } catch (e) {
        console.error('[Multiplayer] Reconnection failed:', e);
      }
    }

    // Recurse for next attempt
    return get().attemptReconnect();
  },

  reset: () => {
    const { dataChannel } = get();
    if (dataChannel) {
      dataChannel.close();
    }
    set({ ...initialState, messageHandlers: [] });
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
