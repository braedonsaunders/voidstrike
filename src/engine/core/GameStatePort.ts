import type { UpgradeEffect } from '@/data/research/dominion';

/**
 * Port interface for engine to interact with game state.
 * Decouples engine logic from specific state management implementation (Zustand, Redux, etc.).
 * Enables unit testing with mock implementations.
 */
export interface GameStatePort {
  // === READS ===
  getSelectedUnits(): number[];
  getControlGroup(groupNumber: number): number[];
  getMinerals(playerId?: string): number;
  getPlasma(playerId?: string): number;
  getSupply(playerId?: string): number;
  getMaxSupply(playerId?: string): number;

  // === RESEARCH ===
  hasResearch(playerId: string, upgradeId: string): boolean;
  addResearch(
    playerId: string,
    upgradeId: string,
    effects: UpgradeEffect[],
    completedAt: number
  ): void;

  // === WRITES ===
  selectUnits(entityIds: number[]): void;
  setControlGroup(groupNumber: number, entityIds: number[]): void;
  addResources(minerals: number, plasma: number, playerId?: string): void;
  setResources(minerals: number, plasma: number, playerId?: string): void;
  addSupply(delta: number, playerId?: string): void;
  addMaxSupply(delta: number, playerId?: string): void;
}
