import { describe, it, expect } from 'vitest';
import { WorkerGame } from '@/engine/workers/GameWorker';

describe('WorkerGame placement validation', () => {
  it('exposes placement validation helpers for parity with Game', () => {
    expect(typeof WorkerGame.prototype.isValidBuildingPlacement).toBe('function');
    expect(typeof WorkerGame.prototype.isValidTerrainForBuilding).toBe('function');
    expect(typeof WorkerGame.prototype.isPositionClearOfDecorations).toBe('function');
  });
});
