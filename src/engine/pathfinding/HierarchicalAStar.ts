/**
 * Hierarchical Pathfinding A* (HPA*) using pathfinding.js
 *
 * Optimizes long-distance pathfinding by:
 * 1. Dividing the map into sectors (clusters)
 * 2. Pre-computing abstract paths between sector entrances
 * 3. Caching frequently used paths with LRU eviction
 * 4. Using hierarchical search for long paths
 *
 * For short paths (within same/adjacent sectors), falls back to JPS/A*
 */

import * as PF from 'pathfinding';
import { AStar, PathResult } from './AStar';

interface Sector {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  entrances: SectorEntrance[];
}

interface SectorEntrance {
  x: number;
  y: number;
  neighborSectorId: number;
  neighborEntranceIndex: number;
}

interface AbstractEdge {
  fromSector: number;
  toSector: number;
  cost: number;
  entranceIndex: number;
}

interface CachedPath {
  path: Array<{ x: number; y: number }>;
  timestamp: number;
}

const SECTOR_SIZE = 16; // 16x16 unit sectors
const PATH_CACHE_SIZE = 100;
const PATH_CACHE_TTL = 5000; // 5 seconds

export class HierarchicalAStar {
  private baseAStar: AStar;
  private width: number;
  private height: number;
  private sectors: Sector[] = [];
  private sectorGrid: (number | null)[][] = [];
  private abstractGraph: Map<number, AbstractEdge[]> = new Map();
  private pathCache: Map<string, CachedPath> = new Map();
  private cacheKeys: string[] = [];

  // Use pathfinding.js for abstract graph search
  private abstractGridWidth: number = 0;
  private abstractGridHeight: number = 0;

  // Track if abstract graph needs rebuild
  private needsRebuild = true;

  constructor(width: number, height: number, cellSize = 1) {
    this.width = width;
    this.height = height;
    this.baseAStar = new AStar(width, height, cellSize);
    this.initializeSectors();
  }

  /**
   * Initialize sectors and build initial abstract graph
   */
  private initializeSectors(): void {
    const sectorsX = Math.ceil(this.width / SECTOR_SIZE);
    const sectorsY = Math.ceil(this.height / SECTOR_SIZE);

    this.abstractGridWidth = sectorsX;
    this.abstractGridHeight = sectorsY;

    // Create sectors
    let sectorId = 0;
    for (let sy = 0; sy < sectorsY; sy++) {
      for (let sx = 0; sx < sectorsX; sx++) {
        const sector: Sector = {
          id: sectorId,
          x: sx * SECTOR_SIZE,
          y: sy * SECTOR_SIZE,
          width: Math.min(SECTOR_SIZE, this.width - sx * SECTOR_SIZE),
          height: Math.min(SECTOR_SIZE, this.height - sy * SECTOR_SIZE),
          entrances: [],
        };
        this.sectors.push(sector);
        sectorId++;
      }
    }

    // Create sector grid for quick lookups
    this.sectorGrid = [];
    for (let y = 0; y < this.height; y++) {
      this.sectorGrid[y] = [];
      for (let x = 0; x < this.width; x++) {
        const sx = Math.floor(x / SECTOR_SIZE);
        const sy = Math.floor(y / SECTOR_SIZE);
        const sectorsPerRow = Math.ceil(this.width / SECTOR_SIZE);
        this.sectorGrid[y][x] = sy * sectorsPerRow + sx;
      }
    }
  }

  /**
   * Rebuild abstract graph (called when walkability changes)
   */
  public rebuildAbstractGraph(): void {
    this.abstractGraph.clear();
    this.pathCache.clear();
    this.cacheKeys = [];

    // Find entrances between adjacent sectors
    for (const sector of this.sectors) {
      sector.entrances = [];
      this.findSectorEntrances(sector);
    }

    // Build edges between sectors
    for (const sector of this.sectors) {
      const edges: AbstractEdge[] = [];

      for (let i = 0; i < sector.entrances.length; i++) {
        const entrance = sector.entrances[i];

        // Calculate cost to neighbor through this entrance
        const cost = this.estimateCrossingSectorCost(sector, entrance);

        edges.push({
          fromSector: sector.id,
          toSector: entrance.neighborSectorId,
          cost,
          entranceIndex: i,
        });
      }

      this.abstractGraph.set(sector.id, edges);
    }

    this.needsRebuild = false;
  }

  /**
   * Find entrances along sector borders
   */
  private findSectorEntrances(sector: Sector): void {
    const sectorsPerRow = Math.ceil(this.width / SECTOR_SIZE);

    // Check right border
    if (sector.x + sector.width < this.width) {
      const neighborId = sector.id + 1;
      this.findBorderEntrances(
        sector,
        neighborId,
        sector.x + sector.width - 1,
        sector.y,
        0,
        1,
        sector.height
      );
    }

    // Check bottom border
    if (sector.y + sector.height < this.height) {
      const neighborId = sector.id + sectorsPerRow;
      this.findBorderEntrances(
        sector,
        neighborId,
        sector.x,
        sector.y + sector.height - 1,
        1,
        0,
        sector.width
      );
    }

    // Check left border
    if (sector.x > 0) {
      const neighborId = sector.id - 1;
      this.findBorderEntrances(sector, neighborId, sector.x, sector.y, 0, 1, sector.height);
    }

    // Check top border
    if (sector.y > 0) {
      const neighborId = sector.id - sectorsPerRow;
      this.findBorderEntrances(sector, neighborId, sector.x, sector.y, 1, 0, sector.width);
    }
  }

  /**
   * Find walkable entrances along a sector border
   */
  private findBorderEntrances(
    sector: Sector,
    neighborId: number,
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    length: number
  ): void {
    let inEntrance = false;
    let entranceStart = 0;

    for (let i = 0; i <= length; i++) {
      const x = startX + dx * i;
      const y = startY + dy * i;

      const isWalkable = i < length && this.baseAStar.isWalkable(x, y);

      if (isWalkable && !inEntrance) {
        // Start of entrance
        entranceStart = i;
        inEntrance = true;
      } else if (!isWalkable && inEntrance) {
        // End of entrance - use middle point
        const midpoint = Math.floor((entranceStart + i - 1) / 2);
        const entranceX = startX + dx * midpoint;
        const entranceY = startY + dy * midpoint;

        sector.entrances.push({
          x: entranceX,
          y: entranceY,
          neighborSectorId: neighborId,
          neighborEntranceIndex: -1, // Will be linked later
        });
        inEntrance = false;
      }
    }

    // Handle entrance at end of border
    if (inEntrance) {
      const midpoint = Math.floor((entranceStart + length - 1) / 2);
      const entranceX = startX + dx * midpoint;
      const entranceY = startY + dy * midpoint;

      sector.entrances.push({
        x: entranceX,
        y: entranceY,
        neighborSectorId: neighborId,
        neighborEntranceIndex: -1,
      });
    }
  }

  /**
   * Estimate cost to cross a sector
   */
  private estimateCrossingSectorCost(_sector: Sector, _entrance: SectorEntrance): number {
    // Simple heuristic based on sector size
    return SECTOR_SIZE * 0.7;
  }

  /**
   * Get sector ID for a position
   */
  private getSectorId(x: number, y: number): number | null {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) {
      return null;
    }
    return this.sectorGrid[gy][gx];
  }

  /**
   * Find path with hierarchical optimization
   */
  public findPath(startX: number, startY: number, endX: number, endY: number): PathResult {
    // Check cache first
    const cacheKey = `${Math.floor(startX)},${Math.floor(startY)}_${Math.floor(endX)},${Math.floor(endY)}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PATH_CACHE_TTL) {
      return { path: cached.path, found: true };
    }

    // Rebuild abstract graph if needed
    if (this.needsRebuild) {
      this.rebuildAbstractGraph();
    }

    const startSector = this.getSectorId(startX, startY);
    const endSector = this.getSectorId(endX, endY);

    // If same or adjacent sectors, use direct A*
    if (startSector === null || endSector === null) {
      return this.baseAStar.findPath(startX, startY, endX, endY);
    }

    if (startSector === endSector || this.areAdjacentSectors(startSector, endSector)) {
      return this.baseAStar.findPath(startX, startY, endX, endY);
    }

    // For longer paths, use hierarchical search
    const abstractPath = this.findAbstractPath(startSector, endSector);
    if (abstractPath.length === 0) {
      // Fallback to direct A*
      return this.baseAStar.findPath(startX, startY, endX, endY);
    }

    // Refine abstract path into detailed path
    const result = this.refineAbstractPath(startX, startY, endX, endY, abstractPath);

    // Cache the result
    if (result.found) {
      this.addToCache(cacheKey, result.path);
    }

    return result;
  }

  /**
   * Check if two sectors are adjacent
   */
  private areAdjacentSectors(sectorA: number, sectorB: number): boolean {
    const sectorsPerRow = Math.ceil(this.width / SECTOR_SIZE);
    const diff = Math.abs(sectorA - sectorB);
    return diff === 1 || diff === sectorsPerRow;
  }

  /**
   * Find abstract path through sectors using A* with binary heap
   */
  private findAbstractPath(startSector: number, endSector: number): number[] {
    // Use pathfinding.js AStarFinder on the abstract graph
    // Create a temporary grid for sector-level pathfinding
    const abstractGrid = new (PF.Grid as unknown as new (w: number, h: number) => PF.Grid)(this.abstractGridWidth, this.abstractGridHeight);

    // Mark sectors without any entrances as unwalkable
    for (const sector of this.sectors) {
      const sx = sector.id % this.abstractGridWidth;
      const sy = Math.floor(sector.id / this.abstractGridWidth);
      const hasEntrances = sector.entrances.length > 0;
      // A sector is walkable if it has entrances OR is the start/end sector
      abstractGrid.setWalkableAt(
        sx,
        sy,
        hasEntrances || sector.id === startSector || sector.id === endSector
      );
    }

    const startSx = startSector % this.abstractGridWidth;
    const startSy = Math.floor(startSector / this.abstractGridWidth);
    const endSx = endSector % this.abstractGridWidth;
    const endSy = Math.floor(endSector / this.abstractGridWidth);

    // Use A* with binary heap for abstract pathfinding
    const finder = new (PF.AStarFinder as unknown as new (opts: PF.FinderOptions) => {
      findPath(sx: number, sy: number, ex: number, ey: number, grid: PF.Grid): number[][];
    })({
      diagonalMovement: PF.DiagonalMovement.Never, // Sectors connect orthogonally
    });

    const rawPath = finder.findPath(startSx, startSy, endSx, endSy, abstractGrid);

    if (rawPath.length === 0) {
      return [];
    }

    // Convert grid coordinates back to sector IDs
    return rawPath.map(([x, y]) => y * this.abstractGridWidth + x);
  }

  /**
   * Heuristic for sector-level pathfinding
   */
  private sectorHeuristic(sectorA: number, sectorB: number): number {
    const a = this.sectors[sectorA];
    const b = this.sectors[sectorB];
    const dx = Math.abs(a.x + a.width / 2 - (b.x + b.width / 2));
    const dy = Math.abs(a.y + a.height / 2 - (b.y + b.height / 2));
    return dx + dy;
  }

  /**
   * Refine abstract path into detailed path by pathfinding through sector entrances.
   * This breaks the long path into smaller segments for efficiency.
   */
  private refineAbstractPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    abstractPath: number[]
  ): PathResult {
    if (abstractPath.length === 0) {
      return { path: [], found: false };
    }

    // Collect waypoints: start -> sector entrances -> end
    const waypoints: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    // Add entrance points between sectors
    for (let i = 0; i < abstractPath.length - 1; i++) {
      const currentSector = this.sectors[abstractPath[i]];
      const nextSectorId = abstractPath[i + 1];

      // Find the entrance to the next sector
      const entrance = currentSector.entrances.find((e) => e.neighborSectorId === nextSectorId);
      if (entrance) {
        // Convert grid coords to world coords (center of cell)
        waypoints.push({
          x: entrance.x + 0.5,
          y: entrance.y + 0.5,
        });
      }
    }

    waypoints.push({ x: endX, y: endY });

    // Now pathfind between consecutive waypoints
    const fullPath: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];

      const segment = this.baseAStar.findPath(from.x, from.y, to.x, to.y);

      if (!segment.found) {
        // If any segment fails, fall back to direct A* for the whole path
        return this.baseAStar.findPath(startX, startY, endX, endY);
      }

      // Add segment to full path (skip first point of subsequent segments to avoid duplicates)
      if (i === 0) {
        fullPath.push(...segment.path);
      } else if (segment.path.length > 1) {
        fullPath.push(...segment.path.slice(1));
      }
    }

    return { path: fullPath, found: true };
  }

  /**
   * Add path to cache with LRU eviction
   */
  private addToCache(key: string, path: Array<{ x: number; y: number }>): void {
    if (this.pathCache.size >= PATH_CACHE_SIZE) {
      // Evict oldest
      const oldestKey = this.cacheKeys.shift();
      if (oldestKey) {
        this.pathCache.delete(oldestKey);
      }
    }

    this.pathCache.set(key, { path, timestamp: Date.now() });
    this.cacheKeys.push(key);
  }

  /**
   * Mark that the grid has changed and abstract graph needs rebuild
   */
  public invalidate(): void {
    this.needsRebuild = true;
    this.pathCache.clear();
    this.cacheKeys = [];
  }

  /**
   * Proxy methods to base AStar
   */
  public setWalkable(x: number, y: number, walkable: boolean): void {
    this.baseAStar.setWalkable(x, y, walkable);
    this.invalidate();
  }

  public isWalkable(x: number, y: number): boolean {
    return this.baseAStar.isWalkable(x, y);
  }

  public setBlockedArea(x: number, y: number, width: number, height: number): void {
    this.baseAStar.setBlockedArea(x, y, width, height);
    this.invalidate();
  }

  public clearBlockedArea(x: number, y: number, width: number, height: number): void {
    this.baseAStar.clearBlockedArea(x, y, width, height);
    this.invalidate();
  }

  /**
   * Set movement cost - proxied to base AStar
   */
  public setMoveCost(x: number, y: number, cost: number): void {
    this.baseAStar.setMoveCost(x, y, cost);
  }

  /**
   * Get the base AStar instance for direct access if needed
   */
  public getBaseAStar(): AStar {
    return this.baseAStar;
  }
}
