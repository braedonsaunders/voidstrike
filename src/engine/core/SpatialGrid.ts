/**
 * SpatialGrid - Spatial partitioning for O(1) entity lookups
 *
 * Divides the map into cells and stores entity references.
 * Instead of checking all entities (O(n²)), we only check entities in nearby cells (O(1) average).
 */

interface SpatialEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export class SpatialGrid {
  private cellSize: number;
  private width: number;
  private height: number;
  private cols: number;
  private rows: number;

  // Grid cells: Map<cellIndex, Set<entityId>>
  private cells: Map<number, Set<number>> = new Map();

  // Entity positions: Map<entityId, {x, y, radius}>
  private entities: Map<number, SpatialEntity> = new Map();

  // PERF: Pre-allocated reusable arrays to avoid GC pressure from per-frame allocations
  private readonly _queryResults: number[] = [];
  private readonly _querySeen: Set<number> = new Set();
  private readonly _occupiedCells: number[] = [];
  private readonly _tempOccupiedCells: number[] = []; // For update() which needs two arrays

  constructor(mapWidth: number, mapHeight: number, cellSize: number = 8) {
    this.width = mapWidth;
    this.height = mapHeight;
    this.cellSize = cellSize;
    this.cols = Math.ceil(mapWidth / cellSize);
    this.rows = Math.ceil(mapHeight / cellSize);
  }

  /**
   * Get the cell index for a position
   */
  private getCellIndex(x: number, y: number): number {
    const col = Math.floor(Math.max(0, Math.min(x, this.width - 1)) / this.cellSize);
    const row = Math.floor(Math.max(0, Math.min(y, this.height - 1)) / this.cellSize);
    return row * this.cols + col;
  }

  /**
   * Get all cell indices that an entity occupies (based on position + radius)
   * PERF: Uses provided output array to avoid allocations
   */
  private getOccupiedCellsInto(x: number, y: number, radius: number, out: number[]): void {
    out.length = 0;

    const minCol = Math.floor(Math.max(0, x - radius) / this.cellSize);
    const maxCol = Math.floor(Math.min(this.width - 1, x + radius) / this.cellSize);
    const minRow = Math.floor(Math.max(0, y - radius) / this.cellSize);
    const maxRow = Math.floor(Math.min(this.height - 1, y + radius) / this.cellSize);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        out.push(row * this.cols + col);
      }
    }
  }

  /**
   * Insert or update an entity in the grid
   */
  public update(id: number, x: number, y: number, radius: number = 1): void {
    // Remove from old cells if exists
    const existing = this.entities.get(id);
    if (existing) {
      // PERF: Reuse pre-allocated array
      this._tempOccupiedCells.length = 0;
      this.getOccupiedCellsInto(existing.x, existing.y, existing.radius, this._tempOccupiedCells);
      for (let i = 0; i < this._tempOccupiedCells.length; i++) {
        this.cells.get(this._tempOccupiedCells[i])?.delete(id);
      }
    }

    // Add to new cells - PERF: Reuse pre-allocated array
    this._occupiedCells.length = 0;
    this.getOccupiedCellsInto(x, y, radius, this._occupiedCells);
    for (let i = 0; i < this._occupiedCells.length; i++) {
      const cellIndex = this._occupiedCells[i];
      if (!this.cells.has(cellIndex)) {
        this.cells.set(cellIndex, new Set());
      }
      this.cells.get(cellIndex)!.add(id);
    }

    // Update entity record - reuse existing object if possible
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.radius = radius;
    } else {
      this.entities.set(id, { id, x, y, radius });
    }
  }

  /**
   * Remove an entity from the grid
   */
  public remove(id: number): void {
    const existing = this.entities.get(id);
    if (existing) {
      // PERF: Reuse pre-allocated array
      this._occupiedCells.length = 0;
      this.getOccupiedCellsInto(existing.x, existing.y, existing.radius, this._occupiedCells);
      for (let i = 0; i < this._occupiedCells.length; i++) {
        this.cells.get(this._occupiedCells[i])?.delete(id);
      }
      this.entities.delete(id);
    }
  }

  /**
   * Query all entities within a radius of a point
   * Returns entity IDs - caller must look up actual entities
   * PERF: Reuses pre-allocated arrays to avoid GC pressure
   */
  public queryRadius(x: number, y: number, radius: number): number[] {
    // PERF: Reuse pre-allocated arrays instead of creating new ones every call
    this._queryResults.length = 0;
    this._querySeen.clear();
    this._occupiedCells.length = 0;
    this.getOccupiedCellsInto(x, y, radius, this._occupiedCells);

    for (let i = 0; i < this._occupiedCells.length; i++) {
      const cellEntities = this.cells.get(this._occupiedCells[i]);
      if (!cellEntities) continue;

      for (const entityId of cellEntities) {
        if (this._querySeen.has(entityId)) continue;
        this._querySeen.add(entityId);

        const entity = this.entities.get(entityId);
        if (!entity) continue;

        // Actual distance check
        const dx = entity.x - x;
        const dy = entity.y - y;
        const distSq = dx * dx + dy * dy;
        const combinedRadius = radius + entity.radius;

        if (distSq <= combinedRadius * combinedRadius) {
          this._queryResults.push(entityId);
        }
      }
    }

    return this._queryResults;
  }

  /**
   * Query all entities within an AABB (axis-aligned bounding box)
   * PERF: Reuses pre-allocated arrays to avoid GC pressure
   */
  public queryRect(minX: number, minY: number, maxX: number, maxY: number): number[] {
    // PERF: Reuse pre-allocated arrays
    this._queryResults.length = 0;
    this._querySeen.clear();

    const minCol = Math.floor(Math.max(0, minX) / this.cellSize);
    const maxCol = Math.floor(Math.min(this.width - 1, maxX) / this.cellSize);
    const minRow = Math.floor(Math.max(0, minY) / this.cellSize);
    const maxRow = Math.floor(Math.min(this.height - 1, maxY) / this.cellSize);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cellIndex = row * this.cols + col;
        const cellEntities = this.cells.get(cellIndex);
        if (!cellEntities) continue;

        for (const entityId of cellEntities) {
          if (this._querySeen.has(entityId)) continue;
          this._querySeen.add(entityId);

          const entity = this.entities.get(entityId);
          if (!entity) continue;

          // Check if entity overlaps with rect
          if (entity.x + entity.radius >= minX &&
              entity.x - entity.radius <= maxX &&
              entity.y + entity.radius >= minY &&
              entity.y - entity.radius <= maxY) {
            this._queryResults.push(entityId);
          }
        }
      }
    }

    return this._queryResults;
  }

  /**
   * Get entity position (for external use)
   */
  public getEntityPosition(id: number): { x: number; y: number; radius: number } | null {
    return this.entities.get(id) || null;
  }

  /**
   * Clear all entities
   */
  public clear(): void {
    this.cells.clear();
    this.entities.clear();
  }

  /**
   * Get stats for debugging
   */
  public getStats(): { entityCount: number; cellCount: number; avgEntitiesPerCell: number } {
    let totalEntities = 0;
    let cellCount = 0;

    for (const cell of this.cells.values()) {
      if (cell.size > 0) {
        cellCount++;
        totalEntities += cell.size;
      }
    }

    return {
      entityCount: this.entities.size,
      cellCount,
      avgEntitiesPerCell: cellCount > 0 ? totalEntities / cellCount : 0,
    };
  }
}
