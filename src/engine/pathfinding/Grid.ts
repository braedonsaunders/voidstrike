import { EntityId } from '../ecs/Entity';

interface GridCell {
  entities: Set<EntityId>;
  walkable: boolean;
}

/**
 * Spatial grid for pathfinding entity tracking
 * PERF: Uses numeric keys (cellY * cols + cellX) instead of string keys to avoid GC pressure
 */
export class SpatialGrid {
  private grid: Map<number, GridCell> = new Map();
  private cellSize: number;
  private width: number;
  private height: number;
  private cols: number; // Number of columns in the grid

  // PERF: Reusable result arrays to avoid allocation on every query
  private readonly _queryResultSet = new Set<EntityId>();
  private static readonly EMPTY_SET = new Set<EntityId>(); // Shared empty set for cache misses

  constructor(width: number, height: number, cellSize = 2) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
  }

  // PERF: Numeric key instead of string key - no allocation
  private getKey(x: number, y: number): number {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return cellY * this.cols + cellX;
  }

  private getOrCreateCell(key: number): GridCell {
    let cell = this.grid.get(key);
    if (!cell) {
      cell = { entities: new Set(), walkable: true };
      this.grid.set(key, cell);
    }
    return cell;
  }

  public insert(entityId: EntityId, x: number, y: number): void {
    const key = this.getKey(x, y);
    const cell = this.getOrCreateCell(key);
    cell.entities.add(entityId);
  }

  public remove(entityId: EntityId, x: number, y: number): void {
    const key = this.getKey(x, y);
    const cell = this.grid.get(key);
    if (cell) {
      cell.entities.delete(entityId);
    }
  }

  public move(
    entityId: EntityId,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number
  ): void {
    const oldKey = this.getKey(oldX, oldY);
    const newKey = this.getKey(newX, newY);

    if (oldKey !== newKey) {
      this.remove(entityId, oldX, oldY);
      this.insert(entityId, newX, newY);
    }
  }

  public query(
    x: number,
    y: number,
    radius: number
  ): Set<EntityId> {
    // PERF: Reuse the result set instead of allocating new one
    this._queryResultSet.clear();
    const cellRadius = Math.ceil(radius / this.cellSize);

    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellY = Math.floor(y / this.cellSize);

    for (let dy = -cellRadius; dy <= cellRadius; dy++) {
      const cellY = centerCellY + dy;
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const cellX = centerCellX + dx;
        // PERF: Numeric key - no string allocation
        const key = cellY * this.cols + cellX;
        const cell = this.grid.get(key);
        if (cell) {
          for (const entityId of cell.entities) {
            this._queryResultSet.add(entityId);
          }
        }
      }
    }

    return this._queryResultSet;
  }

  public queryRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): Set<EntityId> {
    // PERF: Reuse the result set instead of allocating new one
    this._queryResultSet.clear();

    const startCellX = Math.floor(minX / this.cellSize);
    const startCellY = Math.floor(minY / this.cellSize);
    const endCellX = Math.floor(maxX / this.cellSize);
    const endCellY = Math.floor(maxY / this.cellSize);

    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        // PERF: Numeric key - no string allocation
        const key = cy * this.cols + cx;
        const cell = this.grid.get(key);
        if (cell) {
          for (const entityId of cell.entities) {
            this._queryResultSet.add(entityId);
          }
        }
      }
    }

    return this._queryResultSet;
  }

  public setWalkable(x: number, y: number, walkable: boolean): void {
    const key = this.getKey(x, y);
    const cell = this.getOrCreateCell(key);
    cell.walkable = walkable;
  }

  public isWalkable(x: number, y: number): boolean {
    const key = this.getKey(x, y);
    const cell = this.grid.get(key);
    return cell ? cell.walkable : true;
  }

  public clear(): void {
    this.grid.clear();
  }

  public getCellSize(): number {
    return this.cellSize;
  }

  public getEntitiesInCell(x: number, y: number): Set<EntityId> {
    const key = this.getKey(x, y);
    const cell = this.grid.get(key);
    // PERF: Return shared empty set instead of allocating new one
    return cell ? cell.entities : SpatialGrid.EMPTY_SET;
  }
}
