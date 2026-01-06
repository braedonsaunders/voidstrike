import { EntityId } from '../ecs/Entity';

interface GridCell {
  entities: Set<EntityId>;
  walkable: boolean;
}

export class SpatialGrid {
  private grid: Map<string, GridCell> = new Map();
  private cellSize: number;
  private width: number;
  private height: number;

  constructor(width: number, height: number, cellSize = 2) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
  }

  private getKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  private getOrCreateCell(key: string): GridCell {
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
    const result = new Set<EntityId>();
    const cellRadius = Math.ceil(radius / this.cellSize);

    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellY = Math.floor(y / this.cellSize);

    for (let dy = -cellRadius; dy <= cellRadius; dy++) {
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const key = `${centerCellX + dx},${centerCellY + dy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const entityId of cell.entities) {
            result.add(entityId);
          }
        }
      }
    }

    return result;
  }

  public queryRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): Set<EntityId> {
    const result = new Set<EntityId>();

    const startCellX = Math.floor(minX / this.cellSize);
    const startCellY = Math.floor(minY / this.cellSize);
    const endCellX = Math.floor(maxX / this.cellSize);
    const endCellY = Math.floor(maxY / this.cellSize);

    for (let cy = startCellY; cy <= endCellY; cy++) {
      for (let cx = startCellX; cx <= endCellX; cx++) {
        const key = `${cx},${cy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const entityId of cell.entities) {
            result.add(entityId);
          }
        }
      }
    }

    return result;
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
    return cell ? cell.entities : new Set();
  }
}
