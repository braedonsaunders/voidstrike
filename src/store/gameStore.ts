import { create } from 'zustand';

export interface GameState {
  // Resources
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;

  // Selection
  selectedUnits: number[];
  controlGroups: Map<number, number[]>;

  // Game state
  gameTime: number;
  isPaused: boolean;
  gameSpeed: number;

  // Player info
  playerId: string;
  faction: string;

  // UI state
  isBuilding: boolean;
  buildingType: string | null;
  showMinimap: boolean;
  showResourcePanel: boolean;

  // Camera
  cameraX: number;
  cameraY: number;
  cameraZoom: number;

  // Actions
  selectUnits: (ids: number[]) => void;
  addToSelection: (ids: number[]) => void;
  removeFromSelection: (ids: number[]) => void;
  clearSelection: () => void;
  setControlGroup: (key: number, ids: number[]) => void;
  getControlGroup: (key: number) => number[];
  addResources: (minerals: number, vespene: number) => void;
  addSupply: (amount: number) => void;
  addMaxSupply: (amount: number) => void;
  setGameTime: (time: number) => void;
  togglePause: () => void;
  setGameSpeed: (speed: number) => void;
  setBuildingMode: (type: string | null) => void;
  setCamera: (x: number, y: number, zoom?: number) => void;
  reset: () => void;
}

const initialState = {
  minerals: 50,
  vespene: 0,
  supply: 0,
  maxSupply: 10,
  selectedUnits: [],
  controlGroups: new Map<number, number[]>(),
  gameTime: 0,
  isPaused: false,
  gameSpeed: 1,
  playerId: 'player1',
  faction: 'dominion',
  isBuilding: false,
  buildingType: null,
  showMinimap: true,
  showResourcePanel: true,
  cameraX: 64,
  cameraY: 64,
  cameraZoom: 30,
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,

  selectUnits: (ids) => set({ selectedUnits: ids }),

  addToSelection: (ids) =>
    set((state) => ({
      selectedUnits: [...new Set([...state.selectedUnits, ...ids])],
    })),

  removeFromSelection: (ids) =>
    set((state) => ({
      selectedUnits: state.selectedUnits.filter((id) => !ids.includes(id)),
    })),

  clearSelection: () => set({ selectedUnits: [] }),

  setControlGroup: (key, ids) =>
    set((state) => {
      const newGroups = new Map(state.controlGroups);
      newGroups.set(key, ids);
      return { controlGroups: newGroups };
    }),

  getControlGroup: (key) => {
    return get().controlGroups.get(key) || [];
  },

  addResources: (minerals, vespene) =>
    set((state) => ({
      minerals: Math.max(0, state.minerals + minerals),
      vespene: Math.max(0, state.vespene + vespene),
    })),

  addSupply: (amount) =>
    set((state) => ({
      supply: Math.max(0, Math.min(state.maxSupply, state.supply + amount)),
    })),

  addMaxSupply: (amount) =>
    set((state) => ({
      maxSupply: Math.min(200, state.maxSupply + amount),
    })),

  setGameTime: (time) => set({ gameTime: time }),

  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),

  setGameSpeed: (speed) => set({ gameSpeed: speed }),

  setBuildingMode: (type) =>
    set({
      isBuilding: type !== null,
      buildingType: type,
    }),

  setCamera: (x, y, zoom) =>
    set((state) => ({
      cameraX: x,
      cameraY: y,
      cameraZoom: zoom ?? state.cameraZoom,
    })),

  reset: () => set(initialState),
}));
