import { beforeEach, describe, expect, it } from 'vitest';

import { syncWorkerPlayerResources } from '@/components/game/hooks/syncWorkerPlayerResources';
import type { PlayerResourceState } from '@/engine/workers';
import { useGameStore } from '@/store/gameStore';

function createPlayerResources(
  entries: Array<[string, PlayerResourceState]>
): Map<string, PlayerResourceState> {
  return new Map(entries);
}

describe('syncWorkerPlayerResources', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('syncs the local player resource panel from worker render state', () => {
    syncWorkerPlayerResources(
      createPlayerResources([
        [
          'player1',
          {
            minerals: 95,
            plasma: 25,
            supply: 6,
            maxSupply: 11,
          },
        ],
      ]),
      'player1'
    );

    const state = useGameStore.getState();
    expect(state.minerals).toBe(95);
    expect(state.plasma).toBe(25);
    expect(state.supply).toBe(6);
    expect(state.maxSupply).toBe(11);
  });

  it('leaves the store unchanged when no matching player resources exist', () => {
    syncWorkerPlayerResources(
      createPlayerResources([
        [
          'player2',
          {
            minerals: 200,
            plasma: 80,
            supply: 12,
            maxSupply: 20,
          },
        ],
      ]),
      'player1'
    );

    let state = useGameStore.getState();
    expect(state.minerals).toBe(50);
    expect(state.plasma).toBe(0);
    expect(state.supply).toBe(0);
    expect(state.maxSupply).toBe(0);

    syncWorkerPlayerResources(
      createPlayerResources([
        [
          'player1',
          {
            minerals: 200,
            plasma: 80,
            supply: 12,
            maxSupply: 20,
          },
        ],
      ]),
      null
    );

    state = useGameStore.getState();
    expect(state.minerals).toBe(50);
    expect(state.plasma).toBe(0);
    expect(state.supply).toBe(0);
    expect(state.maxSupply).toBe(0);
  });
});
