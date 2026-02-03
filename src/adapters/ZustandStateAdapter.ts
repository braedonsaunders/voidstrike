import { useGameStore } from '@/store/gameStore';
import type { GameStatePort } from '@/engine/core/GameStatePort';
import type { UpgradeEffect } from '@/data/research/dominion';

/**
 * Adapter that bridges GameStatePort to Zustand store.
 * Used in production to connect engine systems to React state.
 */
export class ZustandStateAdapter implements GameStatePort {
  getSelectedUnits(): number[] {
    return useGameStore.getState().selectedUnits;
  }

  getControlGroup(groupNumber: number): number[] {
    return useGameStore.getState().getControlGroup(groupNumber);
  }

  getMinerals(): number {
    return useGameStore.getState().minerals;
  }

  getPlasma(): number {
    return useGameStore.getState().plasma;
  }

  getSupply(): number {
    return useGameStore.getState().supply;
  }

  getMaxSupply(): number {
    return useGameStore.getState().maxSupply;
  }

  hasResearch(playerId: string, upgradeId: string): boolean {
    return useGameStore.getState().hasResearch(playerId, upgradeId);
  }

  addResearch(playerId: string, upgradeId: string, effects: UpgradeEffect[], completedAt: number): void {
    useGameStore.getState().addResearch(playerId, upgradeId, effects, completedAt);
  }

  selectUnits(entityIds: number[]): void {
    useGameStore.getState().selectUnits(entityIds);
  }

  setControlGroup(groupNumber: number, entityIds: number[]): void {
    useGameStore.getState().setControlGroup(groupNumber, entityIds);
  }

  addResources(minerals: number, plasma: number): void {
    useGameStore.getState().addResources(minerals, plasma);
  }

  setResources(minerals: number, plasma: number): void {
    useGameStore.getState().setResources(minerals, plasma);
  }

  addSupply(delta: number): void {
    useGameStore.getState().addSupply(delta);
  }

  addMaxSupply(delta: number): void {
    useGameStore.getState().addMaxSupply(delta);
  }
}
