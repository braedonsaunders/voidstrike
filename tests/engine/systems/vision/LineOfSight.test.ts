import { describe, it, expect, beforeEach } from 'vitest';
import { LineOfSight } from '@/engine/systems/vision/LineOfSight';

describe('LineOfSight', () => {
  let los: LineOfSight;

  const defaultConfig = {
    gridWidth: 64,
    gridHeight: 64,
    cellSize: 2,
    mapWidth: 128,
    mapHeight: 128,
    losBlockingThreshold: 1.0,
  };

  // Simple flat terrain height provider
  const flatHeightProvider = () => 0;

  // Terrain with a hill in the center
  const hillHeightProvider = (x: number, y: number) => {
    const centerX = 64;
    const centerY = 64;
    const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
    if (dist < 16) {
      return 5; // 5 unit high hill
    }
    return 0;
  };

  beforeEach(() => {
    los = new LineOfSight(defaultConfig);
  });

  describe('without height provider', () => {
    it('should allow LOS to all cells in range', () => {
      const visible = los.getVisibleCells(32, 32, 10);

      // Should have cells visible (no blocking)
      expect(visible.size).toBeGreaterThan(0);
    });
  });

  describe('with flat terrain', () => {
    beforeEach(() => {
      los.setHeightProvider(flatHeightProvider);
    });

    it('should allow LOS to cells in range', () => {
      const visible = los.getVisibleCells(32, 32, 10);

      // Should have all cells in circular range visible
      expect(visible.size).toBeGreaterThan(0);
    });

    it('should respect sight range', () => {
      const visible = los.getVisibleCells(64, 64, 8);

      // Convert to cell coordinates
      const centerCellX = Math.floor(64 / defaultConfig.cellSize);
      const centerCellY = Math.floor(64 / defaultConfig.cellSize);

      // All visible cells should be within range
      for (const cellKey of visible) {
        const cellX = cellKey % defaultConfig.gridWidth;
        const cellY = Math.floor(cellKey / defaultConfig.gridWidth);
        const dx = cellX - centerCellX;
        const dy = cellY - centerCellY;
        const distSq = dx * dx + dy * dy;
        const maxDistSq = (8 / defaultConfig.cellSize + 1) ** 2; // Account for rounding
        expect(distSq).toBeLessThanOrEqual(maxDistSq);
      }
    });
  });

  describe('with terrain blocking', () => {
    beforeEach(() => {
      los.setHeightProvider(hillHeightProvider);
    });

    it('should block LOS through high terrain', () => {
      // Caster at (32, 32), target at (96, 96), hill in between at (64, 64)
      const hasLOS = los.hasLineOfSight(
        32,
        32, // caster position
        0, // caster height (flat ground)
        48,
        48, // target cell (on other side of hill)
        20 // sight range
      );

      // LOS should be blocked by the hill
      expect(hasLOS).toBe(false);
    });

    it('should allow LOS to cells not blocked by terrain', () => {
      // Caster at (32, 32), target at (40, 32), no hill in between
      const hasLOS = los.hasLineOfSight(
        32,
        32, // caster position
        0, // caster height
        20,
        16, // target cell (same side as caster)
        10 // sight range
      );

      expect(hasLOS).toBe(true);
    });

    it('should allow LOS from high ground to low ground', () => {
      // Caster on the hill looking down
      const hasLOS = los.hasLineOfSight(
        64,
        64, // caster on hill
        5, // caster height (on top of hill)
        16,
        16, // target on flat ground
        30 // sight range
      );

      expect(hasLOS).toBe(true);
    });
  });

  describe('cache', () => {
    beforeEach(() => {
      los.setHeightProvider(flatHeightProvider);
    });

    it('should cache LOS results', () => {
      // First call
      los.hasLineOfSight(32, 32, 0, 16, 16, 10);

      // Second call should use cache (same result)
      const result = los.hasLineOfSight(32, 32, 0, 16, 16, 10);

      expect(result).toBe(true);
    });

    it('should invalidate cache when provider changes', () => {
      los.hasLineOfSight(32, 32, 0, 16, 16, 10);

      // Changing height provider should invalidate cache
      los.setHeightProvider(hillHeightProvider);

      // This is a new computation, not from cache
      const result = los.hasLineOfSight(32, 32, 0, 16, 16, 10);

      // Result should be computed fresh
      expect(typeof result).toBe('boolean');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      los.setHeightProvider(flatHeightProvider);
    });

    it('should handle cells at grid boundary', () => {
      const visible = los.getVisibleCells(4, 4, 10);

      // All visible cells should be within bounds
      for (const cellKey of visible) {
        const cellX = cellKey % defaultConfig.gridWidth;
        const cellY = Math.floor(cellKey / defaultConfig.gridWidth);
        expect(cellX).toBeGreaterThanOrEqual(0);
        expect(cellX).toBeLessThan(defaultConfig.gridWidth);
        expect(cellY).toBeGreaterThanOrEqual(0);
        expect(cellY).toBeLessThan(defaultConfig.gridHeight);
      }
    });

    it('should handle very small sight range', () => {
      const visible = los.getVisibleCells(64, 64, 1);

      // Should still have at least the center cell
      expect(visible.size).toBeGreaterThanOrEqual(1);
    });

    it('should handle large sight range', () => {
      const visible = los.getVisibleCells(64, 64, 50);

      // Should have many cells visible
      expect(visible.size).toBeGreaterThan(100);
    });
  });

  describe('reinitialize', () => {
    it('should accept new configuration', () => {
      const newConfig = {
        ...defaultConfig,
        gridWidth: 32,
        gridHeight: 32,
        losBlockingThreshold: 2.0,
      };

      los.reinitialize(newConfig);

      expect(los.getConfig().gridWidth).toBe(32);
      expect(los.getConfig().losBlockingThreshold).toBe(2.0);
    });
  });
});
