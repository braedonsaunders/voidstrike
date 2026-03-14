/**
 * EditorNavigation - Recast Navigation integration for editor validation
 *
 * Uses the EXACT same navmesh generation as the game to ensure
 * validation results match in-game pathfinding behavior.
 *
 * Key principles:
 * 1. Same geometry generation as Terrain.generateWalkableGeometry()
 * 2. Same NAVMESH_CONFIG from pathfinding.config.ts
 * 3. Decoration obstacles applied same as game
 * 4. Pathfinding queries use same findPath logic
 */

import { init, NavMesh, NavMeshQuery, TileCache } from 'recast-navigation';
import { generateTileCache, generateSoloNavMesh } from '@recast-navigation/generators';
import type { EditorMapData, EditorObject } from '../config/EditorConfig';
import { NAVMESH_CONFIG, SOLO_NAVMESH_CONFIG } from '@/data/pathfinding.config';
import {
  sampleNavMeshHeightMap,
  generateWalkableNavmeshGeometry,
} from '@/data/maps/navmesh/generateWalkableNavmeshGeometry';
import type { MapCell, TerrainFeature } from '@/data/maps/MapTypes';

// Decoration radius mapping for obstacles (matches game's decoration configs)
const DECORATION_OBSTACLE_RADII: Record<string, number> = {
  decoration_rocks_large: 2.5,
  decoration_rocks_small: 1.5,
  decoration_rock_single: 1.0,
  decoration_crystal_formation: 1.5,
  decoration_tree_pine_tall: 0.8,
  decoration_tree_pine_medium: 0.6,
  decoration_tree_dead: 0.5,
  decoration_tree_alien: 0.8,
  decoration_tree_palm: 0.6,
  decoration_tree_mushroom: 0.8,
};

// Only add obstacles for decorations with radius > this threshold
const MIN_OBSTACLE_RADIUS = 0.5;
const WALKABLE_DISTANCE_TOLERANCE = Math.max(
  NAVMESH_CONFIG.walkableRadius * 1.5,
  NAVMESH_CONFIG.cs * 1.5
);
const WALKABLE_HEIGHT_TOLERANCE = NAVMESH_CONFIG.walkableClimb * 2;
const MAX_TILE_CACHE_UPDATES = 8;

export interface PathResult {
  path: Array<{ x: number; y: number }>;
  found: boolean;
}

export interface ValidationPathResult {
  from: string;
  to: string;
  found: boolean;
  distance?: number;
}

export interface EditorNavigationResult {
  success: boolean;
  error?: string;
  navMesh?: NavMesh;
  tileCache?: TileCache;
}

/**
 * EditorNavigation - Builds and queries navmesh for editor validation
 */
export class EditorNavigation {
  private static wasmInitialized = false;
  private static initPromise: Promise<void> | null = null;

  private navMesh: NavMesh | null = null;
  private navMeshQuery: NavMeshQuery | null = null;
  private tileCache: TileCache | null = null;
  private navMeshHeightMap: Float32Array | null = null;
  private mapWidth: number = 0;
  private mapHeight: number = 0;

  /**
   * Initialize WASM module (call once)
   */
  public static async initWasm(): Promise<void> {
    if (EditorNavigation.wasmInitialized) return;
    if (EditorNavigation.initPromise) return EditorNavigation.initPromise;

    EditorNavigation.initPromise = init()
      .then(() => {
        EditorNavigation.wasmInitialized = true;
        console.log('[EditorNavigation] WASM initialized');
      })
      .catch((error) => {
        console.error('[EditorNavigation] WASM initialization failed:', error);
        throw error;
      });

    return EditorNavigation.initPromise;
  }

  /**
   * Check if WASM is ready
   */
  public static isWasmReady(): boolean {
    return EditorNavigation.wasmInitialized;
  }

  /**
   * Build navmesh from editor map data
   * Uses exact same geometry generation as the game's Terrain class
   */
  public async buildFromMapData(mapData: EditorMapData): Promise<EditorNavigationResult> {
    try {
      // Ensure WASM is initialized
      await EditorNavigation.initWasm();

      this.mapWidth = mapData.width;
      this.mapHeight = mapData.height;
      this.navMeshHeightMap = null;

      // Generate walkable geometry (same logic as Terrain.generateWalkableGeometry)
      const { positions, indices } = this.generateWalkableGeometry(mapData);

      if (positions.length === 0 || indices.length === 0) {
        return {
          success: false,
          error: 'No walkable geometry generated',
        };
      }

      console.log(
        `[EditorNavigation] Generated geometry: ${positions.length / 3} vertices, ${indices.length / 3} triangles`
      );

      // Try tile cache first (supports dynamic obstacles)
      const result = generateTileCache(positions, indices, NAVMESH_CONFIG);

      if (result.success && result.tileCache && result.navMesh) {
        this.tileCache = result.tileCache;
        this.navMesh = result.navMesh;
        this.navMeshQuery = new NavMeshQuery(this.navMesh);

        // Add decoration obstacles
        this.addDecorationObstacles(mapData.objects);

        console.log('[EditorNavigation] TileCache navmesh generated successfully');
        return {
          success: true,
          navMesh: this.navMesh,
          tileCache: this.tileCache,
        };
      }

      // Fallback to solo navmesh (no dynamic obstacles)
      console.warn('[EditorNavigation] TileCache failed, trying solo navmesh...');
      const soloResult = generateSoloNavMesh(positions, indices, SOLO_NAVMESH_CONFIG);

      if (soloResult.success && soloResult.navMesh) {
        this.navMesh = soloResult.navMesh;
        this.navMeshQuery = new NavMeshQuery(this.navMesh);
        this.tileCache = null;

        console.log('[EditorNavigation] Solo navmesh generated (no decoration obstacles)');
        return {
          success: true,
          navMesh: this.navMesh,
        };
      }

      return {
        success: false,
        error: 'Failed to generate navmesh',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EditorNavigation] Error building navmesh:', error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate walkable geometry from editor map data
   * Mirrors Terrain.generateWalkableGeometry() exactly
   */
  private generateWalkableGeometry(mapData: EditorMapData): {
    positions: Float32Array;
    indices: Uint32Array;
  } {
    const terrain: MapCell[][] = mapData.terrain.map((row) =>
      row.map((cell) => ({
        terrain: cell.isRamp
          ? 'ramp'
          : cell.isPlatform
            ? 'platform'
            : cell.walkable
              ? 'ground'
              : 'unwalkable',
        elevation: cell.elevation,
        feature: (cell.feature as TerrainFeature) || 'none',
        textureId: cell.textureId || 0,
      }))
    );

    const geometry = generateWalkableNavmeshGeometry({
      terrain,
      width: mapData.width,
      height: mapData.height,
    });
    this.navMeshHeightMap = geometry.navMeshHeightMap;

    return {
      positions: geometry.positions,
      indices: geometry.indices,
    };
  }

  private getQueryHalfExtents(searchRadius: number): { x: number; y: number; z: number } {
    const heightTolerance = this.navMeshHeightMap ? WALKABLE_HEIGHT_TOLERANCE * 1.5 : 20;
    return { x: searchRadius, y: heightTolerance, z: searchRadius };
  }

  private getQueryHeight(x: number, y: number): number {
    if (!this.navMeshHeightMap) return 0;
    return sampleNavMeshHeightMap(this.navMeshHeightMap, this.mapWidth, this.mapHeight, x, y);
  }

  private getObstacleHeight(x: number, y: number): number {
    const height = this.getQueryHeight(x, y);
    return Number.isFinite(height) ? height : 0;
  }

  private applyTileCacheUpdates(): void {
    if (!this.tileCache || !this.navMesh) return;

    for (let i = 0; i < MAX_TILE_CACHE_UPDATES; i++) {
      const { upToDate } = this.tileCache.update(this.navMesh);
      if (upToDate) {
        break;
      }
    }
  }

  /**
   * Add decoration obstacles to the navmesh
   * Only adds obstacles for decorations with sufficient radius
   */
  private addDecorationObstacles(objects: EditorObject[]): void {
    if (!this.tileCache || !this.navMesh) {
      console.warn('[EditorNavigation] Cannot add decoration obstacles: no TileCache');
      return;
    }

    let obstacleCount = 0;

    for (const obj of objects) {
      // Check if this is a decoration type
      const radius = DECORATION_OBSTACLE_RADII[obj.type];
      if (radius === undefined || radius < MIN_OBSTACLE_RADIUS) continue;

      // Apply scale if present
      const scale = (obj.properties?.scale as number) ?? 1.0;
      const scaledRadius = radius * scale;

      if (scaledRadius < MIN_OBSTACLE_RADIUS) continue;

      try {
        const obstacleY = this.getObstacleHeight(obj.x, obj.y);

        // Add as cylinder obstacle
        const result = this.tileCache.addCylinderObstacle(
          { x: obj.x, y: obstacleY, z: obj.y },
          scaledRadius + 0.1, // Small expansion for precision
          2.0 // Height
        );

        if (result.success) {
          obstacleCount++;
        }
      } catch {
        // Ignore individual obstacle failures
      }
    }

    // Update navmesh with obstacles
    if (obstacleCount > 0) {
      this.applyTileCacheUpdates();
      console.log(`[EditorNavigation] Added ${obstacleCount} decoration obstacles`);
    }
  }

  /**
   * Find path between two points
   * Same logic as RecastNavigation.findPath()
   */
  public findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    agentRadius: number = 0.5
  ): PathResult {
    if (!this.navMeshQuery) {
      return { path: [], found: false };
    }

    try {
      const searchRadius = Math.max(agentRadius * 4, 2);
      const halfExtents = this.getQueryHalfExtents(searchRadius);

      const startQuery = { x: startX, y: this.getQueryHeight(startX, startY), z: startY };
      const endQuery = { x: endX, y: this.getQueryHeight(endX, endY), z: endY };

      const startOnMesh = this.navMeshQuery.findClosestPoint(startQuery, { halfExtents });
      const endOnMesh = this.navMeshQuery.findClosestPoint(endQuery, { halfExtents });

      if (!startOnMesh.success || !startOnMesh.point || !endOnMesh.success || !endOnMesh.point) {
        return { path: [], found: false };
      }

      const pathResult = this.navMeshQuery.computePath(startOnMesh.point, endOnMesh.point, {
        halfExtents,
      });

      if (!pathResult.success || !pathResult.path || pathResult.path.length === 0) {
        return { path: [], found: false };
      }

      // Convert to 2D path
      const path = pathResult.path.map((p) => ({
        x: p.x,
        y: p.z, // z in 3D is y in 2D (our coordinate system)
      }));

      return { path, found: true };
    } catch {
      return { path: [], found: false };
    }
  }

  /**
   * Check if a point is on the navmesh (walkable)
   */
  public isWalkable(x: number, y: number): boolean {
    if (!this.navMeshQuery) return false;

    try {
      const queryHeight = this.getQueryHeight(x, y);
      const halfExtents = this.getQueryHalfExtents(2);
      const query = { x, y: queryHeight, z: y };

      const result = this.navMeshQuery.findClosestPoint(query, { halfExtents });
      if (!result.success || !result.point) return false;

      const dx = result.point.x - x;
      const dz = result.point.z - y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const heightDiff = Math.abs(result.point.y - queryHeight);

      return dist < WALKABLE_DISTANCE_TOLERANCE && heightDiff <= WALKABLE_HEIGHT_TOLERANCE;
    } catch {
      return false;
    }
  }

  /**
   * Validate paths between all bases
   * Returns results for each base pair
   */
  public validateBasePaths(mapData: EditorMapData): ValidationPathResult[] {
    const results: ValidationPathResult[] = [];

    // Get all main bases and naturals
    const mainBases = mapData.objects.filter((obj) => obj.type === 'main_base');
    const naturals = mapData.objects.filter((obj) => obj.type === 'natural');

    // Test paths between all main bases
    for (let i = 0; i < mainBases.length; i++) {
      for (let j = i + 1; j < mainBases.length; j++) {
        const baseA = mainBases[i];
        const baseB = mainBases[j];

        const pathResult = this.findPath(baseA.x, baseA.y, baseB.x, baseB.y);

        results.push({
          from: `Main Base ${i + 1}`,
          to: `Main Base ${j + 1}`,
          found: pathResult.found,
          distance: pathResult.found ? this.calculatePathDistance(pathResult.path) : undefined,
        });
      }
    }

    // Test paths from each main base to nearest natural
    for (let i = 0; i < mainBases.length; i++) {
      const mainBase = mainBases[i];

      // Find closest natural
      let closestNatural: EditorObject | null = null;
      let closestDist = Infinity;

      for (const natural of naturals) {
        const dx = natural.x - mainBase.x;
        const dy = natural.y - mainBase.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          closestDist = dist;
          closestNatural = natural;
        }
      }

      if (closestNatural) {
        const pathResult = this.findPath(
          mainBase.x,
          mainBase.y,
          closestNatural.x,
          closestNatural.y
        );

        results.push({
          from: `Main Base ${i + 1}`,
          to: `Nearest Natural`,
          found: pathResult.found,
          distance: pathResult.found ? this.calculatePathDistance(pathResult.path) : undefined,
        });
      }
    }

    return results;
  }

  /**
   * Calculate total path distance
   */
  private calculatePathDistance(path: Array<{ x: number; y: number }>): number {
    let distance = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      distance += Math.sqrt(dx * dx + dy * dy);
    }
    return distance;
  }

  /**
   * Dispose of navmesh resources
   */
  public dispose(): void {
    this.navMesh = null;
    this.navMeshQuery = null;
    this.tileCache = null;
    this.navMeshHeightMap = null;
  }
}

// Singleton instance for editor use
let editorNavigationInstance: EditorNavigation | null = null;

export function getEditorNavigation(): EditorNavigation {
  if (!editorNavigationInstance) {
    editorNavigationInstance = new EditorNavigation();
  }
  return editorNavigationInstance;
}

export function resetEditorNavigation(): void {
  if (editorNavigationInstance) {
    editorNavigationInstance.dispose();
    editorNavigationInstance = null;
  }
}
