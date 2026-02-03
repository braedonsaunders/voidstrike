/**
 * SDFVisionRenderer - Signed Distance Field based fog of war edge rendering
 *
 * Industry technique for smooth fog edges:
 * 1. Store distance to nearest visible cell instead of binary visible/not
 * 2. Enables smooth edges without expensive blur
 * 3. Can render soft shadows at fog boundaries
 * 4. Used in modern RTS games for high-quality fog edges
 *
 * SDF Benefits:
 * - Resolution-independent smooth edges
 * - Efficient GPU sampling (no blur kernel)
 * - Natural anti-aliasing at boundaries
 * - Easy to animate (add noise to distance)
 */

import * as THREE from 'three';
import { debugShaders } from '@/utils/debugLogger';

export interface SDFVisionConfig {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  // Max distance to propagate SDF (in cells)
  maxDistance: number;
  // Edge softness (0-1, how much to smooth edges)
  edgeSoftness: number;
}

/**
 * SDFVisionRenderer generates a signed distance field from binary visibility data.
 *
 * The SDF stores the distance to the nearest visibility boundary:
 * - Positive values: inside visible area, distance to edge
 * - Negative values: inside fog, distance to visible edge
 * - Zero: exactly on the boundary
 *
 * This enables smooth edge rendering without expensive per-pixel blur.
 */
export class SDFVisionRenderer {
  private config: SDFVisionConfig;

  // SDF textures per player
  private sdfTextures: Map<string, THREE.DataTexture> = new Map();
  private sdfData: Map<string, Float32Array> = new Map();

  // Temporary buffers for distance transform
  private tempBuffer1: Float32Array;
  private tempBuffer2: Float32Array;

  constructor(config: SDFVisionConfig) {
    this.config = config;
    const size = config.gridWidth * config.gridHeight;
    this.tempBuffer1 = new Float32Array(size);
    this.tempBuffer2 = new Float32Array(size);

    debugShaders.log(`[SDFVisionRenderer] Initialized ${config.gridWidth}x${config.gridHeight}`);
  }

  /**
   * Get or create SDF texture for a player
   */
  public getSDFTexture(playerId: string): THREE.DataTexture {
    let tex = this.sdfTextures.get(playerId);
    if (!tex) {
      const data = new Float32Array(this.config.gridWidth * this.config.gridHeight);
      this.sdfData.set(playerId, data);

      tex = new THREE.DataTexture(
        data,
        this.config.gridWidth,
        this.config.gridHeight,
        THREE.RedFormat,
        THREE.FloatType
      );
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;

      this.sdfTextures.set(playerId, tex);
    }
    return tex;
  }

  /**
   * Update SDF from binary visibility data
   *
   * Computes distance to the visibility boundary using a two-pass distance transform:
   * 1. Forward pass: propagate distance left-to-right, top-to-bottom
   * 2. Backward pass: propagate distance right-to-left, bottom-to-top
   *
   * The result is a signed distance field where:
   * - Values > 0.5 are inside visible area (farther from edge = higher value)
   * - Values < 0.5 are inside fog area (farther from edge = lower value)
   * - Value = 0.5 is exactly on the boundary
   *
   * @param playerId Player ID
   * @param visibilityMask Binary visibility data (0 = fog, 1 = visible)
   */
  public updateSDF(playerId: string, visibilityMask: Float32Array): void {
    // Ensure texture exists
    this.getSDFTexture(playerId);

    const sdf = this.sdfData.get(playerId)!;
    const width = this.config.gridWidth;
    const height = this.config.gridHeight;
    const maxDist = this.config.maxDistance;

    // Find boundary cells (visible cells adjacent to fog cells)
    // Initialize: boundary cells = 0, all others = large value
    for (let i = 0; i < sdf.length; i++) {
      sdf[i] = maxDist * 2;
    }

    // Mark boundary cells as 0 (they are on the edge)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const isVisible = visibilityMask[idx] > 0.5;

        // Check if this cell is on the boundary (visible cell adjacent to fog)
        let isBoundary = false;
        if (isVisible) {
          // Check 4 neighbors for fog
          if (x > 0 && visibilityMask[idx - 1] <= 0.5) isBoundary = true;
          if (x < width - 1 && visibilityMask[idx + 1] <= 0.5) isBoundary = true;
          if (y > 0 && visibilityMask[idx - width] <= 0.5) isBoundary = true;
          if (y < height - 1 && visibilityMask[idx + width] <= 0.5) isBoundary = true;
        } else {
          // Check 4 neighbors for visible
          if (x > 0 && visibilityMask[idx - 1] > 0.5) isBoundary = true;
          if (x < width - 1 && visibilityMask[idx + 1] > 0.5) isBoundary = true;
          if (y > 0 && visibilityMask[idx - width] > 0.5) isBoundary = true;
          if (y < height - 1 && visibilityMask[idx + width] > 0.5) isBoundary = true;
        }

        if (isBoundary) {
          sdf[idx] = 0;
        }
      }
    }

    // Forward pass (left-to-right, top-to-bottom)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        if (x > 0) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx - 1] + 1);
        }
        if (y > 0) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx - width] + 1);
        }
        // Diagonal
        if (x > 0 && y > 0) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx - width - 1] + 1.414);
        }
        if (x < width - 1 && y > 0) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx - width + 1] + 1.414);
        }
      }
    }

    // Backward pass (right-to-left, bottom-to-top)
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = y * width + x;

        if (x < width - 1) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx + 1] + 1);
        }
        if (y < height - 1) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx + width] + 1);
        }
        // Diagonal
        if (x < width - 1 && y < height - 1) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx + width + 1] + 1.414);
        }
        if (x > 0 && y < height - 1) {
          sdf[idx] = Math.min(sdf[idx], sdf[idx + width - 1] + 1.414);
        }
      }
    }

    // Convert to signed distance normalized to 0-1 range
    // 0.5 = boundary, >0.5 = inside visible (high = far from edge), <0.5 = inside fog
    for (let i = 0; i < sdf.length; i++) {
      const dist = sdf[i];
      const isVisible = visibilityMask[i] > 0.5;

      // Normalize distance to 0-0.5 range
      const normalizedDist = (Math.min(dist, maxDist) / maxDist) * 0.5;
      sdf[i] = isVisible ? 0.5 + normalizedDist : 0.5 - normalizedDist;
    }

    // Mark texture for GPU upload
    const tex = this.sdfTextures.get(playerId);
    if (tex) {
      tex.needsUpdate = true;
    }
  }

  /**
   * Generate pattern-based AA edges (League of Legends technique)
   *
   * LoL uses 16 unique transition patterns for edge anti-aliasing:
   * Each edge cell is expanded to a 4x4 block with gray "anti-aliasing" pixels
   * based on neighbor configuration.
   *
   * This method generates those patterns for upscaling from 128x128 to 512x512.
   */
  public generateAAPatterns(): Map<number, Uint8Array> {
    const patterns = new Map<number, Uint8Array>();

    // 16 patterns based on 4-neighbor configuration (N, S, E, W)
    // Each pattern is a 4x4 block (16 values, 0-255)
    const basePatterns: Record<number, number[]> = {
      // 0b0000: Isolated visible cell
      0: [128, 192, 192, 128, 192, 255, 255, 192, 192, 255, 255, 192, 128, 192, 192, 128],
      // 0b0001: North neighbor visible
      1: [255, 255, 255, 255, 192, 255, 255, 192, 192, 255, 255, 192, 128, 192, 192, 128],
      // 0b0010: South neighbor visible
      2: [128, 192, 192, 128, 192, 255, 255, 192, 192, 255, 255, 192, 255, 255, 255, 255],
      // 0b0011: North and South visible
      3: [255, 255, 255, 255, 192, 255, 255, 192, 192, 255, 255, 192, 255, 255, 255, 255],
      // 0b0100: East neighbor visible
      4: [128, 192, 255, 255, 192, 255, 255, 255, 192, 255, 255, 255, 128, 192, 255, 255],
      // 0b0101: North and East visible
      5: [255, 255, 255, 255, 192, 255, 255, 255, 192, 255, 255, 255, 128, 192, 255, 255],
      // 0b0110: South and East visible
      6: [128, 192, 255, 255, 192, 255, 255, 255, 192, 255, 255, 255, 255, 255, 255, 255],
      // 0b0111: North, South, East visible
      7: [255, 255, 255, 255, 192, 255, 255, 255, 192, 255, 255, 255, 255, 255, 255, 255],
      // 0b1000: West neighbor visible
      8: [255, 255, 192, 128, 255, 255, 255, 192, 255, 255, 255, 192, 255, 255, 192, 128],
      // 0b1001: North and West visible
      9: [255, 255, 255, 255, 255, 255, 255, 192, 255, 255, 255, 192, 255, 255, 192, 128],
      // 0b1010: South and West visible
      10: [255, 255, 192, 128, 255, 255, 255, 192, 255, 255, 255, 192, 255, 255, 255, 255],
      // 0b1011: North, South, West visible
      11: [255, 255, 255, 255, 255, 255, 255, 192, 255, 255, 255, 192, 255, 255, 255, 255],
      // 0b1100: East and West visible
      12: [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
      // 0b1101: North, East, West visible
      13: [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
      // 0b1110: South, East, West visible
      14: [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
      // 0b1111: All neighbors visible
      15: [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    };

    for (const [key, pattern] of Object.entries(basePatterns)) {
      patterns.set(parseInt(key), new Uint8Array(pattern));
    }

    return patterns;
  }

  /**
   * Upscale visibility texture with pattern-based AA (LoL technique)
   *
   * @param inputMask Input visibility mask (gridWidth x gridHeight)
   * @param scale Upscale factor (e.g., 4 for 128→512)
   * @returns Upscaled texture data
   */
  public upscaleWithPatterns(inputMask: Float32Array, scale: number = 4): Uint8Array {
    const patterns = this.generateAAPatterns();
    const outWidth = this.config.gridWidth * scale;
    const outHeight = this.config.gridHeight * scale;
    const output = new Uint8Array(outWidth * outHeight);

    for (let y = 0; y < this.config.gridHeight; y++) {
      for (let x = 0; x < this.config.gridWidth; x++) {
        const idx = y * this.config.gridWidth + x;
        const isVisible = inputMask[idx] > 0.5;

        if (!isVisible) {
          // Fog cell - fill with zeros
          for (let py = 0; py < scale; py++) {
            for (let px = 0; px < scale; px++) {
              const outX = x * scale + px;
              const outY = y * scale + py;
              output[outY * outWidth + outX] = 0;
            }
          }
          continue;
        }

        // Determine neighbor configuration
        let config = 0;

        // North
        if (y > 0 && inputMask[(y - 1) * this.config.gridWidth + x] > 0.5) {
          config |= 0b0001;
        }
        // South
        if (
          y < this.config.gridHeight - 1 &&
          inputMask[(y + 1) * this.config.gridWidth + x] > 0.5
        ) {
          config |= 0b0010;
        }
        // East
        if (x < this.config.gridWidth - 1 && inputMask[y * this.config.gridWidth + (x + 1)] > 0.5) {
          config |= 0b0100;
        }
        // West
        if (x > 0 && inputMask[y * this.config.gridWidth + (x - 1)] > 0.5) {
          config |= 0b1000;
        }

        // Get pattern
        const pattern = patterns.get(config) || patterns.get(15)!;

        // Apply pattern
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const outX = x * scale + px;
            const outY = y * scale + py;
            const patternIdx = py * scale + px;
            output[outY * outWidth + outX] = pattern[patternIdx] || 255;
          }
        }
      }
    }

    return output;
  }

  /**
   * Create upscaled texture with pattern-based AA
   */
  public createUpscaledTexture(
    playerId: string,
    inputMask: Float32Array,
    scale: number = 4
  ): THREE.DataTexture {
    const upscaled = this.upscaleWithPatterns(inputMask, scale);
    const outWidth = this.config.gridWidth * scale;
    const outHeight = this.config.gridHeight * scale;

    const tex = new THREE.DataTexture(
      upscaled,
      outWidth,
      outHeight,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;

    return tex;
  }

  /**
   * Get edge blend factor for smooth transitions
   * Uses SDF to calculate how close to edge a point is
   *
   * @param x Grid X coordinate
   * @param y Grid Y coordinate
   * @param playerId Player ID
   * @returns Edge factor 0-1 (0 = solid fog/visible, 1 = on edge)
   */
  public getEdgeFactor(x: number, y: number, playerId: string): number {
    const data = this.sdfData.get(playerId);
    if (!data) return 0;

    const idx = y * this.config.gridWidth + x;
    const sdfValue = data[idx];

    // SDF value of 0.5 = on edge
    // Distance from 0.5 determines how far from edge
    const distFromEdge = Math.abs(sdfValue - 0.5);

    // Convert to edge factor (closer to edge = higher factor)
    const edgeFactor = 1 - Math.min((distFromEdge * 2) / this.config.edgeSoftness, 1);

    return edgeFactor;
  }

  /**
   * Reinitialize with new configuration
   */
  public reinitialize(config: SDFVisionConfig): void {
    this.config = config;
    const size = config.gridWidth * config.gridHeight;
    this.tempBuffer1 = new Float32Array(size);
    this.tempBuffer2 = new Float32Array(size);

    // Clear existing textures
    for (const tex of this.sdfTextures.values()) {
      tex.dispose();
    }
    this.sdfTextures.clear();
    this.sdfData.clear();
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    for (const tex of this.sdfTextures.values()) {
      tex.dispose();
    }
    this.sdfTextures.clear();
    this.sdfData.clear();
  }
}
