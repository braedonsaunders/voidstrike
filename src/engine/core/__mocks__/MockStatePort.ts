import type { GameStatePort } from '../GameStatePort';
import type { UpgradeEffect } from '@/data/research/dominion';

interface ResearchEntry {
  effects: UpgradeEffect[];
  completedAt: number;
}

interface PlayerResourceState {
  minerals: number;
  plasma: number;
  supply: number;
  maxSupply: number;
}

/**
 * Mock implementation of GameStatePort for unit testing.
 * Stores all state in-memory without Zustand dependency.
 */
export class MockStatePort implements GameStatePort {
  private selectedUnits: number[] = [];
  private controlGroups: Map<number, number[]> = new Map();
  private playerResources: Map<string, PlayerResourceState> = new Map([
    ['player1', { minerals: 50, plasma: 0, supply: 0, maxSupply: 0 }],
  ]);
  private research: Map<string, Map<string, ResearchEntry>> = new Map();

  private getPlayerResources(playerId: string = 'player1'): PlayerResourceState {
    let resources = this.playerResources.get(playerId);
    if (!resources) {
      resources = { minerals: 50, plasma: 0, supply: 0, maxSupply: 0 };
      this.playerResources.set(playerId, resources);
    }
    return resources;
  }

  getSelectedUnits(): number[] {
    return [...this.selectedUnits];
  }

  getControlGroup(groupNumber: number): number[] {
    return this.controlGroups.get(groupNumber) ?? [];
  }

  getMinerals(playerId?: string): number {
    return this.getPlayerResources(playerId).minerals;
  }

  getPlasma(playerId?: string): number {
    return this.getPlayerResources(playerId).plasma;
  }

  getSupply(playerId?: string): number {
    return this.getPlayerResources(playerId).supply;
  }

  getMaxSupply(playerId?: string): number {
    return this.getPlayerResources(playerId).maxSupply;
  }

  hasResearch(playerId: string, upgradeId: string): boolean {
    return this.research.get(playerId)?.has(upgradeId) ?? false;
  }

  addResearch(
    playerId: string,
    upgradeId: string,
    effects: UpgradeEffect[],
    completedAt: number
  ): void {
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

  addResources(minerals: number, plasma: number, playerId?: string): void {
    const resources = this.getPlayerResources(playerId);
    resources.minerals = Math.max(0, resources.minerals + minerals);
    resources.plasma = Math.max(0, resources.plasma + plasma);
  }

  setResources(minerals: number, plasma: number, playerId?: string): void {
    const resources = this.getPlayerResources(playerId);
    resources.minerals = Math.max(0, minerals);
    resources.plasma = Math.max(0, plasma);
  }

  addSupply(delta: number, playerId?: string): void {
    const resources = this.getPlayerResources(playerId);
    resources.supply = Math.max(0, Math.min(resources.maxSupply, resources.supply + delta));
  }

  addMaxSupply(delta: number, playerId?: string): void {
    const resources = this.getPlayerResources(playerId);
    resources.maxSupply = Math.max(0, Math.min(200, resources.maxSupply + delta));
    if (resources.supply > resources.maxSupply) {
      resources.supply = resources.maxSupply;
    }
  }

  // Test helpers
  setMinerals(amount: number, playerId: string = 'player1'): void {
    this.getPlayerResources(playerId).minerals = amount;
  }

  setPlasma(amount: number, playerId: string = 'player1'): void {
    this.getPlayerResources(playerId).plasma = amount;
  }

  setSupply(current: number, max: number, playerId: string = 'player1'): void {
    const resources = this.getPlayerResources(playerId);
    resources.supply = current;
    resources.maxSupply = max;
  }

  reset(): void {
    this.selectedUnits = [];
    this.controlGroups.clear();
    this.playerResources = new Map([
      ['player1', { minerals: 50, plasma: 0, supply: 0, maxSupply: 0 }],
    ]);
    this.research.clear();
  }
}
