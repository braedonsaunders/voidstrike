import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerGame } from '@/engine/workers/GameWorker';

describe('WorkerGame placement validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes placement validation helpers for parity with Game', () => {
    expect(typeof WorkerGame.prototype.isValidBuildingPlacement).toBe('function');
    expect(typeof WorkerGame.prototype.isValidTerrainForBuilding).toBe('function');
    expect(typeof WorkerGame.prototype.isPositionClearOfDecorations).toBe('function');
  });

  it('applies spawn starting resources instead of hardcoded defaults', () => {
    vi.stubGlobal('postMessage', vi.fn());

    const game = new WorkerGame({
      mapWidth: 64,
      mapHeight: 64,
      tickRate: 20,
      isMultiplayer: false,
      playerId: 'player1',
      aiEnabled: false,
    });

    game.spawnInitialEntities({
      width: 64,
      height: 64,
      name: 'test-map',
      startingResources: {
        minerals: 100,
        plasma: 25,
      },
      spawns: [{ playerSlot: 1, x: 10, y: 10 }],
      playerSlots: [
        {
          id: 'player1',
          type: 'human',
          faction: 'dominion',
          team: 0,
        },
      ],
    });

    expect(game.statePort.getMinerals('player1')).toBe(100);
    expect(game.statePort.getPlasma('player1')).toBe(25);
  });
});
