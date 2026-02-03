'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLobby, LobbyState } from '@/hooks/useMultiplayer';
import { useMultiplayerStore } from '@/store/multiplayerStore';
import { useGameSetupStore, PlayerSlot, StartingResources, GameSpeed } from '@/store/gameSetupStore';
import { ALL_MAPS } from '@/data/maps';
import { Game } from '@/engine/core/Game';
import { debugInitialization } from '@/utils/debugLogger';

export interface UseLobbyOptions {
  playerName: string;
  isPublicLobby: boolean;
}

export interface LobbySyncState {
  // Display values - resolved based on guest vs host mode
  displayPlayerSlots: PlayerSlot[];
  displayMapId: string;
  displayStartingResources: StartingResources;
  displayGameSpeed: GameSpeed;
  displayFogOfWar: boolean;
  displayActivePlayerCount: number;

  // Mode flags
  isGuestMode: boolean;
  isHost: boolean;

  // Lobby status
  lobbyStatus: string;
  lobbyCode: string | null;
  lobbyError: string | null;

  // Guest management
  guests: { pubkey: string; name: string; slotId: string }[];
  hasOpenSlot: boolean;
  hasGuests: boolean;
  guestSlotCount: number;
  connectedGuestCount: number;
  mySlotId: string | null;

  // Actions
  joinLobby: (code: string, playerName: string) => Promise<void>;
  leaveLobby: () => void;
  kickGuest: (pubkey: string) => void;
  sendGameStart: () => number;
  publishPublicListing: (data: {
    hostName: string;
    mapName: string;
    mapId: string;
    currentPlayers: number;
    maxPlayers: number;
    gameMode: string;
  }) => Promise<boolean>;
}

/**
 * Hook to manage lobby synchronization between host and guests.
 * Handles multiplayer store setup, lobby state syncing, and game start coordination.
 */
export function useLobbySync({ playerName, isPublicLobby }: UseLobbyOptions): LobbySyncState {
  const router = useRouter();

  // Game setup store
  const {
    selectedMapId,
    startingResources,
    gameSpeed,
    fogOfWar,
    playerSlots,
    fillOpenSlotWithGuest,
    removeGuest,
    startGame,
  } = useGameSetupStore();

  // Lobby hook callbacks
  const handleGuestJoin = useCallback((guestName: string) => {
    return fillOpenSlotWithGuest(guestName);
  }, [fillOpenSlotWithGuest]);

  const handleGuestLeave = useCallback((slotId: string) => {
    removeGuest(slotId);
  }, [removeGuest]);

  // Only enable Nostr when multiplayer is needed
  const needsMultiplayer = playerSlots.some(s => s.type === 'open') || isPublicLobby;

  const {
    status: lobbyStatus,
    lobbyCode,
    error: lobbyError,
    guests,
    hostConnection,
    isHost,
    receivedLobbyState,
    mySlotId,
    joinLobby,
    leaveLobby,
    kickGuest,
    sendLobbyState,
    sendGameStart,
    onGameStart,
    connectedGuestCount,
    publishPublicListing,
  } = useLobby({
    enabled: needsMultiplayer,
    onGuestJoin: handleGuestJoin,
    onGuestLeave: handleGuestLeave,
  });

  // Multiplayer store
  const {
    setMultiplayer,
    setConnected,
    setHost,
  } = useMultiplayerStore();

  // Derived state
  const hasOpenSlot = playerSlots.some(s => s.type === 'open');
  const hasGuests = guests.length > 0;
  const guestSlotCount = playerSlots.filter(s => s.isGuest).length;
  const isGuestMode = lobbyStatus === 'connected' && !isHost;

  // When connected as guest, set up multiplayer store
  // Note: Data channel is set up via addPeer() in useMultiplayer.ts
  useEffect(() => {
    if (lobbyStatus === 'connected' && hostConnection) {
      setMultiplayer(true);
      setConnected(true);
      setHost(false);
    }
  }, [lobbyStatus, hostConnection, setMultiplayer, setConnected, setHost]);

  // When hosting with connected guests, set up multiplayer
  // Note: Data channels are set up via addPeer() in useMultiplayer.ts
  useEffect(() => {
    if (isHost && guests.some(g => g.dataChannel)) {
      setMultiplayer(true);
      setConnected(true);
      setHost(true);
    }
  }, [isHost, guests, setMultiplayer, setConnected, setHost]);

  // Send lobby state to guests whenever it changes (host only)
  useEffect(() => {
    if (!isHost) return;
    const hasConnectedGuests = guests.some(g => g.dataChannel?.readyState === 'open');
    if (!hasConnectedGuests) return;

    const lobbyState: LobbyState = {
      playerSlots,
      selectedMapId,
      startingResources,
      gameSpeed,
      fogOfWar,
    };

    sendLobbyState(lobbyState);
  }, [isHost, guests, playerSlots, selectedMapId, startingResources, gameSpeed, fogOfWar, sendLobbyState]);

  // Publish public lobby listing when checkbox is enabled (host only)
  useEffect(() => {
    if (!isHost || !isPublicLobby || lobbyStatus !== 'hosting' || !lobbyCode) return;

    const publish = () => {
      const map = ALL_MAPS[selectedMapId];
      if (!map) return;

      const openSlots = playerSlots.filter(s => s.type === 'open').length;
      const activeSlots = playerSlots.filter(s => s.type === 'human' || s.type === 'ai').length;

      publishPublicListing({
        hostName: playerName || 'Unknown Host',
        mapName: map.name,
        mapId: selectedMapId,
        currentPlayers: activeSlots,
        maxPlayers: map.maxPlayers - openSlots + activeSlots,
        gameMode: 'standard',
      });
    };

    // Publish immediately
    publish();

    // Republish every 60 seconds to keep listing fresh
    const interval = setInterval(publish, 60000);

    return () => clearInterval(interval);
  }, [isHost, isPublicLobby, lobbyStatus, lobbyCode, playerSlots, playerName, selectedMapId, publishPublicListing]);

  // Register game start callback (guest only)
  useEffect(() => {
    if (isHost) return;

    onGameStart(() => {
      debugInitialization.log('[Setup] Game start received, navigating to game...');
      debugInitialization.log('[Setup] Guest slot ID:', mySlotId);

      // Reset any existing game instance
      Game.resetInstance();

      // Apply the received lobby state to the store before starting
      if (receivedLobbyState) {
        const store = useGameSetupStore.getState();
        store.setSelectedMap(receivedLobbyState.selectedMapId);
        store.setStartingResources(receivedLobbyState.startingResources);
        store.setGameSpeed(receivedLobbyState.gameSpeed);
        store.setFogOfWar(receivedLobbyState.fogOfWar);
        useGameSetupStore.setState({ playerSlots: receivedLobbyState.playerSlots });
      }

      startGame(mySlotId ?? undefined);
      router.push('/game');
    });
  }, [isHost, onGameStart, receivedLobbyState, mySlotId, startGame, router]);


  // Compute display values based on mode
  const displayPlayerSlots = isGuestMode && receivedLobbyState ? receivedLobbyState.playerSlots : playerSlots;
  const displayMapId = isGuestMode && receivedLobbyState ? receivedLobbyState.selectedMapId : selectedMapId;
  const displayStartingResources = isGuestMode && receivedLobbyState ? receivedLobbyState.startingResources : startingResources;
  const displayGameSpeed = isGuestMode && receivedLobbyState ? receivedLobbyState.gameSpeed : gameSpeed;
  const displayFogOfWar = isGuestMode && receivedLobbyState ? receivedLobbyState.fogOfWar : fogOfWar;
  const displayActivePlayerCount = displayPlayerSlots.filter(s => s.type === 'human' || s.type === 'ai').length;

  return {
    displayPlayerSlots,
    displayMapId,
    displayStartingResources,
    displayGameSpeed,
    displayFogOfWar,
    displayActivePlayerCount,

    isGuestMode,
    isHost,

    lobbyStatus,
    lobbyCode,
    lobbyError,

    guests: guests.map(g => ({ pubkey: g.pubkey, name: g.name, slotId: g.slotId })),
    hasOpenSlot,
    hasGuests,
    guestSlotCount,
    connectedGuestCount,
    mySlotId,

    joinLobby,
    leaveLobby,
    kickGuest,
    sendGameStart,
    publishPublicListing,
  };
}
