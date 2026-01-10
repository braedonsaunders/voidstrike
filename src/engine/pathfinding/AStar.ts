export interface PathNode {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic cost to end
  f: number; // Total cost (g + h)
  parent: PathNode | null;
  walkable: boolean;
  moveCost: number; // Terrain movement cost modifier (1.0 = normal, higher = slower)
}

export interface PathResult {
  path: Array<{ x: number; y: number }>;
  found: boolean;
}

export class AStar {
  private grid: PathNode[][] = [];
  private width: number;
  private height: number;
  private cellSize: number;

  constructor(width: number, height: number, cellSize = 1) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.initializeGrid();
  }

  private initializeGrid(): void {
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = {
          x,
          y,
          g: 0,
          h: 0,
          f: 0,
          parent: null,
          walkable: true,
          moveCost: 1.0, // Default normal movement cost
        };
      }
    }
  }

  /**
   * Set terrain movement cost for a cell.
   * Higher values make the cell less desirable for pathfinding.
   * Roads should have cost < 1.0, forests/mud should have cost > 1.0
   */
  public setMoveCost(x: number, y: number, cost: number): void {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isInBounds(gridX, gridY)) {
      this.grid[gridY][gridX].moveCost = cost;
    }
  }

  /**
   * Set movement cost for a rectangular area
   */
  public setMoveCostArea(
    x: number,
    y: number,
    width: number,
    height: number,
    cost: number
  ): void {
    const startX = Math.floor(x / this.cellSize);
    const startY = Math.floor(y / this.cellSize);
    const endX = Math.floor((x + width) / this.cellSize);
    const endY = Math.floor((y + height) / this.cellSize);

    for (let gy = startY; gy <= endY; gy++) {
      for (let gx = startX; gx <= endX; gx++) {
        if (this.isInBounds(gx, gy)) {
          this.grid[gy][gx].moveCost = cost;
        }
      }
    }
  }

  public setWalkable(x: number, y: number, walkable: boolean): void {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isInBounds(gridX, gridY)) {
      this.grid[gridY][gridX].walkable = walkable;
    }
  }

  public setBlockedArea(
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const startX = Math.floor(x / this.cellSize);
    const startY = Math.floor(y / this.cellSize);
    const endX = Math.floor((x + width) / this.cellSize);
    const endY = Math.floor((y + height) / this.cellSize);

    for (let gy = startY; gy <= endY; gy++) {
      for (let gx = startX; gx <= endX; gx++) {
        if (this.isInBounds(gx, gy)) {
          this.grid[gy][gx].walkable = false;
        }
      }
    }
  }

  public clearBlockedArea(
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const startX = Math.floor(x / this.cellSize);
    const startY = Math.floor(y / this.cellSize);
    const endX = Math.floor((x + width) / this.cellSize);
    const endY = Math.floor((y + height) / this.cellSize);

    for (let gy = startY; gy <= endY; gy++) {
      for (let gx = startX; gx <= endX; gx++) {
        if (this.isInBounds(gx, gy)) {
          this.grid[gy][gx].walkable = true;
        }
      }
    }
  }

  public findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): PathResult {
    // Convert world coordinates to grid coordinates
    const gridStartX = Math.floor(startX / this.cellSize);
    const gridStartY = Math.floor(startY / this.cellSize);
    const gridEndX = Math.floor(endX / this.cellSize);
    const gridEndY = Math.floor(endY / this.cellSize);

    // Validate bounds
    if (
      !this.isInBounds(gridStartX, gridStartY) ||
      !this.isInBounds(gridEndX, gridEndY)
    ) {
      return { path: [], found: false };
    }

    // Reset grid
    this.resetGrid();

    const openList: PathNode[] = [];
    const closedSet = new Set<string>();

    const startNode = this.grid[gridStartY][gridStartX];
    const endNode = this.grid[gridEndY][gridEndX];

    // If end is not walkable, find nearest walkable cell
    if (!endNode.walkable) {
      const nearest = this.findNearestWalkable(gridEndX, gridEndY);
      if (!nearest) {
        return { path: [], found: false };
      }
      return this.findPath(
        startX,
        startY,
        nearest.x * this.cellSize,
        nearest.y * this.cellSize
      );
    }

    openList.push(startNode);

    while (openList.length > 0) {
      // Find node with lowest f cost
      let currentIndex = 0;
      for (let i = 1; i < openList.length; i++) {
        if (openList[i].f < openList[currentIndex].f) {
          currentIndex = i;
        }
      }

      const current = openList[currentIndex];

      // Check if we reached the goal
      if (current.x === endNode.x && current.y === endNode.y) {
        return {
          path: this.reconstructPath(current),
          found: true,
        };
      }

      // Move current from open to closed
      openList.splice(currentIndex, 1);
      closedSet.add(`${current.x},${current.y}`);

      // Check neighbors
      const neighbors = this.getNeighbors(current);

      for (const neighbor of neighbors) {
        if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;
        if (!neighbor.walkable) continue;

        // Calculate tentative g score with terrain cost modifier
        const isDiagonal =
          neighbor.x !== current.x && neighbor.y !== current.y;
        const baseCost = isDiagonal ? 1.414 : 1;
        // Apply terrain movement cost (roads < 1, forests/mud > 1)
        const terrainCost = baseCost * neighbor.moveCost;
        const tentativeG = current.g + terrainCost;

        const isInOpen = openList.includes(neighbor);

        if (!isInOpen || tentativeG < neighbor.g) {
          neighbor.g = tentativeG;
          neighbor.h = this.heuristic(neighbor, endNode);
          neighbor.f = neighbor.g + neighbor.h;
          neighbor.parent = current;

          if (!isInOpen) {
            openList.push(neighbor);
          }
        }
      }
    }

    // No path found
    return { path: [], found: false };
  }

  private isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private resetGrid(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x].g = 0;
        this.grid[y][x].h = 0;
        this.grid[y][x].f = 0;
        this.grid[y][x].parent = null;
        // Note: walkable and moveCost are preserved across pathfinding calls
      }
    }
  }

  /**
   * Get the movement cost at a position
   */
  public getMoveCost(x: number, y: number): number {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (!this.isInBounds(gridX, gridY)) return 1.0;
    return this.grid[gridY][gridX].moveCost;
  }

  private getNeighbors(node: PathNode): PathNode[] {
    const neighbors: PathNode[] = [];
    const directions = [
      { dx: 0, dy: -1 }, // Up
      { dx: 1, dy: 0 }, // Right
      { dx: 0, dy: 1 }, // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 1, dy: -1 }, // Up-Right
      { dx: 1, dy: 1 }, // Down-Right
      { dx: -1, dy: 1 }, // Down-Left
      { dx: -1, dy: -1 }, // Up-Left
    ];

    for (const dir of directions) {
      const nx = node.x + dir.dx;
      const ny = node.y + dir.dy;

      if (this.isInBounds(nx, ny)) {
        // For diagonal movement, check if both adjacent cells are walkable
        if (dir.dx !== 0 && dir.dy !== 0) {
          const adj1 = this.grid[node.y][nx];
          const adj2 = this.grid[ny][node.x];
          if (!adj1.walkable || !adj2.walkable) continue;
        }

        neighbors.push(this.grid[ny][nx]);
      }
    }

    return neighbors;
  }

  private heuristic(a: PathNode, b: PathNode): number {
    // Octile distance (accounts for diagonal movement)
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx + dy + (1.414 - 2) * Math.min(dx, dy);
  }

  private reconstructPath(endNode: PathNode): Array<{ x: number; y: number }> {
    const path: Array<{ x: number; y: number }> = [];
    let current: PathNode | null = endNode;

    while (current) {
      path.unshift({
        x: current.x * this.cellSize + this.cellSize / 2,
        y: current.y * this.cellSize + this.cellSize / 2,
      });
      current = current.parent;
    }

    // Smooth the path (remove unnecessary waypoints)
    return this.smoothPath(path);
  }

  /**
   * Smooth path by removing unnecessary waypoints while validating line-of-sight.
   * Uses Bresenham's line algorithm to verify the direct path is clear.
   */
  private smoothPath(
    path: Array<{ x: number; y: number }>
  ): Array<{ x: number; y: number }> {
    if (path.length <= 2) return path;

    const smoothed: Array<{ x: number; y: number }> = [path[0]];
    let anchor = 0;

    for (let i = 1; i < path.length; i++) {
      // Check if we can go directly from anchor to point i+1 (skip point i)
      if (i + 1 < path.length) {
        const from = path[anchor];
        const to = path[i + 1];

        if (this.hasLineOfSight(from.x, from.y, to.x, to.y)) {
          // Can skip waypoint i, continue checking
          continue;
        }
      }

      // Cannot skip waypoint i, add it to the smoothed path
      smoothed.push(path[i]);
      anchor = i;
    }

    // Always add the final destination
    if (smoothed[smoothed.length - 1] !== path[path.length - 1]) {
      smoothed.push(path[path.length - 1]);
    }

    return smoothed;
  }

  /**
   * Check if there's a clear line of sight between two points using Bresenham's line algorithm.
   * Returns true if all cells along the line are walkable.
   */
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    // Convert to grid coordinates
    const gx1 = Math.floor(x1 / this.cellSize);
    const gy1 = Math.floor(y1 / this.cellSize);
    const gx2 = Math.floor(x2 / this.cellSize);
    const gy2 = Math.floor(y2 / this.cellSize);

    // Bresenham's line algorithm
    let x = gx1;
    let y = gy1;
    const dx = Math.abs(gx2 - gx1);
    const dy = Math.abs(gy2 - gy1);
    const sx = gx1 < gx2 ? 1 : -1;
    const sy = gy1 < gy2 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      // Check if current cell is walkable
      if (!this.isInBounds(x, y) || !this.grid[y][x].walkable) {
        return false;
      }

      // For diagonal movement, also check adjacent cells to prevent corner cutting
      if (x !== gx1 || y !== gy1) {
        const prevX = x - sx;
        const prevY = y - sy;
        if (this.isInBounds(prevX, y) && !this.grid[y][prevX].walkable &&
            this.isInBounds(x, prevY) && !this.grid[prevY][x].walkable) {
          return false; // Blocked corner
        }
      }

      if (x === gx2 && y === gy2) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    return true;
  }

  private findNearestWalkable(
    x: number,
    y: number
  ): { x: number; y: number } | null {
    const maxRadius = 10;

    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

          const nx = x + dx;
          const ny = y + dy;

          if (this.isInBounds(nx, ny) && this.grid[ny][nx].walkable) {
            return { x: nx, y: ny };
          }
        }
      }
    }

    return null;
  }

  public isWalkable(x: number, y: number): boolean {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (!this.isInBounds(gridX, gridY)) return false;
    return this.grid[gridY][gridX].walkable;
  }
}
