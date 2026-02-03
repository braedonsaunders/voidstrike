import { describe, it, expect } from 'vitest';
import {
  calculateGridDimensions,
  worldToGrid,
  gridToWorld,
  gridToTextureIndex,
  worldToVisionUV,
  isValidGridCell,
} from '@/rendering/vision/VisionCoordinates';

describe('VisionCoordinates', () => {
  describe('calculateGridDimensions', () => {
    it('calculates grid dimensions from map config', () => {
      const result = calculateGridDimensions({
        mapWidth: 320,
        mapHeight: 320,
        cellSize: 2,
      });

      expect(result.gridWidth).toBe(160);
      expect(result.gridHeight).toBe(160);
      expect(result.cellSize).toBe(2);
    });

    it('rounds up for non-divisible dimensions', () => {
      const result = calculateGridDimensions({
        mapWidth: 321,
        mapHeight: 319,
        cellSize: 2,
      });

      expect(result.gridWidth).toBe(161); // ceil(321/2)
      expect(result.gridHeight).toBe(160); // ceil(319/2)
    });
  });

  describe('worldToGrid', () => {
    it('converts world position to grid cell', () => {
      const result = worldToGrid(10, 20, 2);
      expect(result.cellX).toBe(5);
      expect(result.cellY).toBe(10);
    });

    it('floors fractional positions', () => {
      const result = worldToGrid(11.9, 21.9, 2);
      expect(result.cellX).toBe(5); // floor(11.9/2) = 5
      expect(result.cellY).toBe(10); // floor(21.9/2) = 10
    });

    it('handles origin correctly', () => {
      const result = worldToGrid(0, 0, 2);
      expect(result.cellX).toBe(0);
      expect(result.cellY).toBe(0);
    });
  });

  describe('gridToWorld', () => {
    it('converts grid cell to world position (cell center)', () => {
      const result = gridToWorld(5, 10, 2);
      expect(result.worldX).toBe(11); // 5*2 + 1
      expect(result.worldY).toBe(21); // 10*2 + 1
    });

    it('handles origin correctly', () => {
      const result = gridToWorld(0, 0, 2);
      expect(result.worldX).toBe(1); // center of cell 0
      expect(result.worldY).toBe(1);
    });
  });

  describe('gridToTextureIndex', () => {
    it('converts grid cell to 1D texture index without Y-flip', () => {
      const gridWidth = 160;

      // Grid (0, 0) should map to index 0 (NO Y-FLIP)
      expect(gridToTextureIndex(0, 0, gridWidth)).toBe(0);

      // Grid (1, 0) should map to index 1
      expect(gridToTextureIndex(1, 0, gridWidth)).toBe(1);

      // Grid (0, 1) should map to index 160 (second row)
      expect(gridToTextureIndex(0, 1, gridWidth)).toBe(160);

      // Grid (5, 10) should map to index 10*160 + 5 = 1605
      expect(gridToTextureIndex(5, 10, gridWidth)).toBe(1605);
    });

    it('matches GPU textureStore behavior (no Y-flip)', () => {
      // GPU writes: textureStore(tex, vec2(cellX, cellY), ...)
      // This means grid row Y maps directly to texture row Y
      // NO inversion - this is critical for GPU/CPU consistency
      const gridWidth = 100;

      // Bottom row (y=0) goes to texture row 0
      expect(gridToTextureIndex(0, 0, gridWidth)).toBe(0);

      // Top row (y=99) goes to texture row 99, not row 0
      expect(gridToTextureIndex(0, 99, gridWidth)).toBe(9900);
    });
  });

  describe('worldToVisionUV', () => {
    it('converts world position to UV coordinates', () => {
      const result = worldToVisionUV(160, 160, 320, 320);
      expect(result.u).toBe(0.5);
      expect(result.v).toBe(0.5);
    });

    it('handles corners correctly', () => {
      // Bottom-left (south-west)
      const bl = worldToVisionUV(0, 0, 320, 320);
      expect(bl.u).toBe(0);
      expect(bl.v).toBe(0);

      // Top-right (north-east)
      const tr = worldToVisionUV(320, 320, 320, 320);
      expect(tr.u).toBe(1);
      expect(tr.v).toBe(1);
    });

    it('uses worldY for V coordinate (not worldZ)', () => {
      // This is critical: the fog shader must use worldY (depth) not worldZ (altitude)
      // for the V coordinate. This test documents that expectation.
      const mapWidth = 320;
      const mapHeight = 320;

      // A unit at worldY=160 (middle depth) should have visionV=0.5
      // regardless of its altitude (worldZ)
      const result = worldToVisionUV(100, 160, mapWidth, mapHeight);
      expect(result.v).toBe(0.5); // 160/320 = 0.5
    });
  });

  describe('isValidGridCell', () => {
    it('returns true for valid cells', () => {
      expect(isValidGridCell(0, 0, 160, 160)).toBe(true);
      expect(isValidGridCell(159, 159, 160, 160)).toBe(true);
      expect(isValidGridCell(80, 80, 160, 160)).toBe(true);
    });

    it('returns false for out-of-bounds cells', () => {
      expect(isValidGridCell(-1, 0, 160, 160)).toBe(false);
      expect(isValidGridCell(0, -1, 160, 160)).toBe(false);
      expect(isValidGridCell(160, 0, 160, 160)).toBe(false);
      expect(isValidGridCell(0, 160, 160, 160)).toBe(false);
    });
  });

  describe('GPU/CPU path consistency', () => {
    it('gridToTextureIndex produces same mapping as GPU textureStore', () => {
      // The GPU shader writes: textureStore(tex, vec2(cellX, cellY), value)
      // The CPU path must use the same index: cellY * gridWidth + cellX
      // This ensures both paths write to the same texture locations

      const gridWidth = 160;
      const gridHeight = 160;

      for (let y = 0; y < gridHeight; y += 20) {
        for (let x = 0; x < gridWidth; x += 20) {
          // GPU: vec2(cellX, cellY) → implicitly cellY * width + cellX
          const gpuIndex = y * gridWidth + x;

          // CPU: gridToTextureIndex(cellX, cellY, gridWidth)
          const cpuIndex = gridToTextureIndex(x, y, gridWidth);

          expect(cpuIndex).toBe(gpuIndex);
        }
      }
    });

    it('coordinate roundtrip preserves cell center', () => {
      const cellSize = 2;

      for (let cellX = 0; cellX < 10; cellX++) {
        for (let cellY = 0; cellY < 10; cellY++) {
          // Grid to world (cell center)
          const { worldX, worldY } = gridToWorld(cellX, cellY, cellSize);

          // World back to grid
          const { cellX: backX, cellY: backY } = worldToGrid(worldX, worldY, cellSize);

          // Should get same cell back
          expect(backX).toBe(cellX);
          expect(backY).toBe(cellY);
        }
      }
    });
  });
});
