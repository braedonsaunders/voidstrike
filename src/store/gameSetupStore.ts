import { create } from 'zustand';

export type StartingResources = 'normal' | 'high' | 'insane';
export type GameSpeed = 'slower' | 'normal' | 'faster' | 'fastest';
export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'insane';
export type PlayerType = 'human' | 'ai' | 'open' | 'closed';

// Team configuration: 0 = Free For All, 1-4 = team numbers
export type TeamNumber = 0 | 1 | 2 | 3 | 4;

// Player slot configuration
export interface PlayerSlot {
  id: string; // player1, player2, etc.
  type: PlayerType;
  faction: string;
  colorId: string;
  aiDifficulty: AIDifficulty;
  name: string;
  team: TeamNumber; // 0 = FFA, 1-4 = team
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

  // Game session flag - must be true to enter /game
  gameStarted: boolean;

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

  startGame: () => void;
  endGame: () => void;
  reset: () => void;

  // Check if current session is spectator mode (no human players)
  isSpectator: () => boolean;
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
    name: 'AI Player',
    team: 0, // FFA by default
  },
];

const initialState = {
  selectedMapId: 'training_grounds',
  startingResources: 'normal' as StartingResources,
  gameSpeed: 'normal' as GameSpeed,
  fogOfWar: true,
  playerSlots: [...defaultPlayerSlots],
  gameStarted: false,
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

  startGame: () => set({ gameStarted: true }),
  endGame: () => set({ gameStarted: false }),
  reset: () => set({ ...initialState, playerSlots: [...defaultPlayerSlots] }),

  isSpectator: (): boolean => {
    // Check if player1 slot is not human - this means we're spectating
    const player1Slot = get().playerSlots.find(s => s.id === 'player1');
    return player1Slot?.type !== 'human';
  },
}));

// Export a function to get player color that can be used outside React
export function getPlayerColor(playerId: string): number {
  return useGameSetupStore.getState().getPlayerColorHex(playerId);
}
