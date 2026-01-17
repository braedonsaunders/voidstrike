/**
 * EdgeDetector - Cliff edge detection and classification for platform terrain
 *
 * Detects edges between platform cells and lower terrain to determine
 * where to render vertical cliff faces and guardrails.
 *
 * Edge classification:
 * - 'cliff': Vertical cliff face with optional guardrail
 * - 'natural': Smooth blend into natural terrain (no cliff geometry)
 * - 'ramp': Connection to a ramp (no cliff geometry)
 * - 'none': No significant elevation change
 */

import type { EditorCell, EditorMapData } from '../config/EditorConfig';
import { CLIFF_THRESHOLD } from '@/data/maps/MapTypes';

export type EdgeDirection = 'north' | 'south' | 'east' | 'west';
export type EdgeType = 'cliff' | 'natural' | 'ramp' | 'none';

/**
 * Edge information for a single direction
 */
export interface DirectionalEdge {
  type: EdgeType;
  /** Elevation difference (positive = this cell is higher) */
  elevationDelta: number;
  /** Height of cliff face in world units (only for 'cliff' type) */
  cliffHeight: number;
  /** Neighbor cell terrain type */
  neighborTerrain: string;
}

/**
 * Complete edge information for a cell
 */
export interface CellEdgeInfo {
  x: number;
  y: number;
  isPlatform: boolean;
  elevation: number;
  north: DirectionalEdge;
  south: DirectionalEdge;
  east: DirectionalEdge;
  west: DirectionalEdge;
  /** True if any edge is a cliff */
  hasCliffEdge: boolean;
  /** Number of cliff edges (0-4) */
  cliffEdgeCount: number;
  /** Corner types for diagonal geometry */
  corners: {
    nw: 'convex' | 'concave' | 'none';
    ne: 'convex' | 'concave' | 'none';
    sw: 'convex' | 'concave' | 'none';
    se: 'convex' | 'concave' | 'none';
  };
}

/** Height scale factor - matches terrain rendering */
const HEIGHT_SCALE = 0.04;

/**
 * EdgeDetector provides cliff edge detection with caching for performance.
 */
export class EdgeDetector {
  private mapData: EditorMapData | null = null;
  private cache: Map<string, CellEdgeInfo> = new Map();
  private dirtySet: Set<string> = new Set();

  /**
   * Set the map data to analyze
   */
  public setMapData(mapData: EditorMapData): void {
    this.mapData = mapData;
    this.invalidateAll();
  }

  /**
   * Invalidate the entire cache (e.g., after map load)
   */
  public invalidateAll(): void {
    this.cache.clear();
    this.dirtySet.clear();
  }

  /**
   * Mark specific cells as dirty (need recalculation)
   * Also marks neighboring cells since their edges depend on this cell
   */
  public invalidateCells(cells: Array<{ x: number; y: number }>): void {
    for (const { x, y } of cells) {
      // Invalidate the cell and its neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${x + dx},${y + dy}`;
          this.cache.delete(key);
          this.dirtySet.add(key);
        }
      }
    }
  }

  /**
   * Get edge information for a cell
   * Uses cache if available, otherwise computes and caches
   */
  public getEdgeInfo(x: number, y: number): CellEdgeInfo | null {
    if (!this.mapData) return null;
    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return null;
    }

    const key = `${x},${y}`;

    // Return cached if available
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Compute edge info
    const info = this.computeEdgeInfo(x, y);
    this.cache.set(key, info);
    this.dirtySet.delete(key);

    return info;
  }

  /**
   * Get all cells that have cliff edges (for rendering)
   */
  public getCliffCells(): CellEdgeInfo[] {
    if (!this.mapData) return [];

    const cliffCells: CellEdgeInfo[] = [];

    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        const info = this.getEdgeInfo(x, y);
        if (info && info.hasCliffEdge) {
          cliffCells.push(info);
        }
      }
    }

    return cliffCells;
  }

  /**
   * Get cliff cells in a specific region (for partial updates)
   */
  public getCliffCellsInRegion(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): CellEdgeInfo[] {
    if (!this.mapData) return [];

    const cliffCells: CellEdgeInfo[] = [];

    // Expand region by 1 to catch edges at boundaries
    const x0 = Math.max(0, minX - 1);
    const y0 = Math.max(0, minY - 1);
    const x1 = Math.min(this.mapData.width - 1, maxX + 1);
    const y1 = Math.min(this.mapData.height - 1, maxY + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const info = this.getEdgeInfo(x, y);
        if (info && info.hasCliffEdge) {
          cliffCells.push(info);
        }
      }
    }

    return cliffCells;
  }

  /**
   * Compute edge information for a single cell
   */
  private computeEdgeInfo(x: number, y: number): CellEdgeInfo {
    const cell = this.getCell(x, y)!;
    const isPlatform = cell.isRamp ? false : this.isPlatformCell(cell);
    const elevation = cell.elevation;

    // Compute each directional edge
    const north = this.computeDirectionalEdge(x, y, 0, -1, cell);
    const south = this.computeDirectionalEdge(x, y, 0, 1, cell);
    const east = this.computeDirectionalEdge(x, y, 1, 0, cell);
    const west = this.computeDirectionalEdge(x, y, -1, 0, cell);

    // Count cliff edges
    const edges = [north, south, east, west];
    const cliffEdgeCount = edges.filter(e => e.type === 'cliff').length;

    // Compute corner types
    const corners = this.computeCorners(x, y, cell, north, south, east, west);

    return {
      x,
      y,
      isPlatform,
      elevation,
      north,
      south,
      east,
      west,
      hasCliffEdge: cliffEdgeCount > 0,
      cliffEdgeCount,
      corners,
    };
  }

  /**
   * Compute edge info for one direction
   */
  private computeDirectionalEdge(
    x: number,
    y: number,
    dx: number,
    dy: number,
    cell: EditorCell
  ): DirectionalEdge {
    const neighbor = this.getCell(x + dx, y + dy);

    // Map boundary - treat as cliff if platform
    if (!neighbor) {
      const isPlatform = this.isPlatformCell(cell);
      return {
        type: isPlatform ? 'cliff' : 'none',
        elevationDelta: cell.elevation,
        cliffHeight: isPlatform ? cell.elevation * HEIGHT_SCALE : 0,
        neighborTerrain: 'boundary',
      };
    }

    const elevationDelta = cell.elevation - neighbor.elevation;
    const isPlatform = this.isPlatformCell(cell);

    // Check for explicit edge override
    const edgeDirection = this.getEdgeDirection(dx, dy);
    const explicitStyle = this.getExplicitEdgeStyle(cell, edgeDirection);

    if (explicitStyle) {
      if (explicitStyle === 'natural') {
        return {
          type: 'natural',
          elevationDelta,
          cliffHeight: 0,
          neighborTerrain: neighbor.feature || 'ground',
        };
      }
      if (explicitStyle === 'ramp') {
        return {
          type: 'ramp',
          elevationDelta,
          cliffHeight: 0,
          neighborTerrain: 'ramp',
        };
      }
      // Explicit 'cliff' falls through to normal cliff logic
    }

    // Neighbor is a ramp - no cliff face
    if (neighbor.isRamp) {
      return {
        type: 'ramp',
        elevationDelta,
        cliffHeight: 0,
        neighborTerrain: 'ramp',
      };
    }

    // Not a platform cell - no cliff geometry
    if (!isPlatform) {
      return {
        type: 'none',
        elevationDelta,
        cliffHeight: 0,
        neighborTerrain: neighbor.feature || 'ground',
      };
    }

    // Platform cell - check for significant elevation drop
    if (elevationDelta >= CLIFF_THRESHOLD) {
      // Check if neighbor is also a platform at same level
      if (this.isPlatformCell(neighbor) && Math.abs(elevationDelta) < CLIFF_THRESHOLD) {
        return {
          type: 'none',
          elevationDelta,
          cliffHeight: 0,
          neighborTerrain: 'platform',
        };
      }

      return {
        type: 'cliff',
        elevationDelta,
        cliffHeight: elevationDelta * HEIGHT_SCALE,
        neighborTerrain: neighbor.feature || 'ground',
      };
    }

    // No significant elevation change
    return {
      type: 'none',
      elevationDelta,
      cliffHeight: 0,
      neighborTerrain: this.isPlatformCell(neighbor) ? 'platform' : (neighbor.feature || 'ground'),
    };
  }

  /**
   * Compute corner types for diagonal cliff geometry
   */
  private computeCorners(
    x: number,
    y: number,
    cell: EditorCell,
    north: DirectionalEdge,
    south: DirectionalEdge,
    east: DirectionalEdge,
    west: DirectionalEdge
  ): CellEdgeInfo['corners'] {
    // A convex corner is where two cliff edges meet (outside corner)
    // A concave corner is where cliff edges don't meet but diagonal is lower (inside corner)

    const nwCorner = this.computeCornerType(
      north.type === 'cliff',
      west.type === 'cliff',
      this.getCell(x - 1, y - 1),
      cell
    );

    const neCorner = this.computeCornerType(
      north.type === 'cliff',
      east.type === 'cliff',
      this.getCell(x + 1, y - 1),
      cell
    );

    const swCorner = this.computeCornerType(
      south.type === 'cliff',
      west.type === 'cliff',
      this.getCell(x - 1, y + 1),
      cell
    );

    const seCorner = this.computeCornerType(
      south.type === 'cliff',
      east.type === 'cliff',
      this.getCell(x + 1, y + 1),
      cell
    );

    return {
      nw: nwCorner,
      ne: neCorner,
      sw: swCorner,
      se: seCorner,
    };
  }

  /**
   * Determine corner type based on adjacent edges and diagonal cell
   */
  private computeCornerType(
    edge1IsCliff: boolean,
    edge2IsCliff: boolean,
    diagonalCell: EditorCell | null,
    cell: EditorCell
  ): 'convex' | 'concave' | 'none' {
    // Both edges are cliffs - convex (outside) corner
    if (edge1IsCliff && edge2IsCliff) {
      return 'convex';
    }

    // Neither edge is cliff - check diagonal for concave corner
    if (!edge1IsCliff && !edge2IsCliff) {
      if (diagonalCell && !diagonalCell.isRamp) {
        const elevDelta = cell.elevation - diagonalCell.elevation;
        if (elevDelta >= CLIFF_THRESHOLD && this.isPlatformCell(cell)) {
          return 'concave';
        }
      }
    }

    return 'none';
  }

  /**
   * Get a cell from the map data
   */
  private getCell(x: number, y: number): EditorCell | null {
    if (!this.mapData) return null;
    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return null;
    }
    return this.mapData.terrain[y][x];
  }

  /**
   * Check if a cell is a platform (has 'platform' terrain or explicit platform flag)
   */
  private isPlatformCell(cell: EditorCell): boolean {
    // Check for explicit platform terrain type in feature
    // The editor uses 'feature' to store terrain type info
    if (cell.feature === 'platform') return true;

    // Check walkable with high elevation (platform-like behavior)
    // This is a heuristic for cells that should render as platforms
    // In the full implementation, we'd have an explicit isPlatform flag
    return false;
  }

  /**
   * Convert dx/dy to edge direction name
   */
  private getEdgeDirection(dx: number, dy: number): EdgeDirection {
    if (dy < 0) return 'north';
    if (dy > 0) return 'south';
    if (dx > 0) return 'east';
    return 'west';
  }

  /**
   * Get explicit edge style override from cell data
   */
  private getExplicitEdgeStyle(
    cell: EditorCell,
    direction: EdgeDirection
  ): 'cliff' | 'natural' | 'ramp' | undefined {
    // EditorCell doesn't have edges field yet - this will be added
    // For now, return undefined to use auto-detection
    const cellWithEdges = cell as EditorCell & {
      edges?: {
        north?: 'cliff' | 'natural' | 'ramp';
        south?: 'cliff' | 'natural' | 'ramp';
        east?: 'cliff' | 'natural' | 'ramp';
        west?: 'cliff' | 'natural' | 'ramp';
      };
    };

    return cellWithEdges.edges?.[direction];
  }
}

/**
 * Singleton instance for shared edge detection
 */
let edgeDetectorInstance: EdgeDetector | null = null;

export function getEdgeDetector(): EdgeDetector {
  if (!edgeDetectorInstance) {
    edgeDetectorInstance = new EdgeDetector();
  }
  return edgeDetectorInstance;
}

export default EdgeDetector;
