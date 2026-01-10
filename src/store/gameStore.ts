import { create } from 'zustand';
import { UpgradeEffect } from '@/data/research/dominion';
import { Game } from '@/engine/core/Game';
import { getLocalPlayerId } from '@/store/gameSetupStore';

export interface ResearchedUpgrade {
  id: string;
  effects: UpgradeEffect[];
  completedAt: number; // game time when completed
}

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

  // Research
  researchedUpgrades: Map<string, ResearchedUpgrade>; // playerId -> upgrades

  // UI state
  isBuilding: boolean;
  buildingType: string | null;
  isSettingRallyPoint: boolean;
  isRepairMode: boolean; // Repair targeting mode
  abilityTargetMode: string | null; // ability ID being targeted
  showMinimap: boolean;
  showResourcePanel: boolean;
  showTechTree: boolean;
  showKeyboardShortcuts: boolean;

  // Camera
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  pendingCameraMove: { x: number; y: number } | null;

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
  setRallyPointMode: (isActive: boolean) => void;
  setRepairMode: (isActive: boolean) => void;
  setAbilityTargetMode: (abilityId: string | null) => void;
  setCamera: (x: number, y: number, zoom?: number) => void;
  moveCameraTo: (x: number, y: number) => void;
  clearPendingCameraMove: () => void;
  addResearch: (playerId: string, upgradeId: string, effects: UpgradeEffect[], completedAt: number) => void;
  hasResearch: (playerId: string, upgradeId: string) => boolean;
  getUpgradeBonus: (playerId: string, unitId: string, effectType: UpgradeEffect['type']) => number;
  setShowTechTree: (show: boolean) => void;
  setShowKeyboardShortcuts: (show: boolean) => void;
  setPlayerId: (playerId: string) => void;
  syncWithGameSetup: () => void;
  reset: () => void;
}

const initialState = {
  minerals: 50,
  vespene: 0,
  supply: 0,
  maxSupply: 0, // Will be set from buildings when game starts
  selectedUnits: [],
  controlGroups: new Map<number, number[]>(),
  gameTime: 0,
  isPaused: false,
  gameSpeed: 1,
  playerId: 'player1',
  faction: 'dominion',
  researchedUpgrades: new Map<string, ResearchedUpgrade>(),
  isBuilding: false,
  buildingType: null,
  isSettingRallyPoint: false,
  isRepairMode: false,
  abilityTargetMode: null,
  showMinimap: true,
  showResourcePanel: true,
  showTechTree: false,
  showKeyboardShortcuts: false,
  cameraX: 64,
  cameraY: 64,
  cameraZoom: 30,
  pendingCameraMove: null,
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

  togglePause: () =>
    set((state) => {
      const newPaused = !state.isPaused;
      // Actually pause/resume the game engine
      try {
        const game = Game.getInstance();
        if (newPaused) {
          game.pause();
        } else {
          game.resume();
        }
      } catch {
        // Game instance might not exist yet
      }
      return { isPaused: newPaused };
    }),

  setGameSpeed: (speed) => set({ gameSpeed: speed }),

  setBuildingMode: (type) =>
    set({
      isBuilding: type !== null,
      buildingType: type,
      isSettingRallyPoint: false,
    }),

  setRallyPointMode: (isActive) =>
    set({
      isSettingRallyPoint: isActive,
      isBuilding: false,
      buildingType: null,
      isRepairMode: false,
      abilityTargetMode: null,
    }),

  setRepairMode: (isActive) =>
    set({
      isRepairMode: isActive,
      isBuilding: false,
      buildingType: null,
      isSettingRallyPoint: false,
      abilityTargetMode: null,
    }),

  setAbilityTargetMode: (abilityId) =>
    set({
      abilityTargetMode: abilityId,
      isBuilding: false,
      buildingType: null,
      isSettingRallyPoint: false,
      isRepairMode: false,
    }),

  setCamera: (x, y, zoom) =>
    set((state) => ({
      cameraX: x,
      cameraY: y,
      cameraZoom: zoom ?? state.cameraZoom,
    })),

  moveCameraTo: (x, y) =>
    set({ pendingCameraMove: { x, y } }),

  clearPendingCameraMove: () =>
    set({ pendingCameraMove: null }),

  addResearch: (playerId, upgradeId, effects, completedAt) =>
    set((state) => {
      const key = `${playerId}:${upgradeId}`;
      const newUpgrades = new Map(state.researchedUpgrades);
      newUpgrades.set(key, { id: upgradeId, effects, completedAt });
      return { researchedUpgrades: newUpgrades };
    }),

  hasResearch: (playerId, upgradeId) => {
    const key = `${playerId}:${upgradeId}`;
    return get().researchedUpgrades.has(key);
  },

  getUpgradeBonus: (playerId, unitId, effectType) => {
    const state = get();
    let bonus = 0;

    // Import unit types dynamically to avoid circular deps
    const { UNIT_TYPES } = require('@/data/research/dominion');
    const unitType = UNIT_TYPES[unitId];

    for (const [key, upgrade] of state.researchedUpgrades) {
      if (!key.startsWith(playerId + ':')) continue;

      for (const effect of upgrade.effects) {
        if (effect.type !== effectType) continue;

        // Check if effect applies to this unit
        const appliesToUnit =
          (!effect.targets || effect.targets.length === 0 || effect.targets.includes(unitId)) &&
          (!effect.unitTypes || effect.unitTypes.length === 0 || (unitType && effect.unitTypes.includes(unitType)));

        if (appliesToUnit) {
          bonus += effect.value;
        }
      }
    }

    return bonus;
  },

  setShowTechTree: (show) => set({ showTechTree: show }),

  setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show }),

  setPlayerId: (playerId) => set({ playerId }),

  syncWithGameSetup: () => {
    const localPlayerId = getLocalPlayerId();
    if (localPlayerId) {
      set({ playerId: localPlayerId });
    }
  },

  reset: () => set(initialState),
}));
