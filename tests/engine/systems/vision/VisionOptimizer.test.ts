import { describe, it, expect, beforeEach } from 'vitest';
import { VisionOptimizer } from '@/engine/systems/vision/VisionOptimizer';

describe('VisionOptimizer', () => {
  let optimizer: VisionOptimizer;

  const defaultConfig = {
    gridWidth: 64,
    gridHeight: 64,
    cellSize: 2,
    mapWidth: 128,
    mapHeight: 128,
  };

  beforeEach(() => {
    optimizer = new VisionOptimizer(defaultConfig);
  });

  describe('reference counting', () => {
    it('should track caster visibility correctly', () => {
      // Add a caster at world position (32, 32) with sight range 8
      optimizer.updateCaster(1, 'player1', 32, 32, 8);

      // Cell at (16, 16) should be visible (center of caster in grid coords)
      expect(optimizer.isCellVisible(16, 16, 'player1')).toBe(true);
    });

    it('should increment reference count when multiple casters see same cell', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.updateCaster(2, 'player1', 36, 32, 8);

      // Cell at (16, 16) should be visible to player1
      expect(optimizer.isCellVisible(16, 16, 'player1')).toBe(true);
    });

    it('should decrement reference count when caster is removed', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.removeCaster(1);

      // Cell should no longer be visible but should be explored
      expect(optimizer.isCellVisible(16, 16, 'player1')).toBe(false);
      expect(optimizer.isCellExplored(16, 16, 'player1')).toBe(true);
    });

    it('should maintain visibility when one of multiple casters is removed', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.updateCaster(2, 'player1', 32, 32, 8); // Same position
      optimizer.removeCaster(1);

      // Cell should still be visible due to second caster
      expect(optimizer.isCellVisible(16, 16, 'player1')).toBe(true);
    });
  });

  describe('cell boundary tracking', () => {
    it('should return false when caster moves within same cell', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);

      // Move within same cell (cellSize = 2, so 32-33 is same cell)
      const crossedBoundary = optimizer.updateCaster(1, 'player1', 33, 32, 8);

      expect(crossedBoundary).toBe(false);
    });

    it('should return true when caster crosses cell boundary', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);

      // Move to different cell (cellSize = 2, so 34 is new cell)
      const crossedBoundary = optimizer.updateCaster(1, 'player1', 34, 32, 8);

      expect(crossedBoundary).toBe(true);
    });

    it('should mark dirty cells when caster moves', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.clearDirtyState();

      optimizer.updateCaster(1, 'player1', 40, 32, 8);

      expect(optimizer.getDirtyCells().size).toBeGreaterThan(0);
    });
  });

  describe('multi-player support', () => {
    it('should track visibility separately per player', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.updateCaster(2, 'player2', 96, 96, 8);

      // Player1 should see their area but not player2's
      expect(optimizer.isCellVisible(16, 16, 'player1')).toBe(true);
      expect(optimizer.isCellVisible(48, 48, 'player1')).toBe(false);

      // Player2 should see their area but not player1's
      expect(optimizer.isCellVisible(48, 48, 'player2')).toBe(true);
      expect(optimizer.isCellVisible(16, 16, 'player2')).toBe(false);
    });

    it('should track dirty players independently', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.clearDirtyState();

      optimizer.updateCaster(2, 'player2', 96, 96, 8);

      expect(optimizer.getDirtyPlayers().has('player2')).toBe(true);
      expect(optimizer.getDirtyPlayers().has('player1')).toBe(false);
    });
  });

  describe('vision state', () => {
    it('should return unexplored for unvisited cells', () => {
      expect(optimizer.getCellVisionState(32, 32, 'player1')).toBe('unexplored');
    });

    it('should return visible for currently visible cells', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);

      expect(optimizer.getCellVisionState(16, 16, 'player1')).toBe('visible');
    });

    it('should return explored for previously visible cells', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.removeCaster(1);

      expect(optimizer.getCellVisionState(16, 16, 'player1')).toBe('explored');
    });
  });

  describe('visibility mask generation', () => {
    it('should generate correct mask values', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 4);

      const mask = optimizer.getVisibilityMask('player1');

      // Check that mask has correct size
      expect(mask.length).toBe(defaultConfig.gridWidth * defaultConfig.gridHeight);

      // Check that some cells are visible (value = 1.0)
      const centerIdx = 16 * defaultConfig.gridWidth + 16;
      expect(mask[centerIdx]).toBe(1.0);
    });
  });

  describe('stats', () => {
    it('should track caster count', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.updateCaster(2, 'player1', 64, 64, 8);

      const stats = optimizer.getStats();
      expect(stats.totalCasters).toBe(2);
    });

    it('should track dirty state', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);

      const stats = optimizer.getStats();
      expect(stats.dirtyCells).toBeGreaterThan(0);
      expect(stats.dirtyPlayers).toBe(1);
    });
  });

  describe('reinitialize', () => {
    it('should clear all state on reinitialize', () => {
      optimizer.updateCaster(1, 'player1', 32, 32, 8);
      optimizer.reinitialize(defaultConfig);

      expect(optimizer.getStats().totalCasters).toBe(0);
      expect(optimizer.isCellVisible(16, 16, 'player1')).toBe(false);
    });
  });
});
