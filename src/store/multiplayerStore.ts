import { create } from 'zustand';

/**
 * Multiplayer Store
 * Holds the P2P connection state for multiplayer games
 */

export interface MultiplayerState {
  // Connection state
  isMultiplayer: boolean;
  isConnected: boolean;
  isHost: boolean;

  // Peer info
  localPeerId: string | null;
  remotePeerId: string | null;

  // WebRTC objects (stored externally, referenced here)
  dataChannel: RTCDataChannel | null;

  // Message handlers
  messageHandlers: ((data: unknown) => void)[];

  // Actions
  setMultiplayer: (isMultiplayer: boolean) => void;
  setConnected: (isConnected: boolean) => void;
  setHost: (isHost: boolean) => void;
  setLocalPeerId: (id: string | null) => void;
  setRemotePeerId: (id: string | null) => void;
  setDataChannel: (channel: RTCDataChannel | null) => void;

  // Message handling
  sendMessage: (data: unknown) => void;
  addMessageHandler: (handler: (data: unknown) => void) => void;
  removeMessageHandler: (handler: (data: unknown) => void) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  isMultiplayer: false,
  isConnected: false,
  isHost: false,
  localPeerId: null,
  remotePeerId: null,
  dataChannel: null,
  messageHandlers: [],
};

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  ...initialState,

  setMultiplayer: (isMultiplayer) => set({ isMultiplayer }),
  setConnected: (isConnected) => set({ isConnected }),
  setHost: (isHost) => set({ isHost }),
  setLocalPeerId: (id) => set({ localPeerId: id }),
  setRemotePeerId: (id) => set({ remotePeerId: id }),

  setDataChannel: (channel) => {
    // Set up message handler on the channel
    if (channel) {
      channel.onmessage = (event) => {
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

      channel.onclose = () => {
        console.log('[Multiplayer] Data channel closed');
        set({ isConnected: false, dataChannel: null });
      };
    }

    set({ dataChannel: channel });
  },

  sendMessage: (data) => {
    const { dataChannel } = get();
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(data));
    } else {
      console.warn('[Multiplayer] Cannot send message: channel not open');
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

  reset: () => {
    const { dataChannel } = get();
    if (dataChannel) {
      dataChannel.close();
    }
    set(initialState);
  },
}));

// Utility functions for use outside React components
export function isMultiplayerMode(): boolean {
  return useMultiplayerStore.getState().isMultiplayer;
}

export function sendMultiplayerMessage(data: unknown): void {
  useMultiplayerStore.getState().sendMessage(data);
}

export function addMultiplayerMessageHandler(handler: (data: unknown) => void): void {
  useMultiplayerStore.getState().addMessageHandler(handler);
}

export function removeMultiplayerMessageHandler(handler: (data: unknown) => void): void {
  useMultiplayerStore.getState().removeMessageHandler(handler);
}
