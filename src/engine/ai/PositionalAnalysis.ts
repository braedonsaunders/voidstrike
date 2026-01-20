/**
 * Positional Analysis System for RTS AI
 *
 * Analyzes the map to identify strategic terrain features:
 * - Choke points (narrow passages for defensive positioning)
 * - High ground positions (vision/attack advantages)
 * - Defensible positions (good spots for bases/defensive structures)
 * - Attack paths (routes between bases)
 * - Expansion locations (safe areas for new bases)
 *
 * Pre-computed at map load, cached for runtime queries.
 */

import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { Selectable } from '../components/Selectable';
import { Health } from '../components/Health';
import { distance } from '@/utils/math';

/**
 * Types of strategic positions
 */
export type PositionType =
  | 'choke' // Narrow passage
  | 'high_ground' // Elevated terrain
  | 'defensible' // Good defensive position
  | 'expansion' // Good expansion location
  | 'open' // Wide open area
  | 'ramp'; // Ramp between elevations

/**
 * Strategic position on the map
 */
export interface StrategicPosition {
  x: number;
  y: number;
  type: PositionType;
  /** Quality score 0-1 (higher = better) */
  quality: number;
  /** Width of passage at chokes */
  width?: number;
  /** Direction facing (for ramps/chokes) */
  facing?: { x: number; y: number };
  /** Connected positions (for path analysis) */
  connections: number[]; // Indices of connected positions
}

/**
 * Attack path between two points
 */
export interface AttackPath {
  start: { x: number; y: number };
  end: { x: number; y: number };
  waypoints: Array<{ x: number; y: number }>;
  /** Choke indices along this path */
  chokes: number[];
  /** Total path length */
  length: number;
  /** Danger level 0-1 (based on chokes, narrow passages) */
  difficulty: number;
}

/**
 * Analysis cache for a map
 */
interface MapAnalysis {
  /** All strategic positions */
  positions: StrategicPosition[];
  /** Choke point indices */
  chokeIndices: number[];
  /** Expansion location indices */
  expansionIndices: number[];
  /** Defensible position indices */
  defensibleIndices: number[];
  /** Pre-computed attack paths between common start points */
  attackPaths: Map<string, AttackPath>;
  /** Passability grid */
  passable: Uint8Array;
  /** Distance field from map edges */
  edgeDistance: Float32Array;
}

/**
 * Positional Analysis - Static terrain analysis for strategic AI
 */
export class PositionalAnalysis {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly mapWidth: number;
  private readonly mapHeight: number;

  private analysis: MapAnalysis | null = null;

  // Minimum width for a choke (cells)
  private readonly minChokeWidth: number = 2;
  private readonly maxChokeWidth: number = 6;

  constructor(mapWidth: number, mapHeight: number, cellSize: number = 2) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.cellSize = cellSize;
    this.cols = Math.ceil(mapWidth / cellSize);
    this.rows = Math.ceil(mapHeight / cellSize);
  }

  /**
   * Analyze the map and cache results
   * Should be called once when map loads
   */
  public analyzeMap(world: World): void {
    // Initialize analysis structure
    const gridSize = this.cols * this.rows;
    this.analysis = {
      positions: [],
      chokeIndices: [],
      expansionIndices: [],
      defensibleIndices: [],
      attackPaths: new Map(),
      passable: new Uint8Array(gridSize),
      edgeDistance: new Float32Array(gridSize),
    };

    // Build passability grid from buildings
    this.buildPassabilityGrid(world);

    // Calculate distance from edges (for choke detection)
    this.calculateEdgeDistances();

    // Find choke points
    this.findChokePoints();

    // Find expansion locations
    this.findExpansionLocations(world);

    // Find defensible positions
    this.findDefensiblePositions();

    // Build connections between strategic positions
    this.buildPositionConnections();
  }

  /**
   * Build passability grid from buildings and terrain
   */
  private buildPassabilityGrid(world: World): void {
    if (!this.analysis) return;

    // Start with all cells passable
    this.analysis.passable.fill(1);

    // Mark building cells as impassable
    const buildings = world.getEntitiesWith('Building', 'Transform');

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      // Mark cells occupied by building
      const halfW = building.width / 2;
      const halfH = building.height / 2;

      const minCol = Math.floor((transform.x - halfW) / this.cellSize);
      const maxCol = Math.floor((transform.x + halfW) / this.cellSize);
      const minRow = Math.floor((transform.y - halfH) / this.cellSize);
      const maxRow = Math.floor((transform.y + halfH) / this.cellSize);

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            const index = row * this.cols + col;
            this.analysis.passable[index] = 0;
          }
        }
      }
    }
  }

  /**
   * Calculate distance from nearest impassable cell/edge
   * Used for choke point detection
   */
  private calculateEdgeDistances(): void {
    if (!this.analysis) return;

    const { passable, edgeDistance } = this.analysis;

    // Initialize: edges and impassable = 0, others = max
    const MAX_DIST = Math.max(this.cols, this.rows);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const index = row * this.cols + col;
        if (row === 0 || row === this.rows - 1 || col === 0 || col === this.cols - 1) {
          edgeDistance[index] = 0;
        } else if (passable[index] === 0) {
          edgeDistance[index] = 0;
        } else {
          edgeDistance[index] = MAX_DIST;
        }
      }
    }

    // Two-pass distance transform
    // Forward pass
    for (let row = 1; row < this.rows - 1; row++) {
      for (let col = 1; col < this.cols - 1; col++) {
        const index = row * this.cols + col;
        const d = edgeDistance[index];
        edgeDistance[index] = Math.min(
          d,
          edgeDistance[(row - 1) * this.cols + col] + 1,
          edgeDistance[row * this.cols + (col - 1)] + 1,
          edgeDistance[(row - 1) * this.cols + (col - 1)] + 1.414
        );
      }
    }

    // Backward pass
    for (let row = this.rows - 2; row > 0; row--) {
      for (let col = this.cols - 2; col > 0; col--) {
        const index = row * this.cols + col;
        const d = edgeDistance[index];
        edgeDistance[index] = Math.min(
          d,
          edgeDistance[(row + 1) * this.cols + col] + 1,
          edgeDistance[row * this.cols + (col + 1)] + 1,
          edgeDistance[(row + 1) * this.cols + (col + 1)] + 1.414
        );
      }
    }
  }

  /**
   * Find choke points - narrow passages between wider areas
   */
  private findChokePoints(): void {
    if (!this.analysis) return;

    const { passable, edgeDistance, positions, chokeIndices } = this.analysis;

    // Find local minima in edge distance that are still passable
    for (let row = 2; row < this.rows - 2; row++) {
      for (let col = 2; col < this.cols - 2; col++) {
        const index = row * this.cols + col;

        if (passable[index] === 0) continue;

        const dist = edgeDistance[index];

        // Skip if too narrow (wall) or too wide (open area)
        if (dist < this.minChokeWidth || dist > this.maxChokeWidth) continue;

        // Check if this is a local minimum in edge distance
        let isLocalMin = true;
        let hasWiderNeighbors = false;

        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (dr === 0 && dc === 0) continue;

            const nr = row + dr;
            const nc = col + dc;
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;

            const ni = nr * this.cols + nc;
            if (passable[ni] === 0) continue;

            if (edgeDistance[ni] < dist) {
              isLocalMin = false;
            }
            if (edgeDistance[ni] > dist + 1) {
              hasWiderNeighbors = true;
            }
          }
        }

        // Choke point: local minimum with wider areas on sides
        if (isLocalMin && hasWiderNeighbors) {
          // Calculate choke direction (perpendicular to narrow axis)
          const { fx, fy } = this.calculateChokeDirection(row, col);

          const posIndex = positions.length;
          positions.push({
            x: (col + 0.5) * this.cellSize,
            y: (row + 0.5) * this.cellSize,
            type: 'choke',
            quality: 1 - (dist / this.maxChokeWidth), // Narrower = higher quality
            width: dist * this.cellSize,
            facing: { x: fx, y: fy },
            connections: [],
          });
          chokeIndices.push(posIndex);
        }
      }
    }

    // Cluster nearby choke points and keep best
    this.clusterPositions(chokeIndices, 6);
  }

  /**
   * Calculate the direction a choke faces (perpendicular to narrow axis)
   */
  private calculateChokeDirection(row: number, col: number): { fx: number; fy: number } {
    if (!this.analysis) return { fx: 0, fy: 1 };

    const { edgeDistance } = this.analysis;

    // Sample in 4 directions to find which axis is narrow
    const horz = (edgeDistance[row * this.cols + (col - 1)] + edgeDistance[row * this.cols + (col + 1)]) / 2;
    const vert = (edgeDistance[(row - 1) * this.cols + col] + edgeDistance[(row + 1) * this.cols + col]) / 2;

    // Facing perpendicular to narrow axis
    if (horz > vert) {
      return { fx: 0, fy: 1 }; // Narrow vertically, face up/down
    }
    return { fx: 1, fy: 0 }; // Narrow horizontally, face left/right
  }

  /**
   * Find good expansion locations (near resources, defensible)
   */
  private findExpansionLocations(world: World): void {
    if (!this.analysis) return;

    // Get resource locations
    const resources = world.getEntitiesWith('Resource', 'Transform');
    const resourceClusters: Array<{ x: number; y: number; count: number }> = [];

    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      if (resource.resourceType !== 'minerals') continue;

      // Find or create cluster
      let addedToCluster = false;
      for (const cluster of resourceClusters) {
        if (distance(transform.x, transform.y, cluster.x, cluster.y) < 10) {
          // Update cluster center
          cluster.x = (cluster.x * cluster.count + transform.x) / (cluster.count + 1);
          cluster.y = (cluster.y * cluster.count + transform.y) / (cluster.count + 1);
          cluster.count++;
          addedToCluster = true;
          break;
        }
      }

      if (!addedToCluster) {
        resourceClusters.push({ x: transform.x, y: transform.y, count: 1 });
      }
    }

    // Mark resource clusters as expansion locations
    for (const cluster of resourceClusters) {
      if (cluster.count < 3) continue; // Skip small clusters

      // Find best position near cluster
      const pos = this.findDefensibleSpotNear(cluster.x, cluster.y, 8);
      if (pos) {
        const posIndex = this.analysis.positions.length;
        this.analysis.positions.push({
          x: pos.x,
          y: pos.y,
          type: 'expansion',
          quality: cluster.count / 10, // More resources = higher quality
          connections: [],
        });
        this.analysis.expansionIndices.push(posIndex);
      }
    }
  }

  /**
   * Find a defensible spot near a position
   */
  private findDefensibleSpotNear(x: number, y: number, radius: number): { x: number; y: number } | null {
    if (!this.analysis) return null;

    const { passable, edgeDistance } = this.analysis;
    const centerCol = Math.floor(x / this.cellSize);
    const centerRow = Math.floor(y / this.cellSize);
    const radiusCells = Math.ceil(radius / this.cellSize);

    let bestScore = -Infinity;
    let bestPos: { x: number; y: number } | null = null;

    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        const col = centerCol + dc;
        const row = centerRow + dr;

        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) continue;

        const index = row * this.cols + col;
        if (passable[index] === 0) continue;

        const dist = distance(0, 0, dc, dr);
        const edgeDist = edgeDistance[index];

        // Score: far from original position is bad, near walls is good
        const score = -dist * 0.5 + edgeDist * 0.3;

        if (score > bestScore) {
          bestScore = score;
          bestPos = {
            x: (col + 0.5) * this.cellSize,
            y: (row + 0.5) * this.cellSize,
          };
        }
      }
    }

    return bestPos;
  }

  /**
   * Find defensible positions (corners, chokepoint-protected areas)
   */
  private findDefensiblePositions(): void {
    if (!this.analysis) return;

    const { passable, edgeDistance, positions, defensibleIndices, chokeIndices } = this.analysis;

    // Areas behind choke points are defensible
    for (const chokeIdx of chokeIndices) {
      const choke = positions[chokeIdx];
      if (!choke.facing) continue;

      // Position behind the choke (relative to facing)
      const behindX = choke.x - choke.facing.x * 10;
      const behindY = choke.y - choke.facing.y * 10;

      const col = Math.floor(behindX / this.cellSize);
      const row = Math.floor(behindY / this.cellSize);

      if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) continue;

      const index = row * this.cols + col;
      if (passable[index] === 0) continue;

      // Check this isn't too close to existing position
      let tooClose = false;
      for (const existing of positions) {
        if (distance(existing.x, existing.y, behindX, behindY) < 5) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        const posIndex = positions.length;
        positions.push({
          x: behindX,
          y: behindY,
          type: 'defensible',
          quality: choke.quality, // Inherit choke quality
          connections: [chokeIdx], // Connected to the choke
        });
        defensibleIndices.push(posIndex);
      }
    }
  }

  /**
   * Cluster nearby positions and keep only the best
   */
  private clusterPositions(indices: number[], minDistance: number): void {
    if (!this.analysis) return;

    const { positions } = this.analysis;
    const toRemove = new Set<number>();

    for (let i = 0; i < indices.length; i++) {
      if (toRemove.has(indices[i])) continue;

      const pos1 = positions[indices[i]];

      for (let j = i + 1; j < indices.length; j++) {
        if (toRemove.has(indices[j])) continue;

        const pos2 = positions[indices[j]];
        const dist = distance(pos1.x, pos1.y, pos2.x, pos2.y);

        if (dist < minDistance) {
          // Keep higher quality
          if (pos1.quality >= pos2.quality) {
            toRemove.add(indices[j]);
          } else {
            toRemove.add(indices[i]);
            break;
          }
        }
      }
    }

    // Remove clustered positions from indices
    for (let i = indices.length - 1; i >= 0; i--) {
      if (toRemove.has(indices[i])) {
        indices.splice(i, 1);
      }
    }
  }

  /**
   * Build connections between strategic positions
   */
  private buildPositionConnections(): void {
    if (!this.analysis) return;

    const { positions } = this.analysis;

    // Connect positions that are within line of sight
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const p1 = positions[i];
        const p2 = positions[j];

        const dist = distance(p1.x, p1.y, p2.x, p2.y);

        // Only connect nearby positions
        if (dist > 30) continue;

        // Check line of sight (simple raycast)
        if (this.hasLineOfSight(p1.x, p1.y, p2.x, p2.y)) {
          p1.connections.push(j);
          p2.connections.push(i);
        }
      }
    }
  }

  /**
   * Check if there's a clear path between two points
   */
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    if (!this.analysis) return false;

    const { passable } = this.analysis;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = distance(x1, y1, x2, y2);
    const steps = Math.ceil(dist / this.cellSize);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;

      const col = Math.floor(x / this.cellSize);
      const row = Math.floor(y / this.cellSize);

      if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;

      const index = row * this.cols + col;
      if (passable[index] === 0) return false;
    }

    return true;
  }

  // ==================== RUNTIME QUERIES ====================

  /**
   * Get all choke points on the map
   */
  public getChokePoints(): StrategicPosition[] {
    if (!this.analysis) return [];
    return this.analysis.chokeIndices.map(i => this.analysis!.positions[i]);
  }

  /**
   * Get all expansion locations
   */
  public getExpansionLocations(): StrategicPosition[] {
    if (!this.analysis) return [];
    return this.analysis.expansionIndices.map(i => this.analysis!.positions[i]);
  }

  /**
   * Get all defensible positions
   */
  public getDefensiblePositions(): StrategicPosition[] {
    if (!this.analysis) return [];
    return this.analysis.defensibleIndices.map(i => this.analysis!.positions[i]);
  }

  /**
   * Find nearest choke point to a position
   */
  public getNearestChoke(x: number, y: number): StrategicPosition | null {
    const chokes = this.getChokePoints();
    if (chokes.length === 0) return null;

    let nearest: StrategicPosition | null = null;
    let nearestDist = Infinity;

    for (const choke of chokes) {
      const dist = distance(x, y, choke.x, choke.y);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = choke;
      }
    }

    return nearest;
  }

  /**
   * Find nearest defensible position
   */
  public getNearestDefensible(x: number, y: number): StrategicPosition | null {
    const positions = this.getDefensiblePositions();
    if (positions.length === 0) return null;

    let nearest: StrategicPosition | null = null;
    let nearestDist = Infinity;

    for (const pos of positions) {
      const dist = distance(x, y, pos.x, pos.y);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = pos;
      }
    }

    return nearest;
  }

  /**
   * Get strategic positions within a radius
   */
  public getPositionsInRadius(
    x: number,
    y: number,
    radius: number,
    type?: PositionType
  ): StrategicPosition[] {
    if (!this.analysis) return [];

    const results: StrategicPosition[] = [];

    for (const pos of this.analysis.positions) {
      if (type && pos.type !== type) continue;

      if (distance(x, y, pos.x, pos.y) <= radius) {
        results.push(pos);
      }
    }

    return results;
  }

  /**
   * Check if a position is at a choke point
   */
  public isAtChoke(x: number, y: number, tolerance: number = 4): boolean {
    const nearest = this.getNearestChoke(x, y);
    if (!nearest) return false;

    return distance(x, y, nearest.x, nearest.y) <= tolerance;
  }

  /**
   * Get the passability of a position (0 = blocked, 1 = passable)
   */
  public isPassable(x: number, y: number): boolean {
    if (!this.analysis) return true;

    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;

    const index = row * this.cols + col;
    return this.analysis.passable[index] === 1;
  }

  /**
   * Get edge distance at a position (for terrain analysis)
   */
  public getEdgeDistance(x: number, y: number): number {
    if (!this.analysis) return 0;

    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 0;

    const index = row * this.cols + col;
    return this.analysis.edgeDistance[index] * this.cellSize;
  }

  /**
   * Clear analysis (for map reload)
   */
  public clear(): void {
    this.analysis = null;
  }
}
