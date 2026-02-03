import type { GameStatePort } from '../GameStatePort';
import type { UpgradeEffect } from '@/data/research/dominion';

interface ResearchEntry {
  effects: UpgradeEffect[];
  completedAt: number;
}

/**
 * Mock implementation of GameStatePort for unit testing.
 * Stores all state in-memory without Zustand dependency.
 */
export class MockStatePort implements GameStatePort {
  private selectedUnits: number[] = [];
  private controlGroups: Map<number, number[]> = new Map();
  private minerals = 50;
  private plasma = 0;
  private supply = 0;
  private maxSupply = 0;
  private research: Map<string, Map<string, ResearchEntry>> = new Map();

  getSelectedUnits(): number[] {
    return [...this.selectedUnits];
  }

  getControlGroup(groupNumber: number): number[] {
    return this.controlGroups.get(groupNumber) ?? [];
  }

  getMinerals(): number {
    return this.minerals;
  }

  getPlasma(): number {
    return this.plasma;
  }

  getSupply(): number {
    return this.supply;
  }

  getMaxSupply(): number {
    return this.maxSupply;
  }

  hasResearch(playerId: string, upgradeId: string): boolean {
    return this.research.get(playerId)?.has(upgradeId) ?? false;
  }

  addResearch(playerId: string, upgradeId: string, effects: UpgradeEffect[], completedAt: number): void {
    if (!this.research.has(playerId)) {
      this.research.set(playerId, new Map());
    }
    this.research.get(playerId)!.set(upgradeId, { effects, completedAt });
  }

  selectUnits(entityIds: number[]): void {
    this.selectedUnits = [...entityIds];
  }

  setControlGroup(groupNumber: number, entityIds: number[]): void {
    this.controlGroups.set(groupNumber, [...entityIds]);
  }

  addResources(minerals: number, plasma: number): void {
    this.minerals = Math.max(0, this.minerals + minerals);
    this.plasma = Math.max(0, this.plasma + plasma);
  }

  setResources(minerals: number, plasma: number): void {
    this.minerals = Math.max(0, minerals);
    this.plasma = Math.max(0, plasma);
  }

  addSupply(delta: number): void {
    this.supply = Math.max(0, Math.min(this.maxSupply, this.supply + delta));
  }

  addMaxSupply(delta: number): void {
    this.maxSupply = Math.min(200, this.maxSupply + delta);
  }

  // Test helpers
  setMinerals(amount: number): void {
    this.minerals = amount;
  }

  setPlasma(amount: number): void {
    this.plasma = amount;
  }

  setSupply(current: number, max: number): void {
    this.supply = current;
    this.maxSupply = max;
  }

  reset(): void {
    this.selectedUnits = [];
    this.controlGroups.clear();
    this.minerals = 50;
    this.plasma = 0;
    this.supply = 0;
    this.maxSupply = 0;
    this.research.clear();
  }
}
