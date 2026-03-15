import { useGameStore } from '@/store/gameStore';
import type { GameStatePort } from '@/engine/core/GameStatePort';
import type { UpgradeEffect } from '@/data/research/dominion';

interface PlayerResourceState {
  minerals: number;
  plasma: number;
  supply: number;
  maxSupply: number;
}

/**
 * Adapter that bridges GameStatePort to Zustand store.
 * Used in production to connect engine systems to React state.
 */
export class ZustandStateAdapter implements GameStatePort {
  private playerResources = new Map<string, PlayerResourceState>();

  private getLocalPlayerId(): string {
    return useGameStore.getState().playerId;
  }

  private readLocalPlayerResources(): PlayerResourceState {
    const state = useGameStore.getState();
    return {
      minerals: state.minerals,
      plasma: state.plasma,
      supply: state.supply,
      maxSupply: state.maxSupply,
    };
  }

  private ensurePlayerResources(playerId?: string): {
    playerId: string;
    resources: PlayerResourceState;
  } {
    const resolvedPlayerId = playerId ?? this.getLocalPlayerId();
    let resources = this.playerResources.get(resolvedPlayerId);

    if (!resources) {
      resources =
        resolvedPlayerId === this.getLocalPlayerId()
          ? this.readLocalPlayerResources()
          : { minerals: 50, plasma: 0, supply: 0, maxSupply: 0 };
      this.playerResources.set(resolvedPlayerId, resources);
    }

    if (resolvedPlayerId === this.getLocalPlayerId()) {
      const localResources = this.readLocalPlayerResources();
      resources.minerals = localResources.minerals;
      resources.plasma = localResources.plasma;
      resources.supply = localResources.supply;
      resources.maxSupply = localResources.maxSupply;
    }

    return { playerId: resolvedPlayerId, resources };
  }

  private syncLocalPlayerResources(playerId: string, resources: PlayerResourceState): void {
    if (playerId !== this.getLocalPlayerId()) return;

    useGameStore.getState().syncPlayerResources({
      minerals: resources.minerals,
      plasma: resources.plasma,
      supply: resources.supply,
      maxSupply: resources.maxSupply,
    });
  }

  getSelectedUnits(): number[] {
    return useGameStore.getState().selectedUnits;
  }

  getControlGroup(groupNumber: number): number[] {
    return useGameStore.getState().getControlGroup(groupNumber);
  }

  getMinerals(playerId?: string): number {
    return this.ensurePlayerResources(playerId).resources.minerals;
  }

  getPlasma(playerId?: string): number {
    return this.ensurePlayerResources(playerId).resources.plasma;
  }

  getSupply(playerId?: string): number {
    return this.ensurePlayerResources(playerId).resources.supply;
  }

  getMaxSupply(playerId?: string): number {
    return this.ensurePlayerResources(playerId).resources.maxSupply;
  }

  hasResearch(playerId: string, upgradeId: string): boolean {
    return useGameStore.getState().hasResearch(playerId, upgradeId);
  }

  addResearch(
    playerId: string,
    upgradeId: string,
    effects: UpgradeEffect[],
    completedAt: number
  ): void {
    useGameStore.getState().addResearch(playerId, upgradeId, effects, completedAt);
  }

  selectUnits(entityIds: number[]): void {
    useGameStore.getState().selectUnits(entityIds);
  }

  setControlGroup(groupNumber: number, entityIds: number[]): void {
    useGameStore.getState().setControlGroup(groupNumber, entityIds);
  }

  addResources(minerals: number, plasma: number, playerId?: string): void {
    const resolved = this.ensurePlayerResources(playerId);
    resolved.resources.minerals = Math.max(0, resolved.resources.minerals + minerals);
    resolved.resources.plasma = Math.max(0, resolved.resources.plasma + plasma);
    this.playerResources.set(resolved.playerId, resolved.resources);
    this.syncLocalPlayerResources(resolved.playerId, resolved.resources);
  }

  setResources(minerals: number, plasma: number, playerId?: string): void {
    const resolved = this.ensurePlayerResources(playerId);
    resolved.resources.minerals = Math.max(0, minerals);
    resolved.resources.plasma = Math.max(0, plasma);
    this.playerResources.set(resolved.playerId, resolved.resources);
    this.syncLocalPlayerResources(resolved.playerId, resolved.resources);
  }

  addSupply(delta: number, playerId?: string): void {
    const resolved = this.ensurePlayerResources(playerId);
    resolved.resources.supply = Math.max(
      0,
      Math.min(resolved.resources.maxSupply, resolved.resources.supply + delta)
    );
    this.playerResources.set(resolved.playerId, resolved.resources);
    this.syncLocalPlayerResources(resolved.playerId, resolved.resources);
  }

  addMaxSupply(delta: number, playerId?: string): void {
    const resolved = this.ensurePlayerResources(playerId);
    resolved.resources.maxSupply = Math.max(0, Math.min(200, resolved.resources.maxSupply + delta));
    if (resolved.resources.supply > resolved.resources.maxSupply) {
      resolved.resources.supply = resolved.resources.maxSupply;
    }
    this.playerResources.set(resolved.playerId, resolved.resources);
    this.syncLocalPlayerResources(resolved.playerId, resolved.resources);
  }
}
