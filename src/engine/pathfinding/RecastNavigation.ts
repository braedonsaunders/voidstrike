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
import { generateTileCache, type TileCacheGeneratorConfig } from '@recast-navigation/generators';
import { threeToTileCache } from '@recast-navigation/three';
import * as THREE from 'three';
import { debugPathfinding } from '@/utils/debugLogger';

// NavMesh generation config - tuned for RTS gameplay
// IMPORTANT: Cell size determines path precision around obstacles
const NAVMESH_CONFIG: Partial<TileCacheGeneratorConfig> = {
  // Cell size - smaller = more precise paths around buildings
  // 0.25 units provides 2x precision for smoother building avoidance
  cs: 0.25,
  // Cell height - vertical precision
  ch: 0.2,
  // Agent parameters
  // Increased slope angle to allow units to traverse ramps (which can be steep)
  walkableSlopeAngle: 60,
  walkableHeight: 2,
  // Increased climb to handle elevation transitions at ramp boundaries
  walkableClimb: 1.0,
  // Walkable radius defines minimum clearance from obstacles
  // Must match or exceed agent collision radius for proper avoidance
  walkableRadius: 0.6,
  // Detail mesh - lower error for smoother paths
  maxSimplificationError: 0.5,
  // Tile cache specific
  tileSize: 32,
  expectedLayersPerTile: 4,
  maxObstacles: 512,
};

// Standard agent radius for obstacle expansion
// Buildings are expanded by this amount to ensure paths maintain clearance
const DEFAULT_AGENT_RADIUS = 0.5;

// Crowd simulation config
const CROWD_CONFIG = {
  maxAgents: 500,
  maxAgentRadius: 2.0,
};

// Agent config for different unit types
const DEFAULT_AGENT_PARAMS: Partial<CrowdAgentParams> = {
  radius: 0.5,
  height: 2.0,
  maxAcceleration: 8.0,
  maxSpeed: 5.0,
  collisionQueryRange: 2.5,
  pathOptimizationRange: 10.0,
  separationWeight: 2.0,
  // Update flags for local avoidance
  updateFlags: 0x1 | 0x2 | 0x4 | 0x8, // All flags enabled
  obstacleAvoidanceType: 3, // High quality avoidance
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
    debugPathfinding.log('[RecastNavigation] SharedArrayBuffer available:', hasSharedArrayBuffer);

    if (!hasSharedArrayBuffer) {
      console.warn(
        '[RecastNavigation] SharedArrayBuffer is not available. ' +
        'This may be due to missing security headers (COOP/COEP). ' +
        'Navmesh initialization may fail on Safari and other browsers.'
      );
    }

    RecastNavigation.initPromise = init()
      .then(() => {
        debugPathfinding.log('[RecastNavigation] WASM module initialized successfully');
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

    try {
      await RecastNavigation.initWasm();

      this.mapWidth = mapWidth;
      this.mapHeight = mapHeight;

      debugPathfinding.log('[RecastNavigation] Generating navmesh from geometry...', {
        positionsLength: positions.length,
        indicesLength: indices.length,
        mapWidth,
        mapHeight,
      });

      const result = generateTileCache(positions, indices, NAVMESH_CONFIG);

      debugPathfinding.log('[RecastNavigation] TileCache result:', {
        success: result.success,
        hasTileCache: !!result.tileCache,
        hasNavMesh: !!result.navMesh,
      });

      if (!result.success || !result.tileCache || !result.navMesh) {
        debugPathfinding.warn('[RecastNavigation] Failed to generate navmesh from geometry');
        return false;
      }

      this.tileCache = result.tileCache;
      this.navMesh = result.navMesh;
      this.navMeshQuery = new NavMeshQuery(this.navMesh);

      this.crowd = new Crowd(this.navMesh, {
        maxAgents: CROWD_CONFIG.maxAgents,
        maxAgentRadius: CROWD_CONFIG.maxAgentRadius,
      });

      this.initialized = true;

      const elapsed = performance.now() - startTime;
      debugPathfinding.log(
        `[RecastNavigation] NavMesh generated from geometry in ${elapsed.toFixed(1)}ms`
      );

      return true;
    } catch (error) {
      debugPathfinding.warn('[RecastNavigation] Error generating navmesh:', error);
      return false;
    }
  }

  /**
   * Find path between two points
   * Converts 2D game coords (x, y) to 3D navmesh coords (x, 0, y)
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

      const startQuery = { x: startX, y: 0, z: startY };
      const endQuery = { x: endX, y: 0, z: endY };

      const startOnMesh = this.navMeshQuery.findClosestPoint(startQuery, { halfExtents });
      const endOnMesh = this.navMeshQuery.findClosestPoint(endQuery, { halfExtents });

      if (!startOnMesh.success || !startOnMesh.point || !endOnMesh.success || !endOnMesh.point) {
        return { path: [], found: false };
      }

      const result = this.navMeshQuery.computePath(startOnMesh.point, endOnMesh.point, { halfExtents });

      if (!result.success || !result.path || result.path.length === 0) {
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
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.5) return true;

    // Sample points along the line
    const stepSize = agentRadius * 0.5;
    const steps = Math.ceil(distance / stepSize);

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
   * Find nearest point on navmesh
   */
  public findNearestPoint(x: number, y: number): { x: number; y: number } | null {
    if (!this.navMeshQuery) return null;

    try {
      // Use large halfExtents for height tolerance since terrain has varying heights
      const halfExtents = { x: 5, y: 20, z: 5 };
      const result = this.navMeshQuery.findClosestPoint({ x, y: 0, z: y }, { halfExtents });
      if (result.success && result.point) {
        return { x: result.point.x, y: result.point.z };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a point is on the navmesh (walkable)
   */
  public isWalkable(x: number, y: number): boolean {
    if (!this.navMeshQuery) return false;

    try {
      // Use large halfExtents for height tolerance since terrain has varying heights
      const halfExtents = { x: 2, y: 20, z: 2 };
      const result = this.navMeshQuery.findClosestPoint({ x, y: 0, z: y }, { halfExtents });
      if (!result.success || !result.point) return false;

      // Check if the closest point is within a reasonable tolerance
      const dx = result.point.x - x;
      const dz = result.point.z - y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist < 2.0; // Within 2 units horizontally
    } catch {
      return false;
    }
  }

  // ==================== CROWD SIMULATION ====================

  /**
   * Add a unit to crowd simulation
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
      const params: Partial<CrowdAgentParams> = {
        ...DEFAULT_AGENT_PARAMS,
        radius,
        maxSpeed,
        maxAcceleration: maxSpeed * 1.5,
        collisionQueryRange: radius * 5,
      };

      const agent = this.crowd.addAgent({ x, y: 0, z: y }, params);

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
   * Set agent move target
   */
  public setAgentTarget(entityId: number, targetX: number, targetY: number): boolean {
    if (!this.crowd) return false;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return false;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        agent.requestMoveTarget({ x: targetX, y: 0, z: targetY });
        return true;
      }
    } catch (error) {
      debugPathfinding.warn(`[RecastNavigation] Failed to set agent target ${entityId}:`, error);
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
   * Update agent position (for teleporting or external movement)
   */
  public updateAgentPosition(entityId: number, x: number, y: number): void {
    if (!this.crowd) return;

    const agentIndex = this.agentMap.get(entityId);
    if (agentIndex === undefined) return;

    try {
      const agent = this.crowd.getAgent(agentIndex);
      if (agent) {
        agent.teleport({ x, y: 0, z: y });
      }
    } catch {
      // Ignore
    }
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
          agent.maxAcceleration = params.maxSpeed * 1.5;
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

  /**
   * Get agent computed position and velocity
   */
  public getAgentState(entityId: number): {
    x: number;
    y: number;
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
        return {
          x: pos.x,
          y: pos.z,
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

        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
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
