/**
 * High-Performance A* Pathfinding Implementation
 *
 * Features:
 * - Binary heap for O(log n) open list operations (not O(n) linear search)
 * - Version-based node reset (no grid reset between searches)
 * - No grid cloning (pathfinding.js requires clone which is O(n))
 * - Terrain cost support
 * - Path smoothing with line-of-sight optimization
 * - Diagonal movement with corner-cutting prevention
 */

import { debugPathfinding, debugPerformance } from '@/utils/debugLogger';

export interface PathNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
  walkable: boolean;
  moveCost: number;
  // Version-based reset: node is only valid if version matches current search
  version: number;
  // Heap index for O(log n) updates
  heapIndex: number;
  // Open/closed state
  opened: boolean;
  closed: boolean;
}

export interface PathResult {
  path: Array<{ x: number; y: number }>;
  found: boolean;
}

/**
 * Binary Min-Heap for efficient priority queue operations
 */
class BinaryHeap {
  private nodes: PathNode[] = [];

  public get length(): number {
    return this.nodes.length;
  }

  public push(node: PathNode): void {
    node.heapIndex = this.nodes.length;
    this.nodes.push(node);
    this.bubbleUp(node.heapIndex);
  }

  public pop(): PathNode | undefined {
    if (this.nodes.length === 0) return undefined;

    const result = this.nodes[0];
    const end = this.nodes.pop()!;

    if (this.nodes.length > 0) {
      this.nodes[0] = end;
      end.heapIndex = 0;
      this.sinkDown(0);
    }

    return result;
  }

  public update(node: PathNode): void {
    this.bubbleUp(node.heapIndex);
  }

  public clear(): void {
    this.nodes.length = 0;
  }

  private bubbleUp(index: number): void {
    const node = this.nodes[index];

    while (index > 0) {
      const parentIndex = ((index - 1) / 2) | 0;
      const parent = this.nodes[parentIndex];

      if (node.f >= parent.f) break;

      // Swap
      this.nodes[parentIndex] = node;
      this.nodes[index] = parent;
      node.heapIndex = parentIndex;
      parent.heapIndex = index;
      index = parentIndex;
    }
  }

  private sinkDown(index: number): void {
    const length = this.nodes.length;
    const node = this.nodes[index];

    while (true) {
      const leftIndex = 2 * index + 1;
      const rightIndex = 2 * index + 2;
      let smallest = index;

      if (leftIndex < length && this.nodes[leftIndex].f < this.nodes[smallest].f) {
        smallest = leftIndex;
      }

      if (rightIndex < length && this.nodes[rightIndex].f < this.nodes[smallest].f) {
        smallest = rightIndex;
      }

      if (smallest === index) break;

      // Swap
      const smallestNode = this.nodes[smallest];
      this.nodes[index] = smallestNode;
      this.nodes[smallest] = node;
      smallestNode.heapIndex = index;
      node.heapIndex = smallest;
      index = smallest;
    }
  }
}

// Diagonal cost (√2)
const DIAGONAL_COST = 1.414;
const STRAIGHT_COST = 1.0;

// Maximum nodes to explore before giving up (prevents freezing on impossible/very long paths)
// Base limit for short paths; longer paths get more iterations
// Maximum A* iterations - fail fast for unreachable destinations
// Lower values = faster failure detection but may miss long valid paths
// Higher values = finds more paths but FPS tanks on unreachable destinations
const BASE_MAX_ITERATIONS = 2000;
const ITERATIONS_PER_DISTANCE = 30; // Extra iterations per unit distance
const ABSOLUTE_MAX_ITERATIONS = 8000; // Never exceed this - was 15000, reduced to prevent FPS death

export class AStar {
  private grid: PathNode[][];
  private width: number;
  private height: number;
  private cellSize: number;

  // Version for reset-free searches
  private searchVersion: number = 0;

  // Reusable binary heap
  private openHeap: BinaryHeap = new BinaryHeap();

  // Track if we have weighted terrain (for optimization decisions)
  private hasWeightedTerrain: boolean = false;

  // Pre-computed edge penalties to avoid recalculating every search
  private edgePenalties: Float32Array;
  private edgePenaltiesValid: boolean = false;

  constructor(width: number, height: number, cellSize = 1) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;

    // Initialize grid
    this.grid = [];
    for (let y = 0; y < height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < width; x++) {
        this.grid[y][x] = {
          x,
          y,
          g: 0,
          h: 0,
          f: 0,
          parent: null,
          walkable: true,
          moveCost: 1.0,
          version: 0,
          heapIndex: -1,
          opened: false,
          closed: false,
        };
      }
    }

    // Initialize edge penalty array
    this.edgePenalties = new Float32Array(width * height);
  }

  /**
   * Recompute all edge penalties. Call this after walkability changes.
   */
  public recomputeEdgePenalties(): void {
    const start = performance.now();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        if (!this.grid[y][x].walkable) {
          this.edgePenalties[idx] = 0;
          continue;
        }

        let unwalkableNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!this.isInBounds(nx, ny) || !this.grid[ny][nx].walkable) {
              unwalkableNeighbors++;
            }
          }
        }
        this.edgePenalties[idx] = unwalkableNeighbors * 0.3;
      }
    }
    this.edgePenaltiesValid = true;
    const elapsed = performance.now() - start;
    if (elapsed > 5) {
      debugPerformance.log(`[AStar] recomputeEdgePenalties: ${this.width}x${this.height} took ${elapsed.toFixed(1)}ms`);
    }
  }

  /**
   * Set terrain movement cost for a cell.
   */
  public setMoveCost(x: number, y: number, cost: number): void {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isInBounds(gridX, gridY)) {
      const oldCost = this.grid[gridY][gridX].moveCost;
      this.grid[gridY][gridX].moveCost = cost;

      if (cost !== 1.0 && oldCost === 1.0) {
        this.hasWeightedTerrain = true;
      }
    }
  }

  public setWalkable(x: number, y: number, walkable: boolean): void {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isInBounds(gridX, gridY)) {
      this.grid[gridY][gridX].walkable = walkable;
      this.edgePenaltiesValid = false; // Invalidate cached penalties
    }
  }

  public isWalkable(x: number, y: number): boolean {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (!this.isInBounds(gridX, gridY)) return false;
    return this.grid[gridY][gridX].walkable;
  }

  public setBlockedArea(x: number, y: number, width: number, height: number): void {
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
    this.edgePenaltiesValid = false;
  }

  public clearBlockedArea(x: number, y: number, width: number, height: number): void {
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
    this.edgePenaltiesValid = false;
  }

  public findPath(startX: number, startY: number, endX: number, endY: number): PathResult {
    const astarStart = performance.now();

    // Convert world coordinates to grid coordinates
    const gridStartX = Math.floor(startX / this.cellSize);
    const gridStartY = Math.floor(startY / this.cellSize);
    let gridEndX = Math.floor(endX / this.cellSize);
    let gridEndY = Math.floor(endY / this.cellSize);

    // Validate bounds
    if (
      !this.isInBounds(gridStartX, gridStartY) ||
      !this.isInBounds(gridEndX, gridEndY)
    ) {
      return { path: [], found: false };
    }

    // If end is not walkable, find nearest walkable cell
    if (!this.grid[gridEndY][gridEndX].walkable) {
      const nearest = this.findNearestWalkable(gridEndX, gridEndY);
      if (!nearest) {
        return { path: [], found: false };
      }
      gridEndX = nearest.x;
      gridEndY = nearest.y;
    }

    // If start is not walkable, find nearest walkable
    if (!this.grid[gridStartY][gridStartX].walkable) {
      const nearest = this.findNearestWalkable(gridStartX, gridStartY);
      if (!nearest) {
        return { path: [], found: false };
      }
      // Can't actually move if we're stuck
      return { path: [], found: false };
    }

    // Same cell
    if (gridStartX === gridEndX && gridStartY === gridEndY) {
      return {
        path: [{ x: endX, y: endY }],
        found: true,
      };
    }

    // Recompute edge penalties if needed
    if (!this.edgePenaltiesValid) {
      this.recomputeEdgePenalties();
    }

    // Increment search version (resets all nodes implicitly)
    this.searchVersion++;

    // Clear heap
    this.openHeap.clear();

    // Initialize start node
    const startNode = this.grid[gridStartY][gridStartX];
    startNode.g = 0;
    startNode.h = this.heuristic(gridStartX, gridStartY, gridEndX, gridEndY);
    startNode.f = startNode.h;
    startNode.parent = null;
    startNode.version = this.searchVersion;
    startNode.opened = true;
    startNode.closed = false;

    this.openHeap.push(startNode);

    const endNode = this.grid[gridEndY][gridEndX];

    // Calculate dynamic iteration limit based on distance
    const dx = Math.abs(gridEndX - gridStartX);
    const dy = Math.abs(gridEndY - gridStartY);
    const estimatedDistance = Math.sqrt(dx * dx + dy * dy);
    const maxIterations = Math.min(
      ABSOLUTE_MAX_ITERATIONS,
      Math.floor(BASE_MAX_ITERATIONS + estimatedDistance * ITERATIONS_PER_DISTANCE)
    );

    // Iteration counter to prevent freezing on very long/impossible paths
    let iterations = 0;

    // A* main loop
    while (this.openHeap.length > 0) {
      // Early exit if we've searched too long
      if (++iterations > maxIterations) {
        const elapsed = performance.now() - astarStart;
        // Only log if this is a significant timeout (not just a short path that failed)
        if (elapsed > 2) {
          debugPathfinding.warn(`[AStar] MAX_ITERATIONS (${maxIterations}) reached! (${gridStartX},${gridStartY}) -> (${gridEndX},${gridEndY}) dist=${estimatedDistance.toFixed(0)} took ${elapsed.toFixed(1)}ms`);
        }
        return { path: [], found: false };
      }
      const current = this.openHeap.pop()!;
      current.closed = true;

      // Found path
      if (current === endNode) {
        const path = this.reconstructPath(current);
        const smoothedPath = this.smoothPath(path);
        const elapsed = performance.now() - astarStart;
        if (elapsed > 10) { // Only log slow searches
          debugPerformance.log(`[AStar] Found path: ${iterations} iterations, ${smoothedPath.length} waypoints, ${elapsed.toFixed(1)}ms`);
        }
        return { path: smoothedPath, found: true };
      }

      // Check all 8 neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;

          const nx = current.x + dx;
          const ny = current.y + dy;

          if (!this.isInBounds(nx, ny)) continue;

          const neighbor = this.grid[ny][nx];

          // Skip unwalkable
          if (!neighbor.walkable) continue;

          // Initialize node if not visited this search
          if (neighbor.version !== this.searchVersion) {
            neighbor.version = this.searchVersion;
            neighbor.g = Infinity;
            neighbor.h = 0;
            neighbor.f = Infinity;
            neighbor.parent = null;
            neighbor.opened = false;
            neighbor.closed = false;
          }

          // Skip closed nodes
          if (neighbor.closed) continue;

          // Diagonal movement check - prevent corner cutting
          const isDiagonal = dx !== 0 && dy !== 0;
          if (isDiagonal) {
            const adj1 = this.grid[current.y][nx];
            const adj2 = this.grid[ny][current.x];
            if (!adj1.walkable || !adj2.walkable) {
              continue; // Can't cut corners
            }
          }

          // Calculate movement cost
          const baseCost = isDiagonal ? DIAGONAL_COST : STRAIGHT_COST;

          // Use pre-computed edge penalty (O(1) lookup instead of O(8) computation)
          const edgePenalty = this.edgePenalties[ny * this.width + nx];

          const terrainCost = neighbor.moveCost;
          const tentativeG = current.g + (baseCost + edgePenalty) * terrainCost;

          if (tentativeG < neighbor.g) {
            neighbor.parent = current;
            neighbor.g = tentativeG;
            neighbor.h = this.heuristic(nx, ny, gridEndX, gridEndY);
            neighbor.f = neighbor.g + neighbor.h;

            if (!neighbor.opened) {
              neighbor.opened = true;
              this.openHeap.push(neighbor);
            } else {
              // Update position in heap
              this.openHeap.update(neighbor);
            }
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

  /**
   * Octile distance heuristic (optimal for 8-directional movement)
   */
  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    return STRAIGHT_COST * (dx + dy) + (DIAGONAL_COST - 2 * STRAIGHT_COST) * Math.min(dx, dy);
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

    return path;
  }

  /**
   * Smooth path by removing unnecessary waypoints using line-of-sight checks.
   * Uses a conservative corridor check to account for unit collision radius.
   */
  private smoothPath(path: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (path.length <= 2) return path;

    const smoothed: Array<{ x: number; y: number }> = [path[0]];
    let anchor = 0;

    for (let i = 1; i < path.length; i++) {
      if (i + 1 < path.length) {
        const from = path[anchor];
        const to = path[i + 1];

        // Use corridor-based line of sight check to account for unit size
        if (this.hasCorridorLineOfSight(from.x, from.y, to.x, to.y)) {
          continue; // Can skip waypoint i
        }
      }

      smoothed.push(path[i]);
      anchor = i;
    }

    if (smoothed[smoothed.length - 1] !== path[path.length - 1]) {
      smoothed.push(path[path.length - 1]);
    }

    return smoothed;
  }

  /**
   * Check line of sight using Bresenham's algorithm
   */
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const gx1 = Math.floor(x1 / this.cellSize);
    const gy1 = Math.floor(y1 / this.cellSize);
    const gx2 = Math.floor(x2 / this.cellSize);
    const gy2 = Math.floor(y2 / this.cellSize);

    let x = gx1;
    let y = gy1;
    const dx = Math.abs(gx2 - gx1);
    const dy = Math.abs(gy2 - gy1);
    const sx = gx1 < gx2 ? 1 : -1;
    const sy = gy1 < gy2 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      if (!this.isInBounds(x, y) || !this.grid[y][x].walkable) {
        return false;
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

  /**
   * Check line of sight with a corridor buffer to account for unit collision radius.
   * Checks not just the main path but also adjacent cells to ensure units won't clip terrain.
   */
  private hasCorridorLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const gx1 = Math.floor(x1 / this.cellSize);
    const gy1 = Math.floor(y1 / this.cellSize);
    const gx2 = Math.floor(x2 / this.cellSize);
    const gy2 = Math.floor(y2 / this.cellSize);

    // Calculate perpendicular direction for corridor width
    const dx = gx2 - gx1;
    const dy = gy2 - gy1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 0.01) return true; // Same cell

    // Perpendicular offsets for corridor checking
    const perpX = -dy / length;
    const perpY = dx / length;

    let x = gx1;
    let y = gy1;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const sx = gx1 < gx2 ? 1 : -1;
    const sy = gy1 < gy2 ? 1 : -1;
    let err = adx - ady;

    while (true) {
      // Check main cell and adjacent cells for corridor
      if (!this.isCorridorWalkable(x, y, perpX, perpY)) {
        return false;
      }

      if (x === gx2 && y === gy2) break;

      const e2 = 2 * err;
      if (e2 > -ady) {
        err -= ady;
        x += sx;
      }
      if (e2 < adx) {
        err += adx;
        y += sy;
      }
    }

    return true;
  }

  /**
   * Check if a cell and its corridor neighbors are walkable.
   * This ensures units with collision radius won't clip into terrain.
   */
  private isCorridorWalkable(x: number, y: number, perpX: number, perpY: number): boolean {
    // Check main cell
    if (!this.isInBounds(x, y) || !this.grid[y][x].walkable) {
      return false;
    }

    // Check adjacent cells perpendicular to path direction
    // This creates a 3-cell-wide corridor check
    const offsets = [
      { dx: Math.round(perpX), dy: Math.round(perpY) },
      { dx: Math.round(-perpX), dy: Math.round(-perpY) },
    ];

    for (const { dx, dy } of offsets) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (this.isInBounds(nx, ny) && !this.grid[ny][nx].walkable) {
        // Adjacent cell is unwalkable - path is too close to terrain edge
        return false;
      }
    }

    return true;
  }

  private findNearestWalkable(x: number, y: number): { x: number; y: number } | null {
    const maxRadius = 15;

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

  /**
   * Get movement cost at a position
   */
  public getMoveCost(x: number, y: number): number {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (!this.isInBounds(gridX, gridY)) return 1.0;
    return this.grid[gridY][gridX].moveCost;
  }
}
