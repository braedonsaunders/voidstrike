/**
 * SpatialGrid - High-Performance Spatial Partitioning
 *
 * Optimized for large unit counts (500+) with:
 * - Flat array storage instead of Maps for O(1) direct indexing
 * - Hierarchical grid (fine + coarse) for multi-scale queries
 * - Inline entity data to avoid entity lookups in hot paths
 * - Pre-allocated buffers to eliminate GC pressure
 *
 * IMPORTANT: This grid uses ENTITY INDEX (bounded) for array storage,
 * not full EntityId. With generational IDs, the index portion is bounded
 * (0 to maxTotalEntities-1), allowing fixed-size array allocation.
 * Callers should pass getEntityIndex(entityId) for the id parameter.
 *
 * Complexity:
 * - Insert/Update: O(cells_touched) where cells_touched ≈ 1-4 typically
 * - Query: O(cells_in_radius × avg_entities_per_cell)
 * - With coarse grid: O(coarse_cells) for large radius queries
 */

import { getEntityIndex } from '../ecs/EntityId';

/** Unit state enum for inline storage - must match Unit component states */
export const enum SpatialUnitState {
  Idle = 0,
  Moving = 1,
  Attacking = 2,
  AttackMoving = 3,
  Gathering = 4,
  Building = 5,
  Patrolling = 6,
  Dead = 7,
  HoldingPosition = 8,
}

/** Map string state to enum for fast storage */
export function stateToEnum(state: string): SpatialUnitState {
  switch (state) {
    case 'idle': return SpatialUnitState.Idle;
    case 'moving': return SpatialUnitState.Moving;
    case 'attacking': return SpatialUnitState.Attacking;
    case 'attackmoving': return SpatialUnitState.AttackMoving;
    case 'gathering': return SpatialUnitState.Gathering;
    case 'building': return SpatialUnitState.Building;
    case 'patrolling': return SpatialUnitState.Patrolling;
    case 'dead': return SpatialUnitState.Dead;
    default: return SpatialUnitState.Idle;
  }
}

/**
 * Inline entity data stored directly in the grid.
 * Avoids entity.get() lookups in hot steering/combat paths.
 */
export interface SpatialEntityData {
  id: number;
  x: number;
  y: number;
  radius: number;
  // Inline unit data - eliminates entity lookups in hot paths
  isFlying: boolean;
  state: SpatialUnitState;
  playerId: number;  // Numeric player ID for fast comparison (0 = no player)
  collisionRadius: number;
  isWorker: boolean;
  maxSpeed: number;
}

/** Configuration for grid sizing */
interface GridConfig {
  mapWidth: number;
  mapHeight: number;
  fineCellSize: number;
  coarseCellSize: number;
  maxEntitiesPerCell: number;
  maxTotalEntities: number;
}

const DEFAULT_CONFIG: GridConfig = {
  mapWidth: 200,
  mapHeight: 200,
  fineCellSize: 8,
  coarseCellSize: 32,  // 4x fine cells
  maxEntitiesPerCell: 64,
  maxTotalEntities: 4096,
};

/**
 * High-performance spatial grid with hierarchical structure and inline data.
 */
export class SpatialGrid {
  // Grid dimensions
  private readonly width: number;
  private readonly height: number;
  private readonly fineCellSize: number;
  private readonly coarseCellSize: number;
  private readonly fineCols: number;
  private readonly fineRows: number;
  private readonly coarseCols: number;
  private readonly coarseRows: number;

  // Configuration
  private readonly maxEntitiesPerCell: number;
  private readonly maxTotalEntities: number;

  // Fine grid: flat arrays for direct indexing
  // Cell layout: cells[cellIndex * maxEntitiesPerCell + slot] = entityId
  private readonly fineCells: Int32Array;
  private readonly fineCellCounts: Uint8Array;

  // Coarse grid: for large radius queries
  private readonly coarseCells: Int32Array;
  private readonly coarseCellCounts: Uint16Array;

  // Entity data: indexed by entity ID for O(1) lookup
  // Using typed arrays for cache-friendly access
  private readonly entityX: Float32Array;
  private readonly entityY: Float32Array;
  private readonly entityRadius: Float32Array;
  private readonly entityCollisionRadius: Float32Array;
  private readonly entityMaxSpeed: Float32Array;
  private readonly entityFlags: Uint8Array;  // Packed: bit0=exists, bit1=isFlying, bit2=isWorker
  private readonly entityState: Uint8Array;
  private readonly entityPlayerId: Uint16Array;

  // Track which cells each entity occupies (for removal)
  // entityCells[entityId * 4 + i] = cellIndex (-1 = unused)
  private readonly entityFineCells: Int32Array;
  private readonly entityCoarseCells: Int32Array;

  // Entity existence tracking
  private readonly entityExists: Uint8Array;
  private entityCount: number = 0;

  // PERF: Pre-allocated query buffers
  private readonly _queryResults: number[] = [];
  private readonly _queryResultsData: SpatialEntityData[] = [];
  private readonly _querySeen: Uint8Array;
  private readonly _cellBuffer: number[] = [];
  private readonly _entityDataBuffer: SpatialEntityData;

  // Coarse cell to fine cell mapping for hierarchical queries
  private readonly finesPerCoarse: number;

  constructor(mapWidth: number = 200, mapHeight: number = 200, cellSize: number = 8) {
    const config: GridConfig = {
      ...DEFAULT_CONFIG,
      mapWidth,
      mapHeight,
      fineCellSize: cellSize,
      coarseCellSize: cellSize * 4,
    };

    this.width = config.mapWidth;
    this.height = config.mapHeight;
    this.fineCellSize = config.fineCellSize;
    this.coarseCellSize = config.coarseCellSize;
    this.maxEntitiesPerCell = config.maxEntitiesPerCell;
    this.maxTotalEntities = config.maxTotalEntities;

    // Calculate grid dimensions
    this.fineCols = Math.ceil(this.width / this.fineCellSize);
    this.fineRows = Math.ceil(this.height / this.fineCellSize);
    this.coarseCols = Math.ceil(this.width / this.coarseCellSize);
    this.coarseRows = Math.ceil(this.height / this.coarseCellSize);
    this.finesPerCoarse = Math.ceil(this.coarseCellSize / this.fineCellSize);

    const fineCellCount = this.fineCols * this.fineRows;
    const coarseCellCount = this.coarseCols * this.coarseRows;

    // Allocate fine grid storage
    this.fineCells = new Int32Array(fineCellCount * this.maxEntitiesPerCell);
    this.fineCells.fill(-1);
    this.fineCellCounts = new Uint8Array(fineCellCount);

    // Allocate coarse grid storage (larger capacity per cell)
    const coarseCapacity = this.maxEntitiesPerCell * 4;
    this.coarseCells = new Int32Array(coarseCellCount * coarseCapacity);
    this.coarseCells.fill(-1);
    this.coarseCellCounts = new Uint16Array(coarseCellCount);

    // Allocate entity data arrays (Structure of Arrays for cache efficiency)
    this.entityX = new Float32Array(this.maxTotalEntities);
    this.entityY = new Float32Array(this.maxTotalEntities);
    this.entityRadius = new Float32Array(this.maxTotalEntities);
    this.entityCollisionRadius = new Float32Array(this.maxTotalEntities);
    this.entityMaxSpeed = new Float32Array(this.maxTotalEntities);
    this.entityFlags = new Uint8Array(this.maxTotalEntities);
    this.entityState = new Uint8Array(this.maxTotalEntities);
    this.entityPlayerId = new Uint16Array(this.maxTotalEntities);
    this.entityExists = new Uint8Array(this.maxTotalEntities);

    // Track cells per entity (max 4 fine cells, 4 coarse cells)
    this.entityFineCells = new Int32Array(this.maxTotalEntities * 4);
    this.entityFineCells.fill(-1);
    this.entityCoarseCells = new Int32Array(this.maxTotalEntities * 4);
    this.entityCoarseCells.fill(-1);

    // Query buffers
    this._querySeen = new Uint8Array(this.maxTotalEntities);
    this._entityDataBuffer = {
      id: 0, x: 0, y: 0, radius: 0,
      isFlying: false, state: SpatialUnitState.Idle, playerId: 0,
      collisionRadius: 0, isWorker: false, maxSpeed: 0,
    };

    // Pre-allocate result data objects
    for (let i = 0; i < 256; i++) {
      this._queryResultsData.push({
        id: 0, x: 0, y: 0, radius: 0,
        isFlying: false, state: SpatialUnitState.Idle, playerId: 0,
        collisionRadius: 0, isWorker: false, maxSpeed: 0,
      });
    }
  }

  /**
   * Get fine cell index for a position
   */
  private getFineCell(x: number, y: number): number {
    const col = Math.floor(Math.max(0, Math.min(x, this.width - 0.001)) / this.fineCellSize);
    const row = Math.floor(Math.max(0, Math.min(y, this.height - 0.001)) / this.fineCellSize);
    return row * this.fineCols + col;
  }

  /**
   * Get coarse cell index for a position
   */
  private getCoarseCell(x: number, y: number): number {
    const col = Math.floor(Math.max(0, Math.min(x, this.width - 0.001)) / this.coarseCellSize);
    const row = Math.floor(Math.max(0, Math.min(y, this.height - 0.001)) / this.coarseCellSize);
    return row * this.coarseCols + col;
  }

  /**
   * Get all fine cell indices touched by an entity (based on position + radius)
   */
  private getFineCellsForEntity(x: number, y: number, radius: number, out: number[]): void {
    out.length = 0;

    const minCol = Math.floor(Math.max(0, x - radius) / this.fineCellSize);
    const maxCol = Math.floor(Math.min(this.width - 0.001, x + radius) / this.fineCellSize);
    const minRow = Math.floor(Math.max(0, y - radius) / this.fineCellSize);
    const maxRow = Math.floor(Math.min(this.height - 0.001, y + radius) / this.fineCellSize);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        out.push(row * this.fineCols + col);
      }
    }
  }

  /**
   * Get all coarse cell indices touched by an entity
   */
  private getCoarseCellsForEntity(x: number, y: number, radius: number, out: number[]): void {
    out.length = 0;

    const minCol = Math.floor(Math.max(0, x - radius) / this.coarseCellSize);
    const maxCol = Math.floor(Math.min(this.width - 0.001, x + radius) / this.coarseCellSize);
    const minRow = Math.floor(Math.max(0, y - radius) / this.coarseCellSize);
    const maxRow = Math.floor(Math.min(this.height - 0.001, y + radius) / this.coarseCellSize);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        out.push(row * this.coarseCols + col);
      }
    }
  }

  /**
   * Add entity to a fine cell
   */
  private addToFineCell(cellIndex: number, entityId: number): boolean {
    const count = this.fineCellCounts[cellIndex];
    if (count >= this.maxEntitiesPerCell) {
      return false; // Cell full
    }

    const baseIndex = cellIndex * this.maxEntitiesPerCell;
    this.fineCells[baseIndex + count] = entityId;
    this.fineCellCounts[cellIndex] = count + 1;
    return true;
  }

  /**
   * Remove entity from a fine cell
   */
  private removeFromFineCell(cellIndex: number, entityId: number): void {
    const count = this.fineCellCounts[cellIndex];
    const baseIndex = cellIndex * this.maxEntitiesPerCell;

    for (let i = 0; i < count; i++) {
      if (this.fineCells[baseIndex + i] === entityId) {
        // Swap with last element
        this.fineCells[baseIndex + i] = this.fineCells[baseIndex + count - 1];
        this.fineCells[baseIndex + count - 1] = -1;
        this.fineCellCounts[cellIndex] = count - 1;
        return;
      }
    }
  }

  /**
   * Add entity to a coarse cell
   */
  private addToCoarseCell(cellIndex: number, entityId: number): boolean {
    const count = this.coarseCellCounts[cellIndex];
    const capacity = this.maxEntitiesPerCell * 4;
    if (count >= capacity) {
      return false;
    }

    const baseIndex = cellIndex * capacity;
    this.coarseCells[baseIndex + count] = entityId;
    this.coarseCellCounts[cellIndex] = count + 1;
    return true;
  }

  /**
   * Remove entity from a coarse cell
   */
  private removeFromCoarseCell(cellIndex: number, entityId: number): void {
    const count = this.coarseCellCounts[cellIndex];
    const capacity = this.maxEntitiesPerCell * 4;
    const baseIndex = cellIndex * capacity;

    for (let i = 0; i < count; i++) {
      if (this.coarseCells[baseIndex + i] === entityId) {
        this.coarseCells[baseIndex + i] = this.coarseCells[baseIndex + count - 1];
        this.coarseCells[baseIndex + count - 1] = -1;
        this.coarseCellCounts[cellIndex] = count - 1;
        return;
      }
    }
  }

  /**
   * Insert or update an entity in the grid.
   * Basic version - for backwards compatibility with existing code.
   */
  public update(id: number, x: number, y: number, radius: number = 1): void {
    this.updateFull(id, x, y, radius, false, SpatialUnitState.Idle, 0, radius, false, 0);
  }

  /**
   * Full update with inline unit data.
   * Use this for optimal performance - avoids entity lookups later.
   *
   * @param id Entity ID or index. With generational IDs, extracts index automatically.
   */
  public updateFull(
    id: number,
    x: number,
    y: number,
    radius: number,
    isFlying: boolean,
    state: SpatialUnitState,
    playerId: number,
    collisionRadius: number,
    isWorker: boolean,
    maxSpeed: number
  ): void {
    // Extract index from EntityId (handles both raw index and generational ID)
    const idx = getEntityIndex(id);

    if (idx >= this.maxTotalEntities) {
      console.warn(`SpatialGrid: Entity index ${idx} exceeds max ${this.maxTotalEntities}`);
      return;
    }

    // Remove from old cells if entity exists
    if (this.entityExists[idx]) {
      // Remove from fine cells
      const fineBase = idx * 4;
      for (let i = 0; i < 4; i++) {
        const cellIndex = this.entityFineCells[fineBase + i];
        if (cellIndex >= 0) {
          this.removeFromFineCell(cellIndex, idx);
          this.entityFineCells[fineBase + i] = -1;
        }
      }

      // Remove from coarse cells
      const coarseBase = idx * 4;
      for (let i = 0; i < 4; i++) {
        const cellIndex = this.entityCoarseCells[coarseBase + i];
        if (cellIndex >= 0) {
          this.removeFromCoarseCell(cellIndex, idx);
          this.entityCoarseCells[coarseBase + i] = -1;
        }
      }
    } else {
      this.entityCount++;
    }

    // Update entity data (SoA) - all indexed by entity index
    this.entityX[idx] = x;
    this.entityY[idx] = y;
    this.entityRadius[idx] = radius;
    this.entityCollisionRadius[idx] = collisionRadius;
    this.entityMaxSpeed[idx] = maxSpeed;
    this.entityState[idx] = state;
    this.entityPlayerId[idx] = playerId;

    // Pack flags: bit0=exists, bit1=isFlying, bit2=isWorker
    let flags = 1; // exists
    if (isFlying) flags |= 2;
    if (isWorker) flags |= 4;
    this.entityFlags[idx] = flags;
    this.entityExists[idx] = 1;

    // Add to new fine cells (store index in cells)
    this._cellBuffer.length = 0;
    this.getFineCellsForEntity(x, y, radius, this._cellBuffer);
    const fineBase = idx * 4;
    for (let i = 0; i < this._cellBuffer.length && i < 4; i++) {
      const cellIndex = this._cellBuffer[i];
      this.addToFineCell(cellIndex, idx);
      this.entityFineCells[fineBase + i] = cellIndex;
    }

    // Add to new coarse cells (store index in cells)
    this._cellBuffer.length = 0;
    this.getCoarseCellsForEntity(x, y, radius, this._cellBuffer);
    const coarseBase = idx * 4;
    for (let i = 0; i < this._cellBuffer.length && i < 4; i++) {
      const cellIndex = this._cellBuffer[i];
      this.addToCoarseCell(cellIndex, idx);
      this.entityCoarseCells[coarseBase + i] = cellIndex;
    }
  }

  /**
   * Update only position (fast path when other data hasn't changed).
   * Returns true if the cell assignment changed.
   */
  public updatePosition(id: number, x: number, y: number): boolean {
    const idx = getEntityIndex(id);
    if (idx >= this.maxTotalEntities || !this.entityExists[idx]) {
      return false;
    }

    const oldX = this.entityX[idx];
    const oldY = this.entityY[idx];
    const radius = this.entityRadius[idx];

    // Check if cell assignment would change
    const oldFineCell = this.getFineCell(oldX, oldY);
    const newFineCell = this.getFineCell(x, y);

    if (oldFineCell === newFineCell) {
      // Same cell - just update position data
      this.entityX[idx] = x;
      this.entityY[idx] = y;
      return false;
    }

    // Cell changed - full update needed
    this.updateFull(
      idx, x, y, radius,
      (this.entityFlags[idx] & 2) !== 0,  // isFlying
      this.entityState[idx],
      this.entityPlayerId[idx],
      this.entityCollisionRadius[idx],
      (this.entityFlags[idx] & 4) !== 0,  // isWorker
      this.entityMaxSpeed[idx]
    );
    return true;
  }

  /**
   * Update only the state (no spatial update needed)
   */
  public updateState(id: number, state: SpatialUnitState): void {
    const idx = getEntityIndex(id);
    if (idx < this.maxTotalEntities && this.entityExists[idx]) {
      this.entityState[idx] = state;
    }
  }

  /**
   * Remove an entity from the grid
   */
  public remove(id: number): void {
    const idx = getEntityIndex(id);
    if (idx >= this.maxTotalEntities || !this.entityExists[idx]) {
      return;
    }

    // Remove from fine cells
    const fineBase = idx * 4;
    for (let i = 0; i < 4; i++) {
      const cellIndex = this.entityFineCells[fineBase + i];
      if (cellIndex >= 0) {
        this.removeFromFineCell(cellIndex, idx);
        this.entityFineCells[fineBase + i] = -1;
      }
    }

    // Remove from coarse cells
    const coarseBase = idx * 4;
    for (let i = 0; i < 4; i++) {
      const cellIndex = this.entityCoarseCells[coarseBase + i];
      if (cellIndex >= 0) {
        this.removeFromCoarseCell(cellIndex, idx);
        this.entityCoarseCells[coarseBase + i] = -1;
      }
    }

    // Clear entity data
    this.entityExists[idx] = 0;
    this.entityFlags[idx] = 0;
    this.entityCount--;
  }

  /**
   * Query all entities within a radius of a point.
   * Returns entity IDs only (for backwards compatibility).
   */
  public queryRadius(x: number, y: number, radius: number, out?: number[]): number[] {
    // Clear seen flags for entities we might encounter
    // Only clear the ones we actually check (faster than clearing all)
    const resultArray = out || this._queryResults;
    resultArray.length = 0;

    // Determine grid to use based on query radius
    const useCoarse = radius > this.fineCellSize * 2;

    if (useCoarse) {
      return this.queryRadiusCoarse(x, y, radius, resultArray);
    } else {
      return this.queryRadiusFine(x, y, radius, resultArray);
    }
  }

  /**
   * Query using fine grid (small radius)
   */
  private queryRadiusFine(x: number, y: number, radius: number, out: number[]): number[] {
    this._cellBuffer.length = 0;
    this.getFineCellsForEntity(x, y, radius, this._cellBuffer);

    const radiusSq = radius * radius;
    const seenReset: number[] = [];

    for (let c = 0; c < this._cellBuffer.length; c++) {
      const cellIndex = this._cellBuffer[c];
      const count = this.fineCellCounts[cellIndex];
      const baseIndex = cellIndex * this.maxEntitiesPerCell;

      for (let i = 0; i < count; i++) {
        const entityId = this.fineCells[baseIndex + i];
        if (entityId < 0 || this._querySeen[entityId]) continue;

        this._querySeen[entityId] = 1;
        seenReset.push(entityId);

        // Distance check with entity radius
        const ex = this.entityX[entityId];
        const ey = this.entityY[entityId];
        const dx = ex - x;
        const dy = ey - y;
        const distSq = dx * dx + dy * dy;
        const combinedRadius = radius + this.entityRadius[entityId];

        if (distSq <= combinedRadius * combinedRadius) {
          out.push(entityId);
        }
      }
    }

    // Reset seen flags
    for (let i = 0; i < seenReset.length; i++) {
      this._querySeen[seenReset[i]] = 0;
    }

    return out;
  }

  /**
   * Query using coarse grid (large radius) - faster for big searches
   */
  private queryRadiusCoarse(x: number, y: number, radius: number, out: number[]): number[] {
    this._cellBuffer.length = 0;
    this.getCoarseCellsForEntity(x, y, radius, this._cellBuffer);

    const radiusSq = radius * radius;
    const capacity = this.maxEntitiesPerCell * 4;
    const seenReset: number[] = [];

    for (let c = 0; c < this._cellBuffer.length; c++) {
      const cellIndex = this._cellBuffer[c];
      const count = this.coarseCellCounts[cellIndex];
      const baseIndex = cellIndex * capacity;

      for (let i = 0; i < count; i++) {
        const entityId = this.coarseCells[baseIndex + i];
        if (entityId < 0 || this._querySeen[entityId]) continue;

        this._querySeen[entityId] = 1;
        seenReset.push(entityId);

        // Distance check
        const ex = this.entityX[entityId];
        const ey = this.entityY[entityId];
        const dx = ex - x;
        const dy = ey - y;
        const distSq = dx * dx + dy * dy;
        const combinedRadius = radius + this.entityRadius[entityId];

        if (distSq <= combinedRadius * combinedRadius) {
          out.push(entityId);
        }
      }
    }

    // Reset seen flags
    for (let i = 0; i < seenReset.length; i++) {
      this._querySeen[seenReset[i]] = 0;
    }

    return out;
  }

  /**
   * Query with full entity data returned - avoids entity lookups in caller.
   * This is the optimized path for steering forces and combat.
   */
  public queryRadiusWithData(
    x: number,
    y: number,
    radius: number,
    out?: SpatialEntityData[]
  ): SpatialEntityData[] {
    const resultArray = out || this._queryResultsData;
    let resultCount = 0;

    this._cellBuffer.length = 0;

    // Choose grid based on radius
    const useCoarse = radius > this.fineCellSize * 2;
    const seenReset: number[] = [];

    if (useCoarse) {
      this.getCoarseCellsForEntity(x, y, radius, this._cellBuffer);
      const capacity = this.maxEntitiesPerCell * 4;

      for (let c = 0; c < this._cellBuffer.length; c++) {
        const cellIndex = this._cellBuffer[c];
        const count = this.coarseCellCounts[cellIndex];
        const baseIndex = cellIndex * capacity;

        for (let i = 0; i < count; i++) {
          const entityId = this.coarseCells[baseIndex + i];
          if (entityId < 0 || this._querySeen[entityId]) continue;

          this._querySeen[entityId] = 1;
          seenReset.push(entityId);

          const ex = this.entityX[entityId];
          const ey = this.entityY[entityId];
          const dx = ex - x;
          const dy = ey - y;
          const distSq = dx * dx + dy * dy;
          const combinedRadius = radius + this.entityRadius[entityId];

          if (distSq <= combinedRadius * combinedRadius) {
            // Ensure buffer has space - expand if needed
            if (resultCount >= resultArray.length) {
              resultArray.push({
                id: 0, x: 0, y: 0, radius: 0,
                isFlying: false, state: SpatialUnitState.Idle, playerId: 0,
                collisionRadius: 0, isWorker: false, maxSpeed: 0,
              });
            }
            this.fillEntityData(entityId, resultArray[resultCount]);
            resultCount++;
          }
        }
      }
    } else {
      this.getFineCellsForEntity(x, y, radius, this._cellBuffer);

      for (let c = 0; c < this._cellBuffer.length; c++) {
        const cellIndex = this._cellBuffer[c];
        const count = this.fineCellCounts[cellIndex];
        const baseIndex = cellIndex * this.maxEntitiesPerCell;

        for (let i = 0; i < count; i++) {
          const entityId = this.fineCells[baseIndex + i];
          if (entityId < 0 || this._querySeen[entityId]) continue;

          this._querySeen[entityId] = 1;
          seenReset.push(entityId);

          const ex = this.entityX[entityId];
          const ey = this.entityY[entityId];
          const dx = ex - x;
          const dy = ey - y;
          const distSq = dx * dx + dy * dy;
          const combinedRadius = radius + this.entityRadius[entityId];

          if (distSq <= combinedRadius * combinedRadius) {
            // Ensure buffer has space - expand if needed
            if (resultCount >= resultArray.length) {
              resultArray.push({
                id: 0, x: 0, y: 0, radius: 0,
                isFlying: false, state: SpatialUnitState.Idle, playerId: 0,
                collisionRadius: 0, isWorker: false, maxSpeed: 0,
              });
            }
            this.fillEntityData(entityId, resultArray[resultCount]);
            resultCount++;
          }
        }
      }
    }

    // Reset seen flags
    for (let i = 0; i < seenReset.length; i++) {
      this._querySeen[seenReset[i]] = 0;
    }

    // Trim result array
    resultArray.length = resultCount;
    return resultArray;
  }

  /**
   * Fill entity data from typed arrays into object
   */
  private fillEntityData(id: number, out: SpatialEntityData): void {
    out.id = id;
    out.x = this.entityX[id];
    out.y = this.entityY[id];
    out.radius = this.entityRadius[id];
    out.collisionRadius = this.entityCollisionRadius[id];
    out.maxSpeed = this.entityMaxSpeed[id];
    out.state = this.entityState[id];
    out.playerId = this.entityPlayerId[id];

    const flags = this.entityFlags[id];
    out.isFlying = (flags & 2) !== 0;
    out.isWorker = (flags & 4) !== 0;
  }

  /**
   * Get inline entity data by ID (O(1) lookup)
   */
  public getEntityData(id: number): SpatialEntityData | null {
    const idx = getEntityIndex(id);
    if (idx >= this.maxTotalEntities || !this.entityExists[idx]) {
      return null;
    }

    this.fillEntityData(idx, this._entityDataBuffer);
    return this._entityDataBuffer;
  }

  /**
   * Get entity position (for backwards compatibility)
   */
  public getEntityPosition(id: number): { x: number; y: number; radius: number } | null {
    const idx = getEntityIndex(id);
    if (idx >= this.maxTotalEntities || !this.entityExists[idx]) {
      return null;
    }

    return {
      x: this.entityX[idx],
      y: this.entityY[idx],
      radius: this.entityRadius[idx],
    };
  }

  /**
   * Check if entity exists in grid
   */
  public has(id: number): boolean {
    const idx = getEntityIndex(id);
    return idx < this.maxTotalEntities && this.entityExists[idx] === 1;
  }

  /**
   * Query all entities within an AABB (axis-aligned bounding box)
   */
  public queryRect(minX: number, minY: number, maxX: number, maxY: number, out?: number[]): number[] {
    const resultArray = out || this._queryResults;
    resultArray.length = 0;

    const minCol = Math.floor(Math.max(0, minX) / this.fineCellSize);
    const maxCol = Math.floor(Math.min(this.width - 0.001, maxX) / this.fineCellSize);
    const minRow = Math.floor(Math.max(0, minY) / this.fineCellSize);
    const maxRow = Math.floor(Math.min(this.height - 0.001, maxY) / this.fineCellSize);

    const seenReset: number[] = [];

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cellIndex = row * this.fineCols + col;
        const count = this.fineCellCounts[cellIndex];
        const baseIndex = cellIndex * this.maxEntitiesPerCell;

        for (let i = 0; i < count; i++) {
          const entityId = this.fineCells[baseIndex + i];
          if (entityId < 0 || this._querySeen[entityId]) continue;

          this._querySeen[entityId] = 1;
          seenReset.push(entityId);

          const ex = this.entityX[entityId];
          const ey = this.entityY[entityId];
          const er = this.entityRadius[entityId];

          // Check if entity overlaps with rect
          if (ex + er >= minX && ex - er <= maxX &&
              ey + er >= minY && ey - er <= maxY) {
            resultArray.push(entityId);
          }
        }
      }
    }

    // Reset seen flags
    for (let i = 0; i < seenReset.length; i++) {
      this._querySeen[seenReset[i]] = 0;
    }

    return resultArray;
  }

  /**
   * Get entities in specific cell(s) for combat zone detection.
   * Returns entity counts per player for fast friend/foe detection.
   */
  public getCellPlayerCounts(x: number, y: number): Map<number, number> {
    const counts = new Map<number, number>();
    const cellIndex = this.getFineCell(x, y);
    const count = this.fineCellCounts[cellIndex];
    const baseIndex = cellIndex * this.maxEntitiesPerCell;

    for (let i = 0; i < count; i++) {
      const entityId = this.fineCells[baseIndex + i];
      if (entityId < 0) continue;

      const playerId = this.entityPlayerId[entityId];
      counts.set(playerId, (counts.get(playerId) || 0) + 1);
    }

    return counts;
  }

  /**
   * Check if any enemy exists in radius (fast path for combat zone detection)
   */
  public hasEnemyInRadius(x: number, y: number, radius: number, myPlayerId: number): boolean {
    this._cellBuffer.length = 0;

    const useCoarse = radius > this.fineCellSize * 2;

    if (useCoarse) {
      this.getCoarseCellsForEntity(x, y, radius, this._cellBuffer);
      const capacity = this.maxEntitiesPerCell * 4;

      for (let c = 0; c < this._cellBuffer.length; c++) {
        const cellIndex = this._cellBuffer[c];
        const count = this.coarseCellCounts[cellIndex];
        const baseIndex = cellIndex * capacity;

        for (let i = 0; i < count; i++) {
          const entityId = this.coarseCells[baseIndex + i];
          if (entityId < 0) continue;

          // Skip if same player or no player
          const playerId = this.entityPlayerId[entityId];
          if (playerId === myPlayerId || playerId === 0) continue;

          // Skip dead entities
          if (this.entityState[entityId] === SpatialUnitState.Dead) continue;

          // Distance check
          const ex = this.entityX[entityId];
          const ey = this.entityY[entityId];
          const dx = ex - x;
          const dy = ey - y;
          const distSq = dx * dx + dy * dy;
          const combinedRadius = radius + this.entityRadius[entityId];

          if (distSq <= combinedRadius * combinedRadius) {
            return true;
          }
        }
      }
    } else {
      this.getFineCellsForEntity(x, y, radius, this._cellBuffer);

      for (let c = 0; c < this._cellBuffer.length; c++) {
        const cellIndex = this._cellBuffer[c];
        const count = this.fineCellCounts[cellIndex];
        const baseIndex = cellIndex * this.maxEntitiesPerCell;

        for (let i = 0; i < count; i++) {
          const entityId = this.fineCells[baseIndex + i];
          if (entityId < 0) continue;

          const playerId = this.entityPlayerId[entityId];
          if (playerId === myPlayerId || playerId === 0) continue;
          if (this.entityState[entityId] === SpatialUnitState.Dead) continue;

          const ex = this.entityX[entityId];
          const ey = this.entityY[entityId];
          const dx = ex - x;
          const dy = ey - y;
          const distSq = dx * dx + dy * dy;
          const combinedRadius = radius + this.entityRadius[entityId];

          if (distSq <= combinedRadius * combinedRadius) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Mark cells as "hot" (contain units from multiple players)
   * Returns set of hot cell indices for combat zone optimization
   */
  public getHotCells(): Set<number> {
    const hotCells = new Set<number>();
    const cellPlayers = new Map<number, Set<number>>();

    // Iterate all fine cells
    for (let cellIndex = 0; cellIndex < this.fineCols * this.fineRows; cellIndex++) {
      const count = this.fineCellCounts[cellIndex];
      if (count === 0) continue;

      const baseIndex = cellIndex * this.maxEntitiesPerCell;
      const players = new Set<number>();

      for (let i = 0; i < count; i++) {
        const entityId = this.fineCells[baseIndex + i];
        if (entityId < 0) continue;

        const playerId = this.entityPlayerId[entityId];
        if (playerId > 0 && this.entityState[entityId] !== SpatialUnitState.Dead) {
          players.add(playerId);
        }
      }

      // Cell is hot if multiple players have units in it
      if (players.size > 1) {
        hotCells.add(cellIndex);
        // Also mark adjacent cells as hot
        const col = cellIndex % this.fineCols;
        const row = Math.floor(cellIndex / this.fineCols);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nc = col + dx;
            const nr = row + dy;
            if (nc >= 0 && nc < this.fineCols && nr >= 0 && nr < this.fineRows) {
              hotCells.add(nr * this.fineCols + nc);
            }
          }
        }
      }
    }

    return hotCells;
  }

  /**
   * Check if position is in a hot cell
   */
  public isInHotCell(x: number, y: number, hotCells: Set<number>): boolean {
    const cellIndex = this.getFineCell(x, y);
    return hotCells.has(cellIndex);
  }

  /**
   * Clear all entities
   */
  public clear(): void {
    this.fineCells.fill(-1);
    this.fineCellCounts.fill(0);
    this.coarseCells.fill(-1);
    this.coarseCellCounts.fill(0);
    this.entityExists.fill(0);
    this.entityFlags.fill(0);
    this.entityFineCells.fill(-1);
    this.entityCoarseCells.fill(-1);
    this.entityCount = 0;
  }

  /**
   * Get stats for debugging
   */
  public getStats(): { entityCount: number; cellCount: number; avgEntitiesPerCell: number } {
    let activeCells = 0;
    let totalInCells = 0;

    for (let i = 0; i < this.fineCols * this.fineRows; i++) {
      if (this.fineCellCounts[i] > 0) {
        activeCells++;
        totalInCells += this.fineCellCounts[i];
      }
    }

    return {
      entityCount: this.entityCount,
      cellCount: activeCells,
      avgEntitiesPerCell: activeCells > 0 ? totalInCells / activeCells : 0,
    };
  }

  /**
   * Get grid dimensions for external use
   */
  public getGridInfo(): {
    width: number;
    height: number;
    fineCellSize: number;
    coarseCellSize: number;
    fineCols: number;
    fineRows: number;
  } {
    return {
      width: this.width,
      height: this.height,
      fineCellSize: this.fineCellSize,
      coarseCellSize: this.coarseCellSize,
      fineCols: this.fineCols,
      fineRows: this.fineRows,
    };
  }
}
