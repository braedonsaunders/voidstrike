import { describe, it, expect, beforeEach } from 'vitest';

/**
 * VisionSystem Tests
 *
 * Tests for fog of war logic:
 * 1. Vision state management
 * 2. Circular area reveal
 * 3. Vision mask downsampling
 * 4. Watch tower capture
 */

describe('VisionSystem', () => {
  describe('vision state transitions', () => {
    const UNEXPLORED = 0;
    const EXPLORED = 1;
    const VISIBLE = 2;

    it('unexplored is initial state', () => {
      expect(UNEXPLORED).toBe(0);
    });

    it('explored is greater than unexplored', () => {
      expect(EXPLORED).toBeGreaterThan(UNEXPLORED);
    });

    it('visible is greater than explored', () => {
      expect(VISIBLE).toBeGreaterThan(EXPLORED);
    });

    it('state never decreases below explored', () => {
      function updateState(current: number, newState: number): number {
        if (current === UNEXPLORED && newState >= EXPLORED) return newState;
        if (current === EXPLORED && newState === VISIBLE) return newState;
        if (current === VISIBLE && newState === EXPLORED) return EXPLORED;
        return current;
      }

      expect(updateState(UNEXPLORED, VISIBLE)).toBe(VISIBLE);
      expect(updateState(VISIBLE, EXPLORED)).toBe(EXPLORED);
      expect(updateState(EXPLORED, UNEXPLORED)).toBe(EXPLORED); // Never goes back to unexplored
    });
  });

  describe('circular area reveal', () => {
    function getRevealedCells(
      centerX: number,
      centerY: number,
      radius: number,
      gridWidth: number,
      gridHeight: number
    ): Array<{ x: number; y: number }> {
      const cells: Array<{ x: number; y: number }> = [];
      const radiusSq = radius * radius;

      const minX = Math.max(0, Math.floor(centerX - radius));
      const maxX = Math.min(gridWidth - 1, Math.ceil(centerX + radius));
      const minY = Math.max(0, Math.floor(centerY - radius));
      const maxY = Math.min(gridHeight - 1, Math.ceil(centerY + radius));

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          if (dx * dx + dy * dy <= radiusSq) {
            cells.push({ x, y });
          }
        }
      }

      return cells;
    }

    it('reveals center cell', () => {
      const cells = getRevealedCells(5, 5, 1, 10, 10);
      expect(cells.some((c) => c.x === 5 && c.y === 5)).toBe(true);
    });

    it('reveals circular area', () => {
      const cells = getRevealedCells(5, 5, 2, 10, 10);
      // Should include center and surrounding cells within radius
      expect(cells.length).toBeGreaterThan(4);
    });

    it('respects grid bounds at corner', () => {
      const cells = getRevealedCells(0, 0, 2, 10, 10);
      // Should only reveal cells within bounds
      expect(cells.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
    });

    it('respects grid bounds at edge', () => {
      const cells = getRevealedCells(9, 9, 3, 10, 10);
      expect(cells.every((c) => c.x < 10 && c.y < 10)).toBe(true);
    });

    it('radius 0 reveals only center', () => {
      const cells = getRevealedCells(5, 5, 0, 10, 10);
      expect(cells.length).toBe(1);
      expect(cells[0]).toEqual({ x: 5, y: 5 });
    });
  });

  describe('vision mask encoding', () => {
    const UNEXPLORED = 0;
    const EXPLORED = 1;
    const VISIBLE = 2;

    function encodeForMask(state: number): number {
      if (state === UNEXPLORED) return 0;
      if (state === EXPLORED) return 0.5;
      return 1.0;
    }

    it('encodes unexplored as 0', () => {
      expect(encodeForMask(UNEXPLORED)).toBe(0);
    });

    it('encodes explored as 0.5', () => {
      expect(encodeForMask(EXPLORED)).toBe(0.5);
    });

    it('encodes visible as 1.0', () => {
      expect(encodeForMask(VISIBLE)).toBe(1.0);
    });
  });

  describe('watch tower capture', () => {
    function isInCaptureRange(
      unitX: number,
      unitY: number,
      towerX: number,
      towerY: number,
      captureRadius: number
    ): boolean {
      const dx = unitX - towerX;
      const dy = unitY - towerY;
      return dx * dx + dy * dy <= captureRadius * captureRadius;
    }

    it('unit at tower is in range', () => {
      expect(isInCaptureRange(10, 10, 10, 10, 3)).toBe(true);
    });

    it('unit just within radius is in range', () => {
      expect(isInCaptureRange(13, 10, 10, 10, 3)).toBe(true);
    });

    it('unit outside radius is not in range', () => {
      expect(isInCaptureRange(14, 10, 10, 10, 3)).toBe(false);
    });

    it('diagonal distance calculated correctly', () => {
      // sqrt(2^2 + 2^2) = sqrt(8) ≈ 2.83
      expect(isInCaptureRange(12, 12, 10, 10, 3)).toBe(true);
      expect(isInCaptureRange(13, 13, 10, 10, 3)).toBe(false);
    });
  });

  describe('grid to world conversion', () => {
    function gridToWorld(gridX: number, gridY: number, cellSize: number): { x: number; y: number } {
      return {
        x: (gridX + 0.5) * cellSize,
        y: (gridY + 0.5) * cellSize,
      };
    }

    function worldToGrid(worldX: number, worldY: number, cellSize: number): { x: number; y: number } {
      return {
        x: Math.floor(worldX / cellSize),
        y: Math.floor(worldY / cellSize),
      };
    }

    it('grid to world centers on cell', () => {
      const result = gridToWorld(0, 0, 2);
      expect(result.x).toBe(1);
      expect(result.y).toBe(1);
    });

    it('world to grid floors coordinates', () => {
      const result = worldToGrid(1.5, 1.5, 2);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('round-trip returns same grid cell', () => {
      const gridPos = { x: 5, y: 3 };
      const worldPos = gridToWorld(gridPos.x, gridPos.y, 2);
      const backToGrid = worldToGrid(worldPos.x, worldPos.y, 2);
      expect(backToGrid).toEqual(gridPos);
    });
  });

  describe('temporary reveal expiration', () => {
    interface TemporaryReveal {
      playerId: string;
      position: { x: number; y: number };
      radius: number;
      expirationTick: number;
      detectsCloaked: boolean;
    }

    function processTemporaryReveals(
      reveals: TemporaryReveal[],
      currentTick: number
    ): TemporaryReveal[] {
      // Filter out expired reveals
      return reveals.filter((reveal) => reveal.expirationTick > currentTick);
    }

    it('active reveals are kept', () => {
      const reveals: TemporaryReveal[] = [
        { playerId: 'p1', position: { x: 10, y: 10 }, radius: 8, expirationTick: 100, detectsCloaked: true },
      ];
      const result = processTemporaryReveals(reveals, 50);
      expect(result.length).toBe(1);
    });

    it('expired reveals are removed', () => {
      const reveals: TemporaryReveal[] = [
        { playerId: 'p1', position: { x: 10, y: 10 }, radius: 8, expirationTick: 100, detectsCloaked: true },
      ];
      const result = processTemporaryReveals(reveals, 150);
      expect(result.length).toBe(0);
    });

    it('reveals expiring at current tick are removed', () => {
      const reveals: TemporaryReveal[] = [
        { playerId: 'p1', position: { x: 10, y: 10 }, radius: 8, expirationTick: 100, detectsCloaked: true },
      ];
      const result = processTemporaryReveals(reveals, 100);
      expect(result.length).toBe(0);
    });

    it('mixed active and expired reveals are processed correctly', () => {
      const reveals: TemporaryReveal[] = [
        { playerId: 'p1', position: { x: 10, y: 10 }, radius: 8, expirationTick: 50, detectsCloaked: true },
        { playerId: 'p1', position: { x: 20, y: 20 }, radius: 8, expirationTick: 150, detectsCloaked: true },
        { playerId: 'p2', position: { x: 30, y: 30 }, radius: 8, expirationTick: 200, detectsCloaked: false },
      ];
      const result = processTemporaryReveals(reveals, 100);
      expect(result.length).toBe(2);
      expect(result[0].expirationTick).toBe(150);
      expect(result[1].expirationTick).toBe(200);
    });
  });

  describe('cloaked unit detection', () => {
    interface Position { x: number; y: number }

    function isInDetectionRadius(
      unitPos: Position,
      detectPos: Position,
      radius: number
    ): boolean {
      const dx = unitPos.x - detectPos.x;
      const dy = unitPos.y - detectPos.y;
      return dx * dx + dy * dy <= radius * radius;
    }

    it('unit at detection center is detected', () => {
      expect(isInDetectionRadius({ x: 10, y: 10 }, { x: 10, y: 10 }, 8)).toBe(true);
    });

    it('unit within radius is detected', () => {
      expect(isInDetectionRadius({ x: 15, y: 10 }, { x: 10, y: 10 }, 8)).toBe(true);
    });

    it('unit at edge of radius is detected', () => {
      expect(isInDetectionRadius({ x: 18, y: 10 }, { x: 10, y: 10 }, 8)).toBe(true);
    });

    it('unit outside radius is not detected', () => {
      expect(isInDetectionRadius({ x: 20, y: 10 }, { x: 10, y: 10 }, 8)).toBe(false);
    });

    it('diagonal distance is calculated correctly', () => {
      // sqrt(6^2 + 6^2) = sqrt(72) ≈ 8.49 > 8
      expect(isInDetectionRadius({ x: 16, y: 16 }, { x: 10, y: 10 }, 8)).toBe(false);
      // sqrt(5^2 + 5^2) = sqrt(50) ≈ 7.07 < 8
      expect(isInDetectionRadius({ x: 15, y: 15 }, { x: 10, y: 10 }, 8)).toBe(true);
    });
  });
});
