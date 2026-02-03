import { describe, it, expect, beforeEach } from 'vitest';
import { SDFVisionRenderer } from '@/engine/systems/vision/SDFVisionRenderer';

describe('SDFVisionRenderer', () => {
  let sdfRenderer: SDFVisionRenderer;

  const defaultConfig = {
    gridWidth: 16,
    gridHeight: 16,
    cellSize: 2,
    maxDistance: 8,
    edgeSoftness: 0.3,
  };

  beforeEach(() => {
    sdfRenderer = new SDFVisionRenderer(defaultConfig);
  });

  describe('SDF generation', () => {
    it('should create SDF texture for player', () => {
      const texture = sdfRenderer.getSDFTexture('player1');

      expect(texture).toBeDefined();
      expect(texture.image.width).toBe(defaultConfig.gridWidth);
      expect(texture.image.height).toBe(defaultConfig.gridHeight);
    });

    it('should update SDF from visibility mask', () => {
      const mask = new Float32Array(defaultConfig.gridWidth * defaultConfig.gridHeight);

      // Create a visibility pattern (center visible)
      for (let y = 6; y < 10; y++) {
        for (let x = 6; x < 10; x++) {
          mask[y * defaultConfig.gridWidth + x] = 1.0;
        }
      }

      sdfRenderer.updateSDF('player1', mask);

      const texture = sdfRenderer.getSDFTexture('player1');
      expect(texture.needsUpdate).toBe(true);
    });
  });

  describe('edge factor calculation', () => {
    it('should return 0 for solid areas away from edge', () => {
      const mask = new Float32Array(defaultConfig.gridWidth * defaultConfig.gridHeight);
      mask.fill(1.0); // All visible

      sdfRenderer.updateSDF('player1', mask);

      // Center cell should have low edge factor (away from edges)
      const edgeFactor = sdfRenderer.getEdgeFactor(8, 8, 'player1');
      expect(edgeFactor).toBeLessThan(0.5);
    });

    it('should return 0 for unexplored player', () => {
      const edgeFactor = sdfRenderer.getEdgeFactor(8, 8, 'unknown_player');
      expect(edgeFactor).toBe(0);
    });
  });

  describe('pattern-based AA', () => {
    it('should generate 16 AA patterns', () => {
      const patterns = sdfRenderer.generateAAPatterns();

      expect(patterns.size).toBe(16);

      // Each pattern should be 4x4 = 16 values
      for (const [, pattern] of patterns) {
        expect(pattern.length).toBe(16);
      }
    });

    it('should generate correct isolated visible cell pattern', () => {
      const patterns = sdfRenderer.generateAAPatterns();
      const isolatedPattern = patterns.get(0); // 0b0000 = no neighbors

      expect(isolatedPattern).toBeDefined();

      // Corners should be dimmer (128)
      expect(isolatedPattern![0]).toBe(128);
      expect(isolatedPattern![3]).toBe(128);
      expect(isolatedPattern![12]).toBe(128);
      expect(isolatedPattern![15]).toBe(128);

      // Center should be bright (255)
      expect(isolatedPattern![5]).toBe(255);
      expect(isolatedPattern![6]).toBe(255);
      expect(isolatedPattern![9]).toBe(255);
      expect(isolatedPattern![10]).toBe(255);
    });

    it('should generate correct all-neighbors-visible pattern', () => {
      const patterns = sdfRenderer.generateAAPatterns();
      const allNeighborsPattern = patterns.get(15); // 0b1111 = all neighbors

      expect(allNeighborsPattern).toBeDefined();

      // All values should be 255 (fully visible)
      for (const value of allNeighborsPattern!) {
        expect(value).toBe(255);
      }
    });
  });

  describe('upscaling', () => {
    it('should upscale visibility mask with patterns', () => {
      const mask = new Float32Array(defaultConfig.gridWidth * defaultConfig.gridHeight);

      // Create simple pattern
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          mask[y * defaultConfig.gridWidth + x] = 1.0;
        }
      }

      const scale = 4;
      const upscaled = sdfRenderer.upscaleWithPatterns(mask, scale);

      const expectedWidth = defaultConfig.gridWidth * scale;
      const expectedHeight = defaultConfig.gridHeight * scale;

      expect(upscaled.length).toBe(expectedWidth * expectedHeight);
    });

    it('should create zero values for fog areas', () => {
      const mask = new Float32Array(defaultConfig.gridWidth * defaultConfig.gridHeight);
      // All zeros (fog)

      const upscaled = sdfRenderer.upscaleWithPatterns(mask, 4);

      // All values should be 0
      for (const value of upscaled) {
        expect(value).toBe(0);
      }
    });

    it('should create upscaled texture', () => {
      const mask = new Float32Array(defaultConfig.gridWidth * defaultConfig.gridHeight);
      mask.fill(1.0);

      const texture = sdfRenderer.createUpscaledTexture('player1', mask, 4);

      expect(texture.image.width).toBe(defaultConfig.gridWidth * 4);
      expect(texture.image.height).toBe(defaultConfig.gridHeight * 4);
    });
  });

  describe('reinitialize', () => {
    it('should clear textures on reinitialize', () => {
      sdfRenderer.getSDFTexture('player1');
      sdfRenderer.getSDFTexture('player2');

      sdfRenderer.reinitialize(defaultConfig);

      // Old textures should be disposed, new ones created on demand
      // This tests that reinitialize doesn't throw
      const newTexture = sdfRenderer.getSDFTexture('player1');
      expect(newTexture).toBeDefined();
    });

    it('should update grid dimensions on reinitialize', () => {
      const newConfig = {
        ...defaultConfig,
        gridWidth: 32,
        gridHeight: 32,
      };

      sdfRenderer.reinitialize(newConfig);

      const texture = sdfRenderer.getSDFTexture('player1');
      expect(texture.image.width).toBe(32);
      expect(texture.image.height).toBe(32);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      sdfRenderer.getSDFTexture('player1');
      sdfRenderer.getSDFTexture('player2');

      // Should not throw
      sdfRenderer.dispose();
    });
  });
});
