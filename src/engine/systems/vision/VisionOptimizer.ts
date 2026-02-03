/**
 * VisionOptimizer - Reference counting and cell boundary tracking for fog of war
 *
 * Industry-standard optimizations used by StarCraft 2, League of Legends, etc:
 * 1. Reference counting: Track how many units can see each cell
 * 2. Cell boundary detection: Only update when units cross cell boundaries
 * 3. Incremental updates: Only process cells affected by moved units
 *
 * Performance impact: O(casters × cells) → O(moved_units × affected_cells)
 */

import { debugPathfinding } from '@/utils/debugLogger';

export interface VisionCasterState {
  entityId: number;
  playerId: string;
  x: number;
  y: number;
  sightRange: number;
  // Cell position (for boundary detection)
  cellX: number;
  cellY: number;
  // Previously visible cells for this caster
  visibleCells: Set<number>;
}

export interface CellReferenceCount {
  // How many casters can see this cell per player
  // Map<playerId, count>
  refCounts: Map<string, number>;
  // Last tick this cell was visible (for explored state persistence)
  lastVisibleTick: Map<string, number>;
}

export interface VisionOptimizerConfig {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  mapWidth: number;
  mapHeight: number;
}

/**
 * VisionOptimizer tracks vision state efficiently using reference counting.
 *
 * Key insight from industry research:
 * - Static units = zero vision processing
 * - Moving units only update their affected cells
 * - O(1) visibility check instead of O(casters)
 */
export class VisionOptimizer {
  private config: VisionOptimizerConfig;

  // Caster tracking
  private casters: Map<number, VisionCasterState> = new Map();

  // Reference counting per cell
  // Key: cellY * gridWidth + cellX (numeric for performance)
  private cellRefCounts: Map<number, CellReferenceCount> = new Map();

  // Dirty cells that need GPU update this frame
  private dirtyCells: Set<number> = new Set();

  // Players with dirty vision state
  private dirtyPlayers: Set<string> = new Set();

  // Current game tick for explored state tracking
  private currentTick: number = 0;

  // Pre-computed sight range to cell set mapping for common ranges
  private sightRangeCache: Map<number, Set<{ dx: number; dy: number }>> = new Map();

  constructor(config: VisionOptimizerConfig) {
    this.config = config;
    this.precomputeSightRanges();
    debugPathfinding.log(`[VisionOptimizer] Initialized ${config.gridWidth}x${config.gridHeight} grid`);
  }

  /**
   * Pre-compute cell offsets for common sight ranges (optimization)
   */
  private precomputeSightRanges(): void {
    // Pre-compute for sight ranges 1-20 (covers most units)
    for (let range = 1; range <= 20; range++) {
      const cells = new Set<{ dx: number; dy: number }>();
      const cellRange = Math.ceil(range / this.config.cellSize);
      const cellRangeSq = cellRange * cellRange;

      for (let dy = -cellRange; dy <= cellRange; dy++) {
        for (let dx = -cellRange; dx <= cellRange; dx++) {
          const distSq = dx * dx + dy * dy;
          if (distSq <= cellRangeSq) {
            cells.add({ dx, dy });
          }
        }
      }
      this.sightRangeCache.set(range, cells);
    }
  }

  /**
   * Get cells visible from a position with given sight range
   */
  private getCellsInRange(
    cellX: number,
    cellY: number,
    sightRange: number
  ): Set<number> {
    const result = new Set<number>();
    const cellRange = Math.ceil(sightRange / this.config.cellSize);
    const cellRangeSq = cellRange * cellRange;

    // Use pre-computed offsets if available
    const cached = this.sightRangeCache.get(Math.ceil(sightRange));
    if (cached) {
      for (const { dx, dy } of cached) {
        const x = cellX + dx;
        const y = cellY + dy;
        if (x >= 0 && x < this.config.gridWidth && y >= 0 && y < this.config.gridHeight) {
          result.add(y * this.config.gridWidth + x);
        }
      }
    } else {
      // Fallback for unusual ranges
      for (let dy = -cellRange; dy <= cellRange; dy++) {
        for (let dx = -cellRange; dx <= cellRange; dx++) {
          const distSq = dx * dx + dy * dy;
          if (distSq <= cellRangeSq) {
            const x = cellX + dx;
            const y = cellY + dy;
            if (x >= 0 && x < this.config.gridWidth && y >= 0 && y < this.config.gridHeight) {
              result.add(y * this.config.gridWidth + x);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * World position to cell position
   */
  private worldToCell(worldX: number, worldY: number): { cellX: number; cellY: number } {
    return {
      cellX: Math.floor(worldX / this.config.cellSize),
      cellY: Math.floor(worldY / this.config.cellSize),
    };
  }

  /**
   * Register or update a vision caster (unit/building)
   * Returns true if the caster crossed a cell boundary (vision needs update)
   */
  public updateCaster(
    entityId: number,
    playerId: string,
    worldX: number,
    worldY: number,
    sightRange: number
  ): boolean {
    const { cellX, cellY } = this.worldToCell(worldX, worldY);

    const existing = this.casters.get(entityId);
    if (existing) {
      // Check if caster crossed cell boundary
      if (existing.cellX === cellX && existing.cellY === cellY) {
        // Same cell - update position but no vision recalc needed
        existing.x = worldX;
        existing.y = worldY;
        return false;
      }

      // Crossed boundary - need to update vision
      this.decrementCasterVision(existing);

      // Update caster state
      existing.x = worldX;
      existing.y = worldY;
      existing.cellX = cellX;
      existing.cellY = cellY;
      existing.sightRange = sightRange;

      this.incrementCasterVision(existing);
      this.dirtyPlayers.add(playerId);
      return true;
    } else {
      // New caster
      const newCaster: VisionCasterState = {
        entityId,
        playerId,
        x: worldX,
        y: worldY,
        sightRange,
        cellX,
        cellY,
        visibleCells: new Set(),
      };

      this.casters.set(entityId, newCaster);
      this.incrementCasterVision(newCaster);
      this.dirtyPlayers.add(playerId);
      return true;
    }
  }

  /**
   * Remove a caster (unit died or building destroyed)
   */
  public removeCaster(entityId: number): void {
    const caster = this.casters.get(entityId);
    if (!caster) return;

    this.decrementCasterVision(caster);
    this.dirtyPlayers.add(caster.playerId);
    this.casters.delete(entityId);
  }

  /**
   * Increment reference counts for cells visible by this caster
   */
  private incrementCasterVision(caster: VisionCasterState): void {
    const visibleCells = this.getCellsInRange(caster.cellX, caster.cellY, caster.sightRange);

    for (const cellKey of visibleCells) {
      let cellRef = this.cellRefCounts.get(cellKey);
      if (!cellRef) {
        cellRef = {
          refCounts: new Map(),
          lastVisibleTick: new Map(),
        };
        this.cellRefCounts.set(cellKey, cellRef);
      }

      const currentCount = cellRef.refCounts.get(caster.playerId) || 0;
      cellRef.refCounts.set(caster.playerId, currentCount + 1);
      cellRef.lastVisibleTick.set(caster.playerId, this.currentTick);

      this.dirtyCells.add(cellKey);
      caster.visibleCells.add(cellKey);
    }
  }

  /**
   * Decrement reference counts for cells visible by this caster
   */
  private decrementCasterVision(caster: VisionCasterState): void {
    for (const cellKey of caster.visibleCells) {
      const cellRef = this.cellRefCounts.get(cellKey);
      if (!cellRef) continue;

      const currentCount = cellRef.refCounts.get(caster.playerId) || 0;
      if (currentCount <= 1) {
        cellRef.refCounts.delete(caster.playerId);
      } else {
        cellRef.refCounts.set(caster.playerId, currentCount - 1);
      }

      this.dirtyCells.add(cellKey);
    }

    caster.visibleCells.clear();
  }

  /**
   * Check if a cell is currently visible to a player
   * O(1) lookup thanks to reference counting
   */
  public isCellVisible(cellX: number, cellY: number, playerId: string): boolean {
    const cellKey = cellY * this.config.gridWidth + cellX;
    const cellRef = this.cellRefCounts.get(cellKey);
    if (!cellRef) return false;

    return (cellRef.refCounts.get(playerId) || 0) > 0;
  }

  /**
   * Check if a cell was ever explored by a player
   */
  public isCellExplored(cellX: number, cellY: number, playerId: string): boolean {
    const cellKey = cellY * this.config.gridWidth + cellX;
    const cellRef = this.cellRefCounts.get(cellKey);
    if (!cellRef) return false;

    return cellRef.lastVisibleTick.has(playerId);
  }

  /**
   * Get visibility state for a cell
   */
  public getCellVisionState(
    cellX: number,
    cellY: number,
    playerId: string
  ): 'unexplored' | 'explored' | 'visible' {
    if (this.isCellVisible(cellX, cellY, playerId)) return 'visible';
    if (this.isCellExplored(cellX, cellY, playerId)) return 'explored';
    return 'unexplored';
  }

  /**
   * Get all dirty cells since last clear
   */
  public getDirtyCells(): Set<number> {
    return this.dirtyCells;
  }

  /**
   * Get players with dirty vision state
   */
  public getDirtyPlayers(): Set<string> {
    return this.dirtyPlayers;
  }

  /**
   * Clear dirty state after GPU update
   */
  public clearDirtyState(): void {
    this.dirtyCells.clear();
    this.dirtyPlayers.clear();
  }

  /**
   * Set current tick for explored state tracking
   */
  public setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  /**
   * Get visibility data for GPU upload (optimized for incremental updates)
   * Returns only dirty cells if incremental, or full grid if not
   */
  public getVisibilityData(playerId: string, incremental: boolean = false): {
    cells: Array<{ x: number; y: number; visible: number; explored: number }>;
    isDirty: boolean;
  } {
    const isDirty = this.dirtyPlayers.has(playerId);

    if (incremental && !isDirty) {
      return { cells: [], isDirty: false };
    }

    const cells: Array<{ x: number; y: number; visible: number; explored: number }> = [];

    if (incremental) {
      // Only return dirty cells
      for (const cellKey of this.dirtyCells) {
        const x = cellKey % this.config.gridWidth;
        const y = Math.floor(cellKey / this.config.gridWidth);
        const state = this.getCellVisionState(x, y, playerId);

        cells.push({
          x,
          y,
          visible: state === 'visible' ? 1 : 0,
          explored: state !== 'unexplored' ? 1 : 0,
        });
      }
    } else {
      // Return full grid
      for (let y = 0; y < this.config.gridHeight; y++) {
        for (let x = 0; x < this.config.gridWidth; x++) {
          const state = this.getCellVisionState(x, y, playerId);
          cells.push({
            x,
            y,
            visible: state === 'visible' ? 1 : 0,
            explored: state !== 'unexplored' ? 1 : 0,
          });
        }
      }
    }

    return { cells, isDirty };
  }

  /**
   * Get full visibility mask as Float32Array for GPU texture upload
   * Format: 0 = unexplored, 0.5 = explored, 1.0 = visible
   */
  public getVisibilityMask(playerId: string): Float32Array {
    const mask = new Float32Array(this.config.gridWidth * this.config.gridHeight);

    for (let y = 0; y < this.config.gridHeight; y++) {
      for (let x = 0; x < this.config.gridWidth; x++) {
        const idx = y * this.config.gridWidth + x;
        const state = this.getCellVisionState(x, y, playerId);

        mask[idx] = state === 'visible' ? 1.0 : state === 'explored' ? 0.5 : 0.0;
      }
    }

    return mask;
  }

  /**
   * Get statistics for debugging
   */
  public getStats(): {
    totalCasters: number;
    totalTrackedCells: number;
    dirtyCells: number;
    dirtyPlayers: number;
  } {
    return {
      totalCasters: this.casters.size,
      totalTrackedCells: this.cellRefCounts.size,
      dirtyCells: this.dirtyCells.size,
      dirtyPlayers: this.dirtyPlayers.size,
    };
  }

  /**
   * Reinitialize with new config
   */
  public reinitialize(config: VisionOptimizerConfig): void {
    this.config = config;
    this.casters.clear();
    this.cellRefCounts.clear();
    this.dirtyCells.clear();
    this.dirtyPlayers.clear();
    this.sightRangeCache.clear();
    this.precomputeSightRanges();
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.casters.clear();
    this.cellRefCounts.clear();
    this.dirtyCells.clear();
    this.dirtyPlayers.clear();
    this.sightRangeCache.clear();
  }
}
