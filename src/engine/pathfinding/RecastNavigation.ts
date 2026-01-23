/**
 * Recast Navigation Integration
 *
 * Industry-standard WASM pathfinding using recast-navigation-js.
 * Replaces custom A*, HPA*, and RVO implementations with:
 * - NavMesh generation from terrain geometry
 * - NavMeshQuery for O(1) path lookups
 * - DetourCrowd for RVO-based collision avoidance
 * - TileCache for dynamic obstacles (buildings)
 */

import {
  init,
  NavMesh,
  NavMeshQuery,
  Crowd,
  TileCache,
  exportNavMesh,
  importNavMesh,
  type CrowdAgentParams,
  type Obstacle,
} from 'recast-navigation';
import { generateTileCache, generateSoloNavMesh, type TileCacheGeneratorConfig, type SoloNavMeshGeneratorConfig } from '@recast-navigation/generators';
import { threeToTileCache } from '@recast-navigation/three';
import * as THREE from 'three';
import { debugPathfinding, debugInitialization } from '@/utils/debugLogger';
import { distance } from '@/utils/math';

// Import centralized pathfinding config - SINGLE SOURCE OF TRUTH
// See src/data/pathfinding.config.ts for parameter documentation
import {
  NAVMESH_CONFIG,
  SOLO_NAVMESH_CONFIG,
  CROWD_CONFIG,
  DEFAULT_AGENT_RADIUS,
} from '@/data/pathfinding.config';

// Agent config for different unit types
// Use crowd for pathfinding direction, but disable RVO obstacle avoidance
// to prevent jitter. Unit-to-unit collision is handled by physics pushing instead.
const DEFAULT_AGENT_PARAMS: Partial<CrowdAgentParams> = {
  radius: 0.5,
  height: 2.0,
  maxAcceleration: 100.0, // High for instant acceleration feel
  maxSpeed: 5.0,
  collisionQueryRange: 2.5,
  pathOptimizationRange: 10.0,
  separationWeight: 0.0, // Disabled - we handle separation with physics pushing
  // Disable obstacle avoidance to prevent jitter
  // Only use crowd for path corridor following, not local avoidance
  updateFlags: 0x1, // DT_CROWD_ANTICIPATE_TURNS only, no obstacle avoidance
  obstacleAvoidanceType: 0, // Disabled
  queryFilterType: 0,
};

export interface PathResult {
  path: Array<{ x: number; y: number }>;
  found: boolean;
}

export interface RecastAgentHandle {
  agentIndex: number;
  entityId: number;
}

/**
 * Terrain height provider callback type.
 * Given (x, z) world coordinates, returns approximate terrain height.
 */
export type TerrainHeightProvider = (x: number, z: number) => number;

/**
 * Main Recast Navigation Manager
 *
 * Handles navmesh generation, path queries, and crowd simulation.
 */
export class RecastNavigation {
  private static instance: RecastNavigation | null = null;
  private static initPromise: Promise<void> | null = null;

  private navMesh: NavMesh | null = null;
  private navMeshQuery: NavMeshQuery | null = null;
  private tileCache: TileCache | null = null;
  private crowd: Crowd | null = null;

  // Track agents by entity ID
  private agentMap: Map<number, number> = new Map(); // entityId -> agentIndex
  private agentEntityMap: Map<number, number> = new Map(); // agentIndex -> entityId

  // Track obstacle references for buildings
  private obstacleRefs: Map<number, Obstacle> = new Map(); // buildingEntityId -> obstacle

  // Map dimensions for coordinate conversion
  private mapWidth: number = 0;
  private mapHeight: number = 0;

  // Initialization state
  private initialized: boolean = false;

  // Terrain height provider for elevation-aware queries
  private terrainHeightProvider: TerrainHeightProvider | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): RecastNavigation {
    if (!RecastNavigation.instance) {
      RecastNavigation.instance = new RecastNavigation();
    }
    return RecastNavigation.instance;
  }

  /**
   * Reset singleton (for game restart)
   */
  public static resetInstance(): void {
    if (RecastNavigation.instance) {
      RecastNavigation.instance.dispose();
      RecastNavigation.instance = null;
    }
  }

  /**
   * Initialize WASM module (call once at app start)
   *
   * Note: This requires the server to send proper security headers for SharedArrayBuffer:
   * - Cross-Origin-Opener-Policy: same-origin
   * - Cross-Origin-Embedder-Policy: require-corp
   *
   * Without these headers, Safari (and other browsers in certain contexts) will fail
   * to initialize the WASM module.
   */
  public static async initWasm(): Promise<void> {
    if (RecastNavigation.initPromise) {
      return RecastNavigation.initPromise;
    }

    // Check for SharedArrayBuffer availability (required for threaded WASM)
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    console.log('[RecastNavigation] SharedArrayBuffer available:', hasSharedArrayBuffer);

    if (!hasSharedArrayBuffer) {
      console.warn(
        '[RecastNavigation] SharedArrayBuffer is not available. ' +
        'This may be due to missing security headers (COOP/COEP). ' +
        'Navmesh initialization may fail on Safari and other browsers.'
      );
    }

    console.log('[RecastNavigation] Initializing WASM module...');

    // Create a timeout promise to prevent infinite hangs
    const INIT_TIMEOUT_MS = 10000; // 10 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`WASM initialization timed out after ${INIT_TIMEOUT_MS}ms`));
      }, INIT_TIMEOUT_MS);
    });

    RecastNavigation.initPromise = Promise.race([init(), timeoutPromise])
      .then(() => {
        console.log('[RecastNavigation] WASM module initialized successfully');
      })
      .catch((error) => {
        console.error('[RecastNavigation] WASM initialization failed:', error);
        console.error(
          '[RecastNavigation] If this is Safari, ensure the server sends these headers:\n' +
          '  Cross-Origin-Opener-Policy: same-origin\n' +
          '  Cross-Origin-Embedder-Policy: require-corp'
        );
        // Clear the promise so initialization can be retried
        RecastNavigation.initPromise = null;
        throw error;
      });

    return RecastNavigation.initPromise;
  }

  /**
   * Check if system is ready
   */
  public isReady(): boolean {
    return this.initialized && this.navMesh !== null && this.navMeshQuery !== null;
  }

  /**
   * Set terrain height provider for elevation-aware queries.
   * When set, pathfinding queries will start at approximate terrain height
   * instead of y=0, improving accuracy on multi-elevation terrain.
   */
  public setTerrainHeightProvider(provider: TerrainHeightProvider | null): void {
    this.terrainHeightProvider = provider;
  }

  /**
   * Get approximate terrain height at a position.
   * Returns 0 if no terrain height provider is set.
   */
  private getTerrainHeight(x: number, z: number): number {
    if (this.terrainHeightProvider) {
      return this.terrainHeightProvider(x, z);
    }
    return 0;
  }

  /**
   * Project a 2D point onto the navmesh surface.
   * Returns the 3D navmesh position (x, y, z) or null if no valid point found.
   *
   * This is critical for crowd operations - DetourCrowd needs positions that
   * are actually ON the navmesh surface. Without projection, agents placed at
   * y=0 on elevated terrain won't have valid polygon references.
   */
  public projectToNavMesh(
    x: number,
    z: number,
    halfExtents?: { x: number; y: number; z: number }
  ): { x: number; y: number; z: number } | null {
    if (!this.navMeshQuery) return null;

    try {
      // Start query at approximate terrain height for better accuracy
      const queryY = this.getTerrainHeight(x, z);

      // Use provided halfExtents or default with generous height tolerance
      const searchExtents = halfExtents ?? { x: 2, y: 10, z: 2 };

      const result = this.navMeshQuery.findClosestPoint(
        { x, y: queryY, z },
        { halfExtents: searchExtents }
      );

      if (result.success && result.point) {
        return { x: result.point.x, y: result.point.y, z: result.point.z };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate navmesh from terrain mesh
   *
   * @param walkableMesh - Three.js mesh containing only walkable terrain
   * @param mapWidth - Map width in world units
   * @param mapHeight - Map height in world units
   */
  public async generateFromTerrain(
    walkableMesh: THREE.Mesh,
    mapWidth: number,
    mapHeight: number
  ): Promise<boolean> {
    const startTime = performance.now();

    try {
      // Ensure WASM is initialized
      await RecastNavigation.initWasm();

      this.mapWidth = mapWidth;
      this.mapHeight = mapHeight;

      // Convert Three.js mesh to navmesh using TileCache for dynamic obstacles
      const result = threeToTileCache([walkableMesh], NAVMESH_CONFIG);

      if (!result.success || !result.tileCache || !result.navMesh) {
        debugPathfinding.warn('[RecastNavigation] Failed to generate navmesh from terrain mesh');
        return false;
      }

      this.tileCache = result.tileCache;
      this.navMesh = result.navMesh;
      this.navMeshQuery = new NavMeshQuery(this.navMesh);

      // Initialize crowd simulation
      this.crowd = new Crowd(this.navMesh, {
        maxAgents: CROWD_CONFIG.maxAgents,
        maxAgentRadius: CROWD_CONFIG.maxAgentRadius,
      });

      this.initialized = true;

      const elapsed = performance.now() - startTime;
      debugPathfinding.log(
        `[RecastNavigation] NavMesh generated in ${elapsed.toFixed(1)}ms for ${mapWidth}x${mapHeight} map`
      );

      return true;
    } catch (error) {
      debugPathfinding.warn('[RecastNavigation] Error generating navmesh:', error);
      return false;
    }
  }

  /**
   * Generate navmesh from raw geometry data
   * Used when we need to filter walkable triangles
   */
  public async generateFromGeometry(
    positions: Float32Array,
    indices: Uint32Array,
    mapWidth: number,
    mapHeight: number
  ): Promise<boolean> {
    const startTime = performance.now();

    console.log(`[RecastNavigation] generateFromGeometry called: ${positions.length / 3} vertices, ${indices.length / 3} triangles, map ${mapWidth}x${mapHeight}`);

    try {
      console.log('[RecastNavigation] Waiting for WASM initialization...');
      await RecastNavigation.initWasm();
      console.log('[RecastNavigation] WASM initialization complete, proceeding...');

      this.mapWidth = mapWidth;
      this.mapHeight = mapHeight;

      // Calculate geometry bounds for debugging
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }

      // Use console.log for production visibility of critical info
      console.log(`[RecastNavigation] Generating navmesh: ${indices.length / 3} triangles, ${positions.length / 3} vertices`);
      console.log(`[RecastNavigation] Geometry bounds: X=[${minX.toFixed(1)}, ${maxX.toFixed(1)}], Y(height)=[${minY.toFixed(2)}, ${maxY.toFixed(2)}], Z=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
      console.log(`[RecastNavigation] Config: walkableClimb=${NAVMESH_CONFIG.walkableClimb}, walkableSlopeAngle=${NAVMESH_CONFIG.walkableSlopeAngle}`);

      debugInitialization.log('[RecastNavigation] Generating navmesh from geometry...', {
        positionsLength: positions.length,
        indicesLength: indices.length,
        triangles: indices.length / 3,
        vertices: positions.length / 3,
        mapWidth,
        mapHeight,
      });
      debugInitialization.log('[RecastNavigation] Geometry bounds:', {
        x: `${minX.toFixed(2)} to ${maxX.toFixed(2)} (${(maxX - minX).toFixed(2)} total)`,
        y: `${minY.toFixed(2)} to ${maxY.toFixed(2)} (${(maxY - minY).toFixed(2)} height range)`,
        z: `${minZ.toFixed(2)} to ${maxZ.toFixed(2)} (${(maxZ - minZ).toFixed(2)} total)`,
      });
      debugInitialization.log('[RecastNavigation] Config:', {
        cs: NAVMESH_CONFIG.cs,
        ch: NAVMESH_CONFIG.ch,
        tileSize: NAVMESH_CONFIG.tileSize,
        expectedLayersPerTile: NAVMESH_CONFIG.expectedLayersPerTile,
        walkableSlopeAngle: NAVMESH_CONFIG.walkableSlopeAngle,
        walkableClimb: NAVMESH_CONFIG.walkableClimb,
      });

      // Try tile cache generation first (supports dynamic obstacles)
      const result = generateTileCache(positions, indices, NAVMESH_CONFIG);

      debugInitialization.log('[RecastNavigation] TileCache result:', {
        success: result.success,
        hasTileCache: !!result.tileCache,
        hasNavMesh: !!result.navMesh,
        error: (result as { error?: string }).error,
      });

      if (result.success && result.tileCache && result.navMesh) {
        // Tile cache generation succeeded
        this.tileCache = result.tileCache;
        this.navMesh = result.navMesh;
        this.navMeshQuery = new NavMeshQuery(this.navMesh);

        this.crowd = new Crowd(this.navMesh, {
          maxAgents: CROWD_CONFIG.maxAgents,
          maxAgentRadius: CROWD_CONFIG.maxAgentRadius,
        });

        this.initialized = true;

        const elapsed = performance.now() - startTime;
        debugInitialization.log(`[RecastNavigation] TileCache NavMesh generated in ${elapsed.toFixed(1)}ms`);
        return true;
      }

      // Tile cache failed - try solo navmesh as fallback
      // Solo navmesh doesn't support dynamic obstacles but is more robust
      debugInitialization.warn('[RecastNavigation] TileCache failed, trying solo navmesh fallback...');
      debugInitialization.warn('[RecastNavigation] TileCache error:', (result as { error?: string }).error);

      const soloResult = generateSoloNavMesh(positions, indices, SOLO_NAVMESH_CONFIG);

      debugInitialization.log('[RecastNavigation] Solo NavMesh result:', {
        success: soloResult.success,
        hasNavMesh: !!soloResult.navMesh,
        error: (soloResult as { error?: string }).error,
      });

      if (!soloResult.success || !soloResult.navMesh) {
        debugInitialization.error('[RecastNavigation] Both TileCache and Solo NavMesh generation failed');
        debugInitialization.error('[RecastNavigation] Solo result:', soloResult);
        return false;
      }

      // Solo navmesh succeeded - use it without tile cache
      // Dynamic obstacles won't work, but basic pathfinding will
      this.tileCache = null;
      this.navMesh = soloResult.navMesh;
      this.navMeshQuery = new NavMeshQuery(this.navMesh);

      this.crowd = new Crowd(this.navMesh, {
        maxAgents: CROWD_CONFIG.maxAgents,
        maxAgentRadius: CROWD_CONFIG.maxAgentRadius,
      });

      this.initialized = true;

      const elapsed = performance.now() - startTime;
      debugInitialization.log(`[RecastNavigation] Solo NavMesh generated (fallback) in ${elapsed.toFixed(1)}ms`);
      debugInitialization.warn('[RecastNavigation] Note: Dynamic obstacles disabled due to solo navmesh fallback');

      return true;
    } catch (error) {
      debugPathfinding.warn('[RecastNavigation] Error generating navmesh:', error);
      return false;
    }
  }

  /**
   * Find path between two points.
   * Uses terrain height for better query accuracy on multi-elevation terrain.
   *
   * @param agentRadius - Optional agent radius for path query (affects corridor width)
   */
  public findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    agentRadius: number = DEFAULT_AGENT_RADIUS
  ): PathResult {
    if (!this.navMeshQuery) {
      return { path: [], found: false };
    }

    try {
      // Use agent-specific halfExtents for finding nearest points
      // Larger search radius ensures we find valid navmesh positions
      const searchRadius = Math.max(agentRadius * 4, 2);
      const halfExtents = { x: searchRadius, y: 10, z: searchRadius };

      // Start queries at approximate terrain height for better accuracy
      const startQueryY = this.getTerrainHeight(startX, startY);
      const endQueryY = this.getTerrainHeight(endX, endY);

      const startQuery = { x: startX, y: startQueryY, z: startY };
      const endQuery = { x: endX, y: endQueryY, z: endY };

      const startOnMesh = this.navMeshQuery.findClosestPoint(startQuery, { halfExtents });
      const endOnMesh = this.navMeshQuery.findClosestPoint(endQuery, { halfExtents });

      if (!startOnMesh.success || !startOnMesh.point || !endOnMesh.success || !endOnMesh.point) {
        // Log detailed failure info for debugging ramp issues
        const dist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        if (dist > 20) {
          debugPathfinding.warn(
            `[RecastNavigation] findClosestPoint failed for long path (${dist.toFixed(1)} units): ` +
            `start=(${startX.toFixed(1)}, ${startY.toFixed(1)}) success=${startOnMesh.success}, ` +
            `end=(${endX.toFixed(1)}, ${endY.toFixed(1)}) success=${endOnMesh.success}`
          );
        }
        return { path: [], found: false };
      }

      const result = this.navMeshQuery.computePath(startOnMesh.point, endOnMesh.point, { halfExtents });

      if (!result.success || !result.path || result.path.length === 0) {
        // Log detailed failure info - this indicates disconnected navmesh regions
        const startH = startOnMesh.point.y;
        const endH = endOnMesh.point.y;
        const heightDiff = Math.abs(startH - endH);
        debugPathfinding.warn(
          `[RecastNavigation] computePath failed - possible disconnected regions: ` +
          `start=(${startOnMesh.point.x.toFixed(1)}, h=${startH.toFixed(2)}, ${startOnMesh.point.z.toFixed(1)}), ` +
          `end=(${endOnMesh.point.x.toFixed(1)}, h=${endH.toFixed(2)}, ${endOnMesh.point.z.toFixed(1)}), ` +
          `heightDiff=${heightDiff.toFixed(2)}`
        );
        return { path: [], found: false };
      }

      // Convert path points and apply smoothing for agent radius
      const rawPath: Array<{ x: number; y: number }> = result.path.map((point) => ({
        x: point.x,
        y: point.z,
      }));

      // Smooth path to remove unnecessary waypoints that could cause edge-hugging
      const smoothedPath = this.smoothPath(rawPath, agentRadius);

      return { path: smoothedPath, found: true };
    } catch {
      return { path: [], found: false };
    }
  }

  /**
   * Smooth path by removing redundant waypoints
   * Helps units take more direct routes and avoid edge-hugging
   */
  private smoothPath(
    path: Array<{ x: number; y: number }>,
    agentRadius: number
  ): Array<{ x: number; y: number }> {
    if (path.length <= 2) return path;

    const smoothed: Array<{ x: number; y: number }> = [path[0]];
    let currentIndex = 0;

    while (currentIndex < path.length - 1) {
      // Try to skip to the farthest reachable point
      let farthestReachable = currentIndex + 1;

      for (let i = path.length - 1; i > currentIndex + 1; i--) {
        // Check if we can go directly from current to point i
        if (this.canWalkDirect(path[currentIndex], path[i], agentRadius)) {
          farthestReachable = i;
          break;
        }
      }

      smoothed.push(path[farthestReachable]);
      currentIndex = farthestReachable;
    }

    return smoothed;
  }

  /**
   * Check if a direct path between two points is walkable
   * Uses raycast-like sampling along the line
   */
  private canWalkDirect(
    from: { x: number; y: number },
    to: { x: number; y: number },
    agentRadius: number
  ): boolean {
    if (!this.navMeshQuery) return false;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = distance(from.x, from.y, to.x, to.y);

    if (dist < 0.5) return true;

    // Sample points along the line
    const stepSize = agentRadius * 0.5;
    const steps = Math.ceil(dist / stepSize);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t;
      const y = from.y + dy * t;

      if (!this.isWalkable(x, y)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Find nearest point on navmesh.
   * Uses terrain height for better query accuracy.
   */
  public findNearestPoint(x: number, y: number): { x: number; y: number } | null {
    if (!this.navMeshQuery) return null;

    try {
      // Start query at approximate terrain height for better accuracy
      const queryY = this.getTerrainHeight(x, y);
      const halfExtents = { x: 5, y: 20, z: 5 };
      const result = this.navMeshQuery.findClosestPoint({ x, y: queryY, z: y }, { halfExtents });
      if (result.success && result.point) {
        return { x: result.point.x, y: result.point.z };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Diagnostic counters for limiting log output
  private walkabilityLogCount = 0;
  private readonly MAX_WALKABILITY_LOGS = 20;
  private agentFailLogCount = 0;
  private readonly MAX_AGENT_FAIL_LOGS = 5;

  /**
   * Check if a point is on the navmesh (walkable).
   * Uses terrain height for better query accuracy.
   */
  public isWalkable(x: number, y: number): boolean {
    if (!this.navMeshQuery) return false;

    try {
      // Start query at approximate terrain height for better accuracy
      const queryY = this.getTerrainHeight(x, y);
      const halfExtents = { x: 2, y: 20, z: 2 };
      const result = this.navMeshQuery.findClosestPoint({ x, y: queryY, z: y }, { halfExtents });

      if (!result.success || !result.point) {
        return false;
      }

      // Check if the closest point is within a reasonable tolerance
      const dist = distance(x, y, result.point.x, result.point.z);

      // Log first few failures for diagnostics
      if (dist >= 2.0 && this.walkabilityLogCount < this.MAX_WALKABILITY_LOGS) {
        debugPathfinding.log(
          `[Navmesh] isWalkable FAIL (dist): pos=(${x.toFixed(1)}, ${y.toFixed(1)}), ` +
          `queryY=${queryY.toFixed(2)}, closest=(${result.point.x.toFixed(1)}, ${result.point.y.toFixed(2)}, ${result.point.z.toFixed(1)}), ` +
          `dist=${dist.toFixed(2)}`
        );
        this.walkabilityLogCount++;
        return false;
      }

      return dist < 2.0;
    } catch {
      return false;
    }
  }

  // ==================== CROWD SIMULATION ====================

  /**
   * Add a unit to crowd simulation.
   * Projects position onto navmesh surface to ensure valid polygon placement.
   * DetourCrowd requires agents to be exactly ON navmesh polygons to work.
   */
  public addAgent(
    entityId: number,
    x: number,
    y: number,
    radius: number = 0.5,
    maxSpeed: number = 5.0
  ): number {
    if (!this.crowd) return -1;

    // Remove existing agent if present
    if (this.agentMap.has(entityId)) {
      this.removeAgent(entityId);
    }

    try {
      // Project position onto navmesh surface for valid polygon placement
      // Critical: agents must be ON a navmesh polygon for crowd to compute velocity
      const projected = this.projectToNavMesh(x, y);
      if (!projected) {
        // Rate-limit warnings to avoid console spam
        if (this.agentFailLogCount < this.MAX_AGENT_FAIL_LOGS) {
          console.warn(
            `[RecastNavigation] Cannot add agent ${entityId}: position (${x.toFixed(1)}, ${y.toFixed(1)}) not on navmesh`
          );
          this.agentFailLogCount++;
          if (this.agentFailLogCount === this.MAX_AGENT_FAIL_LOGS) {
            console.warn('[RecastNavigation] Suppressing further agent failure warnings...');
          }
        }
        return -1;
      }

      const params: Partial<CrowdAgentParams> = {
        ...DEFAULT_AGENT_PARAMS,
        radius,
        maxSpeed,
        maxAcceleration: 100.0, // High for instant RTS-style acceleration
        collisionQueryRange: radius * 5,
      };

      const agent = this.crowd.addAgent(projected, params);

      if (agent) {
        const agentIndex = agent.agentIndex;
        this.agentMap.set(entityId, agentIndex);
        this.agentEntityMap.set(agentIndex, entityId);
        return agentIndex;
      }
    } catch (error) {
      debugPathfinding.warn(`[RecastNavigation] Failed to add agent ${entityId}:`, error);
    }

    return -1;
  }

  /**
   * Remove a unit from crowd simulation
   */
  public removeAgent(entityId: number): void {
    if (!this.crowd) return;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return;

    try {
      this.crowd.removeAgent(agentIndex);
      this.agentMap.delete(entityId);
      this.agentEntityMap.delete(agentIndex);
    } catch (error) {
      debugPathfinding.warn(`[RecastNavigation] Failed to remove agent ${entityId}:`, error);
    }
  }

  /**
   * Set agent move target.
   * Projects target onto navmesh to ensure valid path corridor computation.
   */
  public setAgentTarget(entityId: number, targetX: number, targetY: number): boolean {
    if (!this.crowd) return false;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return false;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        const agentPos = agent.position();
        // Project target onto navmesh to ensure it's a valid position
        // This is CRITICAL - requestMoveTarget needs a navmesh position to compute path corridor
        const projected = this.projectToNavMesh(targetX, targetY);
        if (projected) {
          // Check height difference for ramp traversal debugging
          const heightDiff = Math.abs(agentPos.y - projected.y);
          if (heightDiff > 0.5) {
            debugPathfinding.log(
              `[RecastNavigation] Cross-height target: agent at h=${agentPos.y.toFixed(2)}, ` +
              `target at h=${projected.y.toFixed(2)}, diff=${heightDiff.toFixed(2)}`
            );
          }
          // Use the projected navmesh position (already has correct x, y, z)
          agent.requestMoveTarget(projected);
          return true;
        }

        // Fallback: try with approximate terrain height if projection failed
        // This can happen at map edges or on dynamic obstacles
        const terrainY = this.getTerrainHeight(targetX, targetY);
        console.warn(
          `[RecastNavigation] Target projection failed for (${targetX.toFixed(1)}, ${targetY.toFixed(1)}), using fallback`
        );
        agent.requestMoveTarget({ x: targetX, y: terrainY, z: targetY });
        return true;
      }
    } catch {
      // Ignore
    }

    return false;
  }

  /**
   * Stop agent movement
   */
  public stopAgent(entityId: number): void {
    if (!this.crowd) return;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        agent.resetMoveTarget();
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Update agent position (for teleporting or external movement).
   * Projects position onto navmesh to ensure valid agent placement.
   * Returns true if teleport succeeded, false if position is off navmesh.
   *
   * @param currentHeight - Optional hint for agent's current height (from crowd state).
   *   On multi-level navmeshes, this ensures the agent stays on the correct layer
   *   (e.g., ramp surface) instead of snapping to a different layer (e.g., ground).
   */
  public updateAgentPosition(entityId: number, x: number, y: number, currentHeight?: number): boolean {
    if (!this.crowd) return false;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return false;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        // Use current height if provided (preserves layer on multi-level navmesh),
        // otherwise fall back to terrain height provider
        const queryY = currentHeight ?? this.getTerrainHeight(x, y);

        // Search with tighter vertical tolerance when we have current height
        // to avoid snapping to wrong layer
        const halfExtents = currentHeight !== undefined
          ? { x: 2, y: 2, z: 2 }   // Tight search near current height
          : { x: 2, y: 10, z: 2 }; // Wide search when height unknown

        const result = this.navMeshQuery?.findClosestPoint(
          { x, y: queryY, z: y },
          { halfExtents }
        );

        if (result?.success && result.point) {
          agent.teleport({ x: result.point.x, y: result.point.y, z: result.point.z });
          return true;
        }

        // Fallback: teleport directly with query height
        agent.teleport({ x, y: queryY, z: y });
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  /**
   * Update agent parameters (speed, radius)
   */
  public updateAgentParams(
    entityId: number,
    params: { maxSpeed?: number; radius?: number }
  ): void {
    if (!this.crowd) return;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        if (params.maxSpeed !== undefined) {
          agent.maxSpeed = params.maxSpeed;
          agent.maxAcceleration = 100.0; // High for instant RTS-style acceleration
        }
        if (params.radius !== undefined) {
          agent.radius = params.radius;
          agent.collisionQueryRange = params.radius * 5;
        }
      }
    } catch {
      // Ignore
    }
  }

  // Track agents that have logged zero velocity to avoid spam
  private zeroVelocityLoggedAgents = new Set<number>();

  /**
   * Get agent computed position and velocity
   */
  public getAgentState(entityId: number): {
    x: number;
    y: number;
    height: number;
    vx: number;
    vy: number;
  } | null {
    if (!this.crowd) return null;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return null;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        const pos = agent.position();
        const vel = agent.velocity();
        const target = agent.target();

        // Debug: Log zero velocity for agents with targets (indicates path corridor failure)
        const velMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        if (velMag < 0.001 && target) {
          const distToTarget = Math.sqrt(
            (pos.x - target.x) ** 2 + (pos.z - target.z) ** 2
          );
          // Only log if far from target and haven't logged this agent yet
          if (distToTarget > 2 && !this.zeroVelocityLoggedAgents.has(entityId)) {
            const heightDiff = Math.abs(pos.y - target.y);
            debugPathfinding.warn(
              `[RecastNavigation] Agent ${entityId} zero velocity: ` +
              `pos=(${pos.x.toFixed(1)}, h=${pos.y.toFixed(2)}, ${pos.z.toFixed(1)}), ` +
              `target=(${target.x.toFixed(1)}, h=${target.y.toFixed(2)}, ${target.z.toFixed(1)}), ` +
              `dist=${distToTarget.toFixed(1)}, heightDiff=${heightDiff.toFixed(2)}`
            );
            this.zeroVelocityLoggedAgents.add(entityId);
          }
        } else if (velMag > 0.1) {
          // Clear log flag when agent starts moving
          this.zeroVelocityLoggedAgents.delete(entityId);
        }

        return {
          x: pos.x,
          y: pos.z,
          height: pos.y,  // Include 3D height for multi-level navmesh
          vx: vel.x,
          vy: vel.z,
        };
      }
    } catch {
      // Ignore
    }

    return null;
  }

  /**
   * Check if agent has reached destination
   */
  public hasAgentReachedTarget(entityId: number, threshold: number = 0.5): boolean {
    if (!this.crowd) return false;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return false;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        const pos = agent.position();
        const target = agent.target();
        if (!target) return true; // No target = reached

        const dist = distance(pos.x, pos.z, target.x, target.z);
        return dist < threshold;
      }
    } catch {
      // Ignore
    }

    return false;
  }

  /**
   * Update crowd simulation (call once per frame)
   */
  public updateCrowd(deltaTime: number): void {
    if (!this.crowd) return;

    try {
      this.crowd.update(deltaTime);
    } catch {
      // Ignore
    }
  }

  // ==================== DEBUG: CROSS-HEIGHT PATHFINDING ====================

  /**
   * Debug method to test if a path exists between two points.
   * Use this to diagnose ramp/multi-level navmesh connectivity issues.
   */
  public debugTestPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): void {
    if (!this.navMeshQuery) {
      console.log('[DEBUG] NavMeshQuery not initialized');
      return;
    }

    const startHeight = this.getTerrainHeight(startX, startY);
    const endHeight = this.getTerrainHeight(endX, endY);

    console.log(`[DEBUG] Testing path from (${startX.toFixed(1)}, ${startY.toFixed(1)}, h=${startHeight.toFixed(2)}) ` +
      `to (${endX.toFixed(1)}, ${endY.toFixed(1)}, h=${endHeight.toFixed(2)})`);

    // Find closest points on navmesh
    const halfExtents = { x: 2, y: 10, z: 2 };
    const startResult = this.navMeshQuery.findClosestPoint(
      { x: startX, y: startHeight, z: startY },
      { halfExtents }
    );
    const endResult = this.navMeshQuery.findClosestPoint(
      { x: endX, y: endHeight, z: endY },
      { halfExtents }
    );

    console.log(`[DEBUG] Start closest point: success=${startResult.success}, ` +
      (startResult.point ? `point=(${startResult.point.x.toFixed(1)}, h=${startResult.point.y.toFixed(2)}, ${startResult.point.z.toFixed(1)})` : 'null'));
    console.log(`[DEBUG] End closest point: success=${endResult.success}, ` +
      (endResult.point ? `point=(${endResult.point.x.toFixed(1)}, h=${endResult.point.y.toFixed(2)}, ${endResult.point.z.toFixed(1)})` : 'null'));

    if (!startResult.success || !startResult.point || !endResult.success || !endResult.point) {
      console.log('[DEBUG] Cannot find start/end on navmesh');
      return;
    }

    // Try to compute path
    const pathResult = this.navMeshQuery.computePath(startResult.point, endResult.point, { halfExtents });

    console.log(`[DEBUG] Path computation: success=${pathResult.success}, ` +
      `pathLength=${pathResult.path?.length ?? 0}`);

    if (pathResult.success && pathResult.path && pathResult.path.length > 0) {
      console.log('[DEBUG] Path waypoints:');
      for (let i = 0; i < Math.min(pathResult.path.length, 10); i++) {
        const p = pathResult.path[i];
        console.log(`  [${i}] (${p.x.toFixed(1)}, h=${p.y.toFixed(2)}, ${p.z.toFixed(1)})`);
      }
      if (pathResult.path.length > 10) {
        console.log(`  ... and ${pathResult.path.length - 10} more waypoints`);
      }
    } else {
      console.log('[DEBUG] PATH NOT FOUND - navmesh regions may be disconnected!');
    }
  }

  // ==================== DYNAMIC OBSTACLES ====================

  /**
   * Add a building as a cylinder obstacle
   *
   * Uses a small precision buffer. The navmesh walkableRadius config already
   * ensures proper clearance from obstacles. Prefer addBoxObstacle for
   * rectangular buildings.
   */
  public addObstacle(
    buildingEntityId: number,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    _agentRadius: number = DEFAULT_AGENT_RADIUS
  ): void {
    if (!this.tileCache || !this.navMesh) return;

    // Remove existing obstacle if present
    if (this.obstacleRefs.has(buildingEntityId)) {
      this.removeObstacle(buildingEntityId);
    }

    try {
      // Add cylinder obstacle (approximate rectangular building)
      // Small buffer for precision tolerance (walkableRadius handles clearance)
      const baseRadius = Math.max(width, height) / 2;
      const expandedRadius = baseRadius + 0.1;

      const result = this.tileCache.addCylinderObstacle(
        { x: centerX, y: 0, z: centerY },
        expandedRadius,
        2.0 // height
      );

      if (result.success && result.obstacle) {
        this.obstacleRefs.set(buildingEntityId, result.obstacle);
        // Update tiles affected by obstacle
        this.tileCache.update(this.navMesh);

        debugPathfinding.log(
          `[RecastNavigation] Added cylinder obstacle for building ${buildingEntityId} ` +
          `at (${centerX.toFixed(1)}, ${centerY.toFixed(1)}) ` +
          `radius ${baseRadius.toFixed(1)} expanded to ${expandedRadius.toFixed(1)}`
        );
      }
    } catch (error) {
      debugPathfinding.warn(`[RecastNavigation] Failed to add obstacle:`, error);
    }
  }

  /**
   * Add a box obstacle (more accurate for rectangular buildings)
   *
   * Uses a small precision buffer. The navmesh walkableRadius config (0.6)
   * already ensures paths maintain proper clearance from obstacles.
   */
  public addBoxObstacle(
    buildingEntityId: number,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    _agentRadius: number = DEFAULT_AGENT_RADIUS
  ): void {
    if (!this.tileCache || !this.navMesh) return;

    if (this.obstacleRefs.has(buildingEntityId)) {
      this.removeObstacle(buildingEntityId);
    }

    try {
      // Small expansion buffer for precision tolerance
      // NOTE: walkableRadius (0.6) in NAVMESH_CONFIG already ensures paths maintain
      // proper clearance from obstacles. We only add a tiny buffer (0.1) to account
      // for floating point precision, NOT another full agent radius (which would
      // effectively double the clearance and make gaps between buildings too narrow).
      const expansionMargin = 0.1;
      const halfExtents = {
        x: (width / 2) + expansionMargin,
        y: 2.0,
        z: (height / 2) + expansionMargin
      };

      const result = this.tileCache.addBoxObstacle(
        { x: centerX, y: 0, z: centerY },
        halfExtents,
        0 // rotation angle
      );

      if (result.success && result.obstacle) {
        this.obstacleRefs.set(buildingEntityId, result.obstacle);
        this.tileCache.update(this.navMesh);

        debugPathfinding.log(
          `[RecastNavigation] Added box obstacle for building ${buildingEntityId} ` +
          `at (${centerX.toFixed(1)}, ${centerY.toFixed(1)}) ` +
          `size ${width}x${height} expanded to ${(width + expansionMargin * 2).toFixed(1)}x${(height + expansionMargin * 2).toFixed(1)}`
        );
      }
    } catch {
      // Fall back to cylinder with expansion
      this.addObstacle(buildingEntityId, centerX, centerY, width, height, _agentRadius);
    }
  }

  /**
   * Remove a building obstacle
   */
  public removeObstacle(buildingEntityId: number): void {
    if (!this.tileCache || !this.navMesh) return;

    const obstacle = this.obstacleRefs.get(buildingEntityId);
    if (!obstacle) return;

    try {
      this.tileCache.removeObstacle(obstacle);
      this.obstacleRefs.delete(buildingEntityId);
      this.tileCache.update(this.navMesh);

      debugPathfinding.log(`[RecastNavigation] Removed obstacle for building ${buildingEntityId}`);
    } catch (error) {
      debugPathfinding.warn(`[RecastNavigation] Failed to remove obstacle:`, error);
    }
  }

  /**
   * Update tile cache (call after adding/removing obstacles)
   */
  public updateObstacles(): void {
    if (!this.tileCache || !this.navMesh) return;

    try {
      this.tileCache.update(this.navMesh);
    } catch {
      // Ignore
    }
  }

  // ==================== UTILITIES ====================

  /**
   * Export navmesh to binary (for caching)
   */
  public exportNavMesh(): Uint8Array | null {
    if (!this.navMesh) return null;

    try {
      return exportNavMesh(this.navMesh);
    } catch {
      return null;
    }
  }

  /**
   * Import navmesh from binary
   */
  public async importNavMeshData(data: Uint8Array): Promise<boolean> {
    try {
      await RecastNavigation.initWasm();

      const result = importNavMesh(data);
      if (!result.navMesh) return false;

      this.navMesh = result.navMesh;
      this.navMeshQuery = new NavMeshQuery(this.navMesh);

      this.crowd = new Crowd(this.navMesh, {
        maxAgents: CROWD_CONFIG.maxAgents,
        maxAgentRadius: CROWD_CONFIG.maxAgentRadius,
      });

      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get agent count for debugging
   */
  public getAgentCount(): number {
    return this.agentMap.size;
  }

  /**
   * Get obstacle count for debugging
   */
  public getObstacleCount(): number {
    return this.obstacleRefs.size;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.agentMap.clear();
    this.agentEntityMap.clear();
    this.obstacleRefs.clear();

    this.crowd = null;
    this.navMeshQuery = null;
    this.navMesh = null;
    this.tileCache = null;

    this.initialized = false;
  }
}

// Export singleton getter for convenience
export function getRecastNavigation(): RecastNavigation {
  return RecastNavigation.getInstance();
}

// Export initialization helper
export async function initRecastNavigation(): Promise<void> {
  return RecastNavigation.initWasm();
}
