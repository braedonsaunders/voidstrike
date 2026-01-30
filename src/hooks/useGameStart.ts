'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Game } from '@/engine/core/Game';
import { useGameSetupStore } from '@/store/gameSetupStore';

export interface UseGameStartOptions {
  guestSlotCount: number;
  connectedGuestCount: number;
  sendGameStart: () => number;
}

export interface UseGameStartReturn {
  startGameError: string | null;
  handleStartGame: () => void;
}

/**
 * Hook to handle game start validation and execution.
 * Validates guest connections and sends game start signal before navigating.
 */
export function useGameStart({
  guestSlotCount,
  connectedGuestCount,
  sendGameStart,
}: UseGameStartOptions): UseGameStartReturn {
  const router = useRouter();
  const [startGameError, setStartGameError] = useState<string | null>(null);
  const startGame = useGameSetupStore((state) => state.startGame);

  const handleStartGame = useCallback(() => {
    // If we have guest slots, make sure they're actually connected
    if (guestSlotCount > 0 && connectedGuestCount < guestSlotCount) {
      setStartGameError(`Waiting for ${guestSlotCount - connectedGuestCount} player(s) to connect...`);
      return;
    }

    // Reset any existing game instance to ensure fresh multiplayer state
    Game.resetInstance();

    // Send game start signal to all connected guests
    if (guestSlotCount > 0) {
      const notified = sendGameStart();
      if (notified < guestSlotCount) {
        setStartGameError(`Failed to notify all players. Only ${notified}/${guestSlotCount} connected.`);
        return;
      }
    }

    startGame();
    router.push('/game');
  }, [guestSlotCount, connectedGuestCount, sendGameStart, startGame, router]);

  return {
    startGameError,
    handleStartGame,
  };
}
