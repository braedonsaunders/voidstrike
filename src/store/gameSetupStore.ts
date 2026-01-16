import { create } from 'zustand';
import { debugInitialization } from '@/utils/debugLogger';

export type StartingResources = 'normal' | 'high' | 'insane';
export type GameSpeed = 'slower' | 'normal' | 'faster' | 'fastest';
export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'insane';
export type PlayerType = 'human' | 'ai' | 'remote' | 'open' | 'closed';

// Team configuration: 0 = Free For All, 1-4 = team numbers
export type TeamNumber = 0 | 1 | 2 | 3 | 4;

// Remote connection state for multiplayer
export type RemoteConnectionState = 'disconnected' | 'hosting' | 'joining' | 'connecting' | 'connected';

// Player slot configuration
export interface PlayerSlot {
  id: string; // player1, player2, etc.
  type: PlayerType;
  faction: string;
  colorId: string;
  aiDifficulty: AIDifficulty;
  name: string;
  team: TeamNumber; // 0 = FFA, 1-4 = team
  // Remote player fields
  remoteState?: RemoteConnectionState;
  gameCode?: string; // Short code for joining (e.g., "ABCD")
}

export interface GameSetupState {
  // Map selection
  selectedMapId: string;

  // Game settings
  startingResources: StartingResources;
  gameSpeed: GameSpeed;
  fogOfWar: boolean;

  // Player slots (max 8 players)
  playerSlots: PlayerSlot[];

  // Local player ID - the player controlled by this client (null if spectating)
  localPlayerId: string | null;

  // Game session flag - must be true to enter /game
  gameStarted: boolean;

  // Battle Simulator mode - sandbox for spawning units
  isBattleSimulator: boolean;

  // Actions
  setSelectedMap: (mapId: string) => void;
  setStartingResources: (resources: StartingResources) => void;
  setGameSpeed: (speed: GameSpeed) => void;
  setFogOfWar: (enabled: boolean) => void;

  // Player slot actions
  setPlayerSlotType: (slotId: string, type: PlayerType) => void;
  setPlayerSlotFaction: (slotId: string, faction: string) => void;
  setPlayerSlotColor: (slotId: string, colorId: string) => void;
  setPlayerSlotAIDifficulty: (slotId: string, difficulty: AIDifficulty) => void;
  setPlayerSlotName: (slotId: string, name: string) => void;
  setPlayerSlotTeam: (slotId: string, team: TeamNumber) => void;
  addPlayerSlot: () => void;
  removePlayerSlot: (slotId: string) => void;

  // Get player color hex by player ID
  getPlayerColorHex: (playerId: string) => number;

  // Player type helpers
  isHumanPlayer: (playerId: string) => boolean;
  isAIPlayer: (playerId: string) => boolean;
  getLocalPlayerId: () => string | null;
  getAIPlayerIds: () => string[];
  getHumanPlayerIds: () => string[];

  startGame: () => void;
  startBattleSimulator: () => void;
  endGame: () => void;
  reset: () => void;

  // Check if current session is spectator mode (no human players or local player is not set)
  isSpectator: () => boolean;

  // Get the slot number (1-8) for the local player (for spawn point selection)
  getLocalPlayerSlot: () => number;

  // Enable spectator mode (used when player is defeated but wants to continue watching)
  enableSpectatorMode: () => void;
}

export const STARTING_RESOURCES_VALUES: Record<StartingResources, { minerals: number; vespene: number }> = {
  normal: { minerals: 50, vespene: 0 },
  high: { minerals: 500, vespene: 200 },
  insane: { minerals: 10000, vespene: 5000 },
};

export const GAME_SPEED_VALUES: Record<GameSpeed, number> = {
  slower: 0.5,
  normal: 1.0,
  faster: 1.5,
  fastest: 2.0,
};

// Available player colors
export const PLAYER_COLORS = [
  { id: 'blue', name: 'Blue', hex: 0x40a0ff },
  { id: 'red', name: 'Red', hex: 0xff4040 },
  { id: 'green', name: 'Green', hex: 0x40ff40 },
  { id: 'yellow', name: 'Yellow', hex: 0xffff40 },
  { id: 'purple', name: 'Purple', hex: 0xa040ff },
  { id: 'orange', name: 'Orange', hex: 0xff8000 },
  { id: 'cyan', name: 'Cyan', hex: 0x40ffff },
  { id: 'pink', name: 'Pink', hex: 0xff80c0 },
];

// Get color hex by color ID
export function getColorHex(colorId: string): number {
  const color = PLAYER_COLORS.find(c => c.id === colorId);
  return color?.hex ?? 0x808080;
}

// Team colors for display
export const TEAM_COLORS: Record<TeamNumber, { name: string; color: string }> = {
  0: { name: 'FFA', color: '#888888' },
  1: { name: 'Team 1', color: '#4080ff' },
  2: { name: 'Team 2', color: '#ff4040' },
  3: { name: 'Team 3', color: '#40ff40' },
  4: { name: 'Team 4', color: '#ffff40' },
};

// Default player slots (player 1 human, player 2 AI)
const defaultPlayerSlots: PlayerSlot[] = [
  {
    id: 'player1',
    type: 'human',
    faction: 'dominion',
    colorId: 'blue',
    aiDifficulty: 'medium',
    name: 'Player 1',
    team: 0, // FFA by default
  },
  {
    id: 'player2',
    type: 'ai',
    faction: 'dominion',
    colorId: 'red',
    aiDifficulty: 'medium',
    name: 'Player 2',
    team: 0, // FFA by default
  },
];

const initialState = {
  selectedMapId: 'crystal_caverns',
  startingResources: 'normal' as StartingResources,
  gameSpeed: 'normal' as GameSpeed,
  fogOfWar: true,
  playerSlots: [...defaultPlayerSlots],
  localPlayerId: 'player1' as string | null, // Default to player1, updated when game starts
  gameStarted: false,
  isBattleSimulator: false,
};

export const useGameSetupStore = create<GameSetupState>((set, get) => ({
  ...initialState,

  setSelectedMap: (mapId) => set({ selectedMapId: mapId }),
  setStartingResources: (resources) => set({ startingResources: resources }),
  setGameSpeed: (speed) => set({ gameSpeed: speed }),
  setFogOfWar: (enabled) => set({ fogOfWar: enabled }),

  setPlayerSlotType: (slotId, type) => set((state) => ({
    playerSlots: state.playerSlots.map(slot =>
      slot.id === slotId ? { ...slot, type } : slot
    ),
  })),

  setPlayerSlotFaction: (slotId, faction) => set((state) => ({
    playerSlots: state.playerSlots.map(slot =>
      slot.id === slotId ? { ...slot, faction } : slot
    ),
  })),

  setPlayerSlotColor: (slotId, colorId) => set((state) => {
    // Check if color is already in use by another player
    const currentSlot = state.playerSlots.find(s => s.id === slotId);
    const otherSlot = state.playerSlots.find(s => s.id !== slotId && s.colorId === colorId);

    if (otherSlot && currentSlot) {
      // Swap colors between the two slots to maintain uniqueness
      return {
        playerSlots: state.playerSlots.map(slot => {
          if (slot.id === slotId) return { ...slot, colorId };
          if (slot.id === otherSlot.id) return { ...slot, colorId: currentSlot.colorId };
          return slot;
        }),
      };
    }

    // No conflict, just set the color
    return {
      playerSlots: state.playerSlots.map(slot =>
        slot.id === slotId ? { ...slot, colorId } : slot
      ),
    };
  }),

  setPlayerSlotAIDifficulty: (slotId, difficulty) => set((state) => ({
    playerSlots: state.playerSlots.map(slot =>
      slot.id === slotId ? { ...slot, aiDifficulty: difficulty } : slot
    ),
  })),

  setPlayerSlotName: (slotId, name) => set((state) => ({
    playerSlots: state.playerSlots.map(slot =>
      slot.id === slotId ? { ...slot, name } : slot
    ),
  })),

  setPlayerSlotTeam: (slotId, team) => set((state) => ({
    playerSlots: state.playerSlots.map(slot =>
      slot.id === slotId ? { ...slot, team } : slot
    ),
  })),

  addPlayerSlot: () => set((state) => {
    if (state.playerSlots.length >= 8) return state;

    // Find used colors and IDs
    const usedColors = new Set(state.playerSlots.map(s => s.colorId));
    const usedIds = new Set(state.playerSlots.map(s => s.id));

    // Find next available color
    const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c.id))?.id ?? 'blue';

    // Find next available player number (1-8)
    let playerNumber = 1;
    while (usedIds.has(`player${playerNumber}`) && playerNumber <= 8) {
      playerNumber++;
    }

    const newSlot: PlayerSlot = {
      id: `player${playerNumber}`,
      type: 'ai',
      faction: 'dominion',
      colorId: availableColor,
      aiDifficulty: 'medium',
      name: `Player ${playerNumber}`,
      team: 0, // FFA by default
    };

    return { playerSlots: [...state.playerSlots, newSlot] };
  }),

  removePlayerSlot: (slotId) => set((state) => ({
    playerSlots: state.playerSlots.filter(slot => slot.id !== slotId),
  })),

  getPlayerColorHex: (playerId: string): number => {
    const slot = get().playerSlots.find(s => s.id === playerId);
    if (slot) {
      return getColorHex(slot.colorId);
    }
    // Fallback for legacy 'ai' player ID
    if (playerId === 'ai') {
      const aiSlot = get().playerSlots.find(s => s.type === 'ai');
      if (aiSlot) {
        return getColorHex(aiSlot.colorId);
      }
    }
    return 0x808080; // Default gray
  },

  // Player type helpers
  isHumanPlayer: (playerId: string): boolean => {
    const slot = get().playerSlots.find(s => s.id === playerId);
    // Both 'human' and 'remote' are human players
    return slot?.type === 'human' || slot?.type === 'remote';
  },

  isAIPlayer: (playerId: string): boolean => {
    const slot = get().playerSlots.find(s => s.id === playerId);
    return slot?.type === 'ai';
  },

  getLocalPlayerId: (): string | null => {
    return get().localPlayerId;
  },

  getAIPlayerIds: (): string[] => {
    const aiIds = get().playerSlots.filter(s => s.type === 'ai').map(s => s.id);
    debugInitialization.log(`[gameSetupStore] getAIPlayerIds called, returning: ${aiIds.join(', ')}`);
    return aiIds;
  },

  getHumanPlayerIds: (): string[] => {
    // Include both local humans and remote humans
    return get().playerSlots.filter(s => s.type === 'human' || s.type === 'remote').map(s => s.id);
  },

  startGame: () => {
    const state = get();
    // Find the first human player to be the local player, or null if spectating
    const firstHumanSlot = state.playerSlots.find(s => s.type === 'human');
    set({
      gameStarted: true,
      localPlayerId: firstHumanSlot?.id ?? null,
    });
  },
  startBattleSimulator: () => {
    set({
      gameStarted: true,
      isBattleSimulator: true,
      fogOfWar: false,
      localPlayerId: 'player1',
      selectedMapId: 'battle_arena', // Use simple arena map
      // Set up two empty teams for simulator
      playerSlots: [
        { id: 'player1', type: 'human', faction: 'dominion', colorId: 'blue', aiDifficulty: 'medium', name: 'Team 1', team: 1 },
        { id: 'player2', type: 'human', faction: 'dominion', colorId: 'red', aiDifficulty: 'medium', name: 'Team 2', team: 2 },
      ],
    });
  },
  endGame: () => set({ gameStarted: false, isBattleSimulator: false }),
  reset: () => set({ ...initialState, playerSlots: [...defaultPlayerSlots], localPlayerId: 'player1' }),

  isSpectator: (): boolean => {
    // Check if there's no local player (all players are AI)
    const state = get();
    return state.localPlayerId === null || !state.playerSlots.some(s => s.type === 'human');
  },

  getLocalPlayerSlot: (): number => {
    const state = get();
    if (!state.localPlayerId) return 1; // Default to slot 1 if spectating
    // Extract slot number from player ID (e.g., 'player1' -> 1, 'player2' -> 2)
    const match = state.localPlayerId.match(/player(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  },

  enableSpectatorMode: (): void => {
    set({ localPlayerId: null });
    debugInitialization.log('[gameSetupStore] Spectator mode enabled - player can now spectate the game');
  },
}));

// Export a function to get player color that can be used outside React
export function getPlayerColor(playerId: string): number {
  return useGameSetupStore.getState().getPlayerColorHex(playerId);
}

// Export utility functions for use outside React components
export function getLocalPlayerId(): string | null {
  return useGameSetupStore.getState().localPlayerId;
}

export function isLocalPlayer(playerId: string): boolean {
  return useGameSetupStore.getState().localPlayerId === playerId;
}

export function isHumanPlayer(playerId: string): boolean {
  return useGameSetupStore.getState().isHumanPlayer(playerId);
}

export function isAIPlayer(playerId: string): boolean {
  return useGameSetupStore.getState().isAIPlayer(playerId);
}

export function getAIPlayerIds(): string[] {
  return useGameSetupStore.getState().getAIPlayerIds();
}

export function isSpectatorMode(): boolean {
  return useGameSetupStore.getState().isSpectator();
}

export function isBattleSimulatorMode(): boolean {
  return useGameSetupStore.getState().isBattleSimulator;
}

export function enableSpectatorMode(): void {
  useGameSetupStore.getState().enableSpectatorMode();
}

/**
 * Returns true if there are multiple human players (true multiplayer mode).
 * Used to disable debug features in competitive play.
 */
export function isMultiplayerMode(): boolean {
  const humanPlayerIds = useGameSetupStore.getState().getHumanPlayerIds();
  return humanPlayerIds.length > 1;
}
