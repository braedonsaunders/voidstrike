import { create } from 'zustand';
import { BiomeType } from '@/rendering/Biomes';

export type StartingResources = 'normal' | 'high' | 'insane';
export type GameSpeed = 'slower' | 'normal' | 'faster' | 'fastest';
export type AIDifficulty = 'easy' | 'medium' | 'hard' | 'insane';

export interface GameSetupState {
  // Map selection
  selectedMapId: string;

  // Game settings
  startingResources: StartingResources;
  gameSpeed: GameSpeed;
  aiDifficulty: AIDifficulty;
  fogOfWar: boolean;

  // Player settings
  playerFaction: string;
  playerColor: string;

  // Game session flag - must be true to enter /game
  gameStarted: boolean;

  // Actions
  setSelectedMap: (mapId: string) => void;
  setStartingResources: (resources: StartingResources) => void;
  setGameSpeed: (speed: GameSpeed) => void;
  setAIDifficulty: (difficulty: AIDifficulty) => void;
  setFogOfWar: (enabled: boolean) => void;
  setPlayerFaction: (faction: string) => void;
  setPlayerColor: (color: string) => void;
  startGame: () => void;
  endGame: () => void;
  reset: () => void;
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

export const PLAYER_COLORS = [
  { id: 'blue', name: 'Blue', hex: '#0080ff' },
  { id: 'red', name: 'Red', hex: '#ff4040' },
  { id: 'green', name: 'Green', hex: '#40ff40' },
  { id: 'yellow', name: 'Yellow', hex: '#ffff40' },
  { id: 'purple', name: 'Purple', hex: '#a040ff' },
  { id: 'orange', name: 'Orange', hex: '#ff8000' },
  { id: 'cyan', name: 'Cyan', hex: '#40ffff' },
  { id: 'pink', name: 'Pink', hex: '#ff80c0' },
];

const initialState = {
  selectedMapId: 'training_grounds',
  startingResources: 'normal' as StartingResources,
  gameSpeed: 'normal' as GameSpeed,
  aiDifficulty: 'medium' as AIDifficulty,
  fogOfWar: true,
  playerFaction: 'dominion',
  playerColor: 'blue',
  gameStarted: false,
};

export const useGameSetupStore = create<GameSetupState>((set) => ({
  ...initialState,

  setSelectedMap: (mapId) => set({ selectedMapId: mapId }),
  setStartingResources: (resources) => set({ startingResources: resources }),
  setGameSpeed: (speed) => set({ gameSpeed: speed }),
  setAIDifficulty: (difficulty) => set({ aiDifficulty: difficulty }),
  setFogOfWar: (enabled) => set({ fogOfWar: enabled }),
  setPlayerFaction: (faction) => set({ playerFaction: faction }),
  setPlayerColor: (color) => set({ playerColor: color }),
  startGame: () => set({ gameStarted: true }),
  endGame: () => set({ gameStarted: false }),
  reset: () => set(initialState),
}));
