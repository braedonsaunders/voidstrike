import type { PlayerSlot } from '@/store/gameSetupStore';

export function shouldEnableLobbyNetworking(
  playerSlots: PlayerSlot[],
  isPublicLobby: boolean
): boolean {
  if (isPublicLobby) {
    return true;
  }

  return playerSlots.some((slot) => slot.type === 'open' || slot.isGuest === true);
}

export function shouldPreserveLobbySessionOnUnmount(gameStarted: boolean): boolean {
  return gameStarted;
}
