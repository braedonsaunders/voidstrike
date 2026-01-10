'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  Lobby,
  LobbyPlayer,
  LobbySettings,
} from '@/engine/network/types';
import {
  createLobby,
  getLobbyByCode,
  getLobbyById,
  joinLobby,
  leaveLobby,
  updateLobbyPlayer,
  updateLobbySettings,
  updateLobbyStatus,
  areAllPlayersReady,
  subscribeLobby,
  unsubscribeLobby,
} from '@/services/lobbyService';
import { isMultiplayerEnabled } from '@/lib/supabase';

export interface UseLobbyState {
  lobby: Lobby | null;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  isHost: boolean;
  localPlayer: LobbyPlayer | null;
  canStart: boolean;
}

export interface UseLobbyActions {
  create: (
    hostId: string,
    hostUsername: string,
    hostElo: number,
    settings?: Partial<LobbySettings>,
    isPrivate?: boolean
  ) => Promise<Lobby | null>;
  join: (
    code: string,
    playerId: string,
    playerUsername: string,
    playerElo: number
  ) => Promise<Lobby | null>;
  joinById: (
    lobbyId: string,
    playerId: string,
    playerUsername: string,
    playerElo: number
  ) => Promise<Lobby | null>;
  leave: () => Promise<void>;
  updatePlayer: (updates: Partial<Pick<LobbyPlayer, 'faction' | 'color' | 'team' | 'isReady'>>) => Promise<void>;
  updateSettings: (settings: Partial<LobbySettings>) => Promise<void>;
  toggleReady: () => Promise<void>;
  startGame: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useLobby(playerId: string | null): UseLobbyState & UseLobbyActions {
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);

  // Derived state
  const localPlayer = lobby?.players.find(p => p.id === playerId) || null;
  const isHost = lobby?.hostId === playerId;
  const canStart = lobby ? areAllPlayersReady(lobby) && isHost : false;

  // Subscribe to lobby updates
  const subscribeToLobby = useCallback((lobbyId: string) => {
    // Unsubscribe from previous
    if (channelRef.current) {
      unsubscribeLobby(channelRef.current);
    }

    // Subscribe to new lobby
    channelRef.current = subscribeLobby(
      lobbyId,
      (updatedLobby) => {
        setLobby(updatedLobby);
      },
      () => {
        // Lobby deleted
        setLobby(null);
        setIsConnected(false);
        setError('Lobby was closed');
      }
    );

    if (channelRef.current) {
      setIsConnected(true);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        unsubscribeLobby(channelRef.current);
      }
    };
  }, []);

  // Create a new lobby
  const create = useCallback(async (
    hostId: string,
    hostUsername: string,
    hostElo: number,
    settings?: Partial<LobbySettings>,
    isPrivate?: boolean
  ): Promise<Lobby | null> => {
    if (!isMultiplayerEnabled()) {
      setError('Multiplayer not enabled');
      return null;
    }

    setIsLoading(true);
    setError(null);

    const { lobby: newLobby, error: createError } = await createLobby(
      hostId,
      hostUsername,
      hostElo,
      settings,
      isPrivate
    );

    setIsLoading(false);

    if (createError) {
      setError(createError.message);
      return null;
    }

    if (newLobby) {
      setLobby(newLobby);
      subscribeToLobby(newLobby.id);
    }

    return newLobby;
  }, [subscribeToLobby]);

  // Join lobby by code
  const join = useCallback(async (
    code: string,
    joinPlayerId: string,
    playerUsername: string,
    playerElo: number
  ): Promise<Lobby | null> => {
    if (!isMultiplayerEnabled()) {
      setError('Multiplayer not enabled');
      return null;
    }

    setIsLoading(true);
    setError(null);

    // First, find the lobby by code
    const { lobby: existingLobby, error: findError } = await getLobbyByCode(code);

    if (findError || !existingLobby) {
      setIsLoading(false);
      setError(findError?.message || 'Lobby not found');
      return null;
    }

    // Then join it
    const { lobby: joinedLobby, error: joinError } = await joinLobby(
      existingLobby.id,
      joinPlayerId,
      playerUsername,
      playerElo
    );

    setIsLoading(false);

    if (joinError) {
      setError(joinError.message);
      return null;
    }

    if (joinedLobby) {
      setLobby(joinedLobby);
      subscribeToLobby(joinedLobby.id);
    }

    return joinedLobby;
  }, [subscribeToLobby]);

  // Join lobby by ID
  const joinById = useCallback(async (
    lobbyId: string,
    joinPlayerId: string,
    playerUsername: string,
    playerElo: number
  ): Promise<Lobby | null> => {
    if (!isMultiplayerEnabled()) {
      setError('Multiplayer not enabled');
      return null;
    }

    setIsLoading(true);
    setError(null);

    const { lobby: joinedLobby, error: joinError } = await joinLobby(
      lobbyId,
      joinPlayerId,
      playerUsername,
      playerElo
    );

    setIsLoading(false);

    if (joinError) {
      setError(joinError.message);
      return null;
    }

    if (joinedLobby) {
      setLobby(joinedLobby);
      subscribeToLobby(joinedLobby.id);
    }

    return joinedLobby;
  }, [subscribeToLobby]);

  // Leave current lobby
  const leave = useCallback(async (): Promise<void> => {
    if (!lobby || !playerId) return;

    setIsLoading(true);

    const { error: leaveError } = await leaveLobby(lobby.id, playerId);

    if (channelRef.current) {
      unsubscribeLobby(channelRef.current);
      channelRef.current = null;
    }

    setLobby(null);
    setIsConnected(false);
    setIsLoading(false);

    if (leaveError) {
      setError(leaveError.message);
    }
  }, [lobby, playerId]);

  // Update local player
  const updatePlayer = useCallback(async (
    updates: Partial<Pick<LobbyPlayer, 'faction' | 'color' | 'team' | 'isReady'>>
  ): Promise<void> => {
    if (!lobby || !playerId) return;

    const { error: updateError } = await updateLobbyPlayer(lobby.id, playerId, updates);

    if (updateError) {
      setError(updateError.message);
    }
  }, [lobby, playerId]);

  // Update lobby settings (host only)
  const updateSettings = useCallback(async (
    settings: Partial<LobbySettings>
  ): Promise<void> => {
    if (!lobby || !playerId || !isHost) return;

    const { error: updateError } = await updateLobbySettings(lobby.id, playerId, settings);

    if (updateError) {
      setError(updateError.message);
    }
  }, [lobby, playerId, isHost]);

  // Toggle ready status
  const toggleReady = useCallback(async (): Promise<void> => {
    if (!localPlayer) return;
    await updatePlayer({ isReady: !localPlayer.isReady });
  }, [localPlayer, updatePlayer]);

  // Start the game (host only)
  const startGame = useCallback(async (): Promise<void> => {
    if (!lobby || !isHost || !canStart) return;

    // Update status to signaling - this triggers WebRTC setup
    const { error: statusError } = await updateLobbyStatus(lobby.id, 'signaling');

    if (statusError) {
      setError(statusError.message);
    }
  }, [lobby, isHost, canStart]);

  // Refresh lobby state
  const refresh = useCallback(async (): Promise<void> => {
    if (!lobby) return;

    setIsLoading(true);
    const { lobby: refreshedLobby, error: refreshError } = await getLobbyById(lobby.id);
    setIsLoading(false);

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    if (refreshedLobby) {
      setLobby(refreshedLobby);
    }
  }, [lobby]);

  return {
    // State
    lobby,
    isLoading,
    error,
    isConnected,
    isHost,
    localPlayer,
    canStart,
    // Actions
    create,
    join,
    joinById,
    leave,
    updatePlayer,
    updateSettings,
    toggleReady,
    startGame,
    refresh,
  };
}

// Hook for lobby browser (list of public lobbies)
export function useLobbyBrowser() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!isMultiplayerEnabled()) {
      setIsLoading(false);
      return;
    }

    // Import dynamically to avoid circular deps
    import('@/services/lobbyService').then(({ subscribePublicLobbies, unsubscribeLobby }) => {
      channelRef.current = subscribePublicLobbies((updatedLobbies) => {
        setLobbies(updatedLobbies);
        setIsLoading(false);
      });
    });

    return () => {
      if (channelRef.current) {
        import('@/services/lobbyService').then(({ unsubscribeLobby }) => {
          if (channelRef.current) {
            unsubscribeLobby(channelRef.current);
          }
        });
      }
    };
  }, []);

  return {
    lobbies,
    isLoading,
    error,
  };
}

export type UseLobbyReturn = ReturnType<typeof useLobby>;
export type UseLobbyBrowserReturn = ReturnType<typeof useLobbyBrowser>;
