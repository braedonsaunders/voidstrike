import type { PlayerResourceState } from '@/engine/workers';
import { useGameStore } from '@/store/gameStore';

export function syncWorkerPlayerResources(
  playerResources: Map<string, PlayerResourceState>,
  playerId: string | null | undefined
): void {
  if (!playerId) return;

  const nextResources = playerResources.get(playerId);
  if (!nextResources) return;

  const gameState = useGameStore.getState();
  if (
    gameState.minerals === nextResources.minerals &&
    gameState.plasma === nextResources.plasma &&
    gameState.supply === nextResources.supply &&
    gameState.maxSupply === nextResources.maxSupply
  ) {
    return;
  }

  gameState.syncPlayerResources(nextResources);
}
