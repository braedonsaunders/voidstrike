/**
 * LineOfSight - Terrain-aware line of sight blocking for fog of war
 *
 * Industry-standard LOS systems from StarCraft 2, Age of Empires, etc:
 * 1. Height advantage: Units on high ground see down, low ground can't see up
 * 2. Ray-based blocking: Trace rays from caster to cells, block at terrain
 * 3. Shadowcasting: Efficient octant-based visibility calculation
 *
 * This module implements height-based LOS blocking using Bresenham's line algorithm
 * with terrain height sampling along the ray.
 */

import { debugPathfinding } from '@/utils/debugLogger';
import { deterministicMagnitude } from '@/utils/FixedPoint';

export interface LOSConfig {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  mapWidth: number;
  mapHeight: number;
  // Height difference threshold to block LOS (in world units)
  // Terrain must be at least this much higher to block vision
  losBlockingThreshold: number;
}

export type HeightProvider = (worldX: number, worldY: number) => number;

/**
 * LineOfSight calculates terrain-aware visibility.
 *
 * Algorithm: For each cell in sight range, trace a ray from caster to cell.
 * If any terrain along the ray is higher than the sight line, block vision.
 *
 * The sight line is calculated with a small upward offset to allow looking
 * slightly over terrain (simulating unit eye height).
 */
export class LineOfSight {
  private config: LOSConfig;
  private getHeight: HeightProvider | null = null;

  // Cache for LOS calculations to avoid redundant traces
  private losCache: Map<string, boolean> = new Map();
  private losCacheVersion: number = 0;

  // Pre-computed values
  private halfCellSize: number;

  constructor(config: LOSConfig) {
    this.config = config;
    this.halfCellSize = config.cellSize / 2;
    debugPathfinding.log(`[LineOfSight] Initialized with threshold ${config.losBlockingThreshold}`);
  }

  /**
   * Set the height provider function (from Terrain)
   */
  public setHeightProvider(provider: HeightProvider): void {
    this.getHeight = provider;
    this.invalidateCache();
  }

  /**
   * Invalidate the LOS cache (call when terrain changes)
   */
  public invalidateCache(): void {
    this.losCacheVersion++;
    this.losCache.clear();
  }

  /**
   * Check if there's line of sight from caster position to target cell
   *
   * @param casterX Caster world X
   * @param casterY Caster world Y (game coordinate = depth/north-south)
   * @param casterHeight Height at caster position
   * @param targetCellX Target cell X
   * @param targetCellY Target cell Y
   * @param sightRange Caster's sight range (for height advantage calculation)
   * @returns true if LOS is clear, false if blocked
   */
  public hasLineOfSight(
    casterX: number,
    casterY: number,
    casterHeight: number,
    targetCellX: number,
    targetCellY: number,
    sightRange: number
  ): boolean {
    if (!this.getHeight) {
      // No height provider - assume clear LOS (fallback behavior)
      return true;
    }

    // Calculate target world position (cell center)
    const targetX = (targetCellX + 0.5) * this.config.cellSize;
    const targetY = (targetCellY + 0.5) * this.config.cellSize;

    // Check cache
    const cacheKey = this.getCacheKey(casterX, casterY, targetCellX, targetCellY);
    const cached = this.losCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Get target height
    const targetHeight = this.getHeight(targetX, targetY);

    // Calculate sight line with eye height offset
    // Caster "eye" is slightly above terrain to allow looking over small bumps
    const eyeHeightOffset = 0.5; // Half unit above terrain
    const casterEyeHeight = casterHeight + eyeHeightOffset;

    // Trace ray using Bresenham's algorithm
    const result = this.traceRay(
      casterX,
      casterY,
      casterEyeHeight,
      targetX,
      targetY,
      targetHeight,
      sightRange
    );

    // Cache result
    this.losCache.set(cacheKey, result);

    return result;
  }

  /**
   * Trace a ray from caster to target, checking terrain heights along the way
   */
  private traceRay(
    startX: number,
    startY: number,
    startHeight: number,
    endX: number,
    endY: number,
    endHeight: number,
    _sightRange: number
  ): boolean {
    if (!this.getHeight) return true;

    const dx = endX - startX;
    const dy = endY - startY;
    const distance = deterministicMagnitude(dx, dy);

    if (distance < this.config.cellSize) {
      // Target is in same or adjacent cell - always visible
      return true;
    }

    // Number of samples along the ray (at least 1 per cell)
    const numSamples = Math.max(4, Math.ceil(distance / this.config.cellSize));
    const stepX = dx / numSamples;
    const stepY = dy / numSamples;
    const heightStep = (endHeight - startHeight) / numSamples;

    // Get caster's ground level height (eye height minus offset)
    // Terrain at or below caster's ground can't block their vision (high ground advantage)
    const eyeHeightOffset = 0.5;
    const casterGroundHeight = startHeight - eyeHeightOffset;

    // Sample terrain along the ray
    for (let i = 1; i < numSamples; i++) {
      const sampleX = startX + stepX * i;
      const sampleY = startY + stepY * i;
      const sightLineHeight = startHeight + heightStep * i;

      // Get terrain height at this sample point
      const terrainHeight = this.getHeight(sampleX, sampleY);

      // High ground advantage: terrain at or below caster's level can't block their vision
      // This allows units on high ground to see down without their own terrain blocking them
      if (terrainHeight <= casterGroundHeight) {
        continue;
      }

      // Check if terrain blocks the sight line
      // Terrain blocks if it's higher than the sight line by the threshold
      if (terrainHeight > sightLineHeight + this.config.losBlockingThreshold) {
        return false; // LOS blocked
      }
    }

    return true; // LOS clear
  }

  /**
   * Check LOS for all cells in sight range and return visible cells
   * This is the main entry point for visibility calculation
   */
  public getVisibleCells(casterX: number, casterY: number, sightRange: number): Set<number> {
    const visibleCells = new Set<number>();

    if (!this.getHeight) {
      // No height provider - return all cells in range (fallback)
      return this.getAllCellsInRange(casterX, casterY, sightRange);
    }

    const casterCellX = Math.floor(casterX / this.config.cellSize);
    const casterCellY = Math.floor(casterY / this.config.cellSize);
    const cellRange = Math.ceil(sightRange / this.config.cellSize);
    const cellRangeSq = cellRange * cellRange;

    // Get caster height
    const casterHeight = this.getHeight(casterX, casterY);

    // Check all cells in sight range
    for (let dy = -cellRange; dy <= cellRange; dy++) {
      for (let dx = -cellRange; dx <= cellRange; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq > cellRangeSq) continue;

        const targetCellX = casterCellX + dx;
        const targetCellY = casterCellY + dy;

        // Bounds check
        if (
          targetCellX < 0 ||
          targetCellX >= this.config.gridWidth ||
          targetCellY < 0 ||
          targetCellY >= this.config.gridHeight
        ) {
          continue;
        }

        // Check LOS
        if (
          this.hasLineOfSight(casterX, casterY, casterHeight, targetCellX, targetCellY, sightRange)
        ) {
          visibleCells.add(targetCellY * this.config.gridWidth + targetCellX);
        }
      }
    }

    return visibleCells;
  }

  /**
   * Get all cells in range (no LOS blocking - fallback)
   */
  private getAllCellsInRange(casterX: number, casterY: number, sightRange: number): Set<number> {
    const visibleCells = new Set<number>();
    const casterCellX = Math.floor(casterX / this.config.cellSize);
    const casterCellY = Math.floor(casterY / this.config.cellSize);
    const cellRange = Math.ceil(sightRange / this.config.cellSize);
    const cellRangeSq = cellRange * cellRange;

    for (let dy = -cellRange; dy <= cellRange; dy++) {
      for (let dx = -cellRange; dx <= cellRange; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq > cellRangeSq) continue;

        const targetCellX = casterCellX + dx;
        const targetCellY = casterCellY + dy;

        if (
          targetCellX >= 0 &&
          targetCellX < this.config.gridWidth &&
          targetCellY >= 0 &&
          targetCellY < this.config.gridHeight
        ) {
          visibleCells.add(targetCellY * this.config.gridWidth + targetCellX);
        }
      }
    }

    return visibleCells;
  }

  /**
   * Generate cache key for LOS lookup
   */
  private getCacheKey(
    casterX: number,
    casterY: number,
    targetCellX: number,
    targetCellY: number
  ): string {
    // Round caster position to cell precision for cache efficiency
    const casterCellX = Math.floor(casterX / this.config.cellSize);
    const casterCellY = Math.floor(casterY / this.config.cellSize);
    return `${this.losCacheVersion}:${casterCellX},${casterCellY}:${targetCellX},${targetCellY}`;
  }

  /**
   * Update configuration
   */
  public reinitialize(config: LOSConfig): void {
    this.config = config;
    this.halfCellSize = config.cellSize / 2;
    this.invalidateCache();
  }

  /**
   * Get config
   */
  public getConfig(): LOSConfig {
    return this.config;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.losCache.clear();
    this.getHeight = null;
  }
}
