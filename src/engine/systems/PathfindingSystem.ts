/**
 * Pathfinding System - Recast Navigation Integration
 *
 * Uses industry-standard WASM-based pathfinding via recast-navigation-js.
 * Features:
 * - NavMesh generation from terrain geometry
 * - O(1) path queries via NavMeshQuery
 * - DetourCrowd for RVO-based collision avoidance
 * - TileCache for dynamic obstacles (buildings)
 */

import * as THREE from 'three';
import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Game } from '../core/Game';
import {
  RecastNavigation,
  getRecastNavigation,
  PathResult,
} from '../pathfinding/RecastNavigation';
import { debugPathfinding, debugPerformance } from '@/utils/debugLogger';

// Path request batching
const MAX_PATHS_PER_FRAME = 8; // Can process more since Recast is faster
const PATH_REQUEST_COOLDOWN = 20; // Ticks between requests (1 second at 20 TPS)

// Stuck detection
const MAX_STUCK_TICKS = 20;
const MIN_MOVEMENT_THRESHOLD = 0.2;
const REPATH_INTERVAL_TICKS = 60;

// Failed path caching
const FAILED_PATH_CACHE_TTL = 10000;
const FAILED_PATH_CACHE_SIZE = 200;

interface PathRequest {
  entityId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  priority: number;
}

interface UnitPathState {
  lastPosition: { x: number; y: number };
  lastMoveTick: number;
  lastRepathTick: number;
  destinationX: number;
  destinationY: number;
}

interface FailedPathEntry {
  timestamp: number;
  failureCount: number;
}

export class PathfindingSystem extends System {
  public priority = 5;

  private recast: RecastNavigation;
  private unitPathStates: Map<number, UnitPathState> = new Map();
  private pendingRequests: PathRequest[] = [];
  private mapWidth: number;
  private mapHeight: number;

  // Failed path cache
  private failedPathCache: Map<string, FailedPathEntry> = new Map();
  private failedPathCacheKeys: string[] = [];

  // Track if navmesh is ready
  private navMeshReady: boolean = false;

  constructor(game: Game, mapWidth: number, mapHeight: number) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.recast = getRecastNavigation();
    this.setupEventListeners();

    debugPathfinding.log(
      `[PathfindingSystem] Initialized for ${mapWidth}x${mapHeight} map`
    );
  }

  /**
   * Reinitialize for new map dimensions
   */
  public reinitialize(mapWidth: number, mapHeight: number): void {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.pendingRequests = [];
    this.unitPathStates.clear();
    this.failedPathCache.clear();
    this.failedPathCacheKeys = [];
    this.navMeshReady = false;

    debugPathfinding.log(
      `[PathfindingSystem] Reinitialized for ${mapWidth}x${mapHeight}`
    );
  }

  /**
   * Initialize navmesh from terrain geometry
   * Called by Game when terrain is loaded
   */
  public async initializeNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    debugPathfinding.log('[PathfindingSystem] Initializing navmesh from geometry...');

    const success = await this.recast.generateFromGeometry(
      positions,
      indices,
      this.mapWidth,
      this.mapHeight
    );

    this.navMeshReady = success;

    if (success) {
      debugPathfinding.log('[PathfindingSystem] NavMesh ready');
    } else {
      debugPathfinding.warn('[PathfindingSystem] NavMesh generation failed');
    }

    return success;
  }

  /**
   * Initialize navmesh from Three.js mesh
   */
  public async initializeNavMeshFromMesh(
    mesh: THREE.Mesh
  ): Promise<boolean> {
    debugPathfinding.log('[PathfindingSystem] Initializing navmesh from mesh...');

    const success = await this.recast.generateFromTerrain(
      mesh,
      this.mapWidth,
      this.mapHeight
    );

    this.navMeshReady = success;
    return success;
  }

  /**
   * Legacy terrain data loader - generates navmesh geometry from terrain grid
   */
  public loadTerrainData(): void {
    debugPathfinding.log('[PathfindingSystem] loadTerrainData called - navmesh will be initialized from terrain mesh');
    // NavMesh is now generated from terrain mesh in Game.ts
    // This method is kept for backwards compatibility
  }

  private setupEventListeners(): void {
    // Building events for dynamic obstacles
    this.game.eventBus.on('building:placed', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.recast.addBoxObstacle(
        data.entityId,
        data.position.x,
        data.position.y,
        data.width,
        data.height
      );
    });

    this.game.eventBus.on('building:destroyed', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.recast.removeObstacle(data.entityId);
    });

    this.game.eventBus.on('building:constructionStarted', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.recast.addBoxObstacle(
        data.entityId,
        data.position.x,
        data.position.y,
        data.width,
        data.height
      );
    });

    // Unit lifecycle events
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.unitPathStates.delete(data.entityId);
      this.recast.removeAgent(data.entityId);
    });

    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.unitPathStates.delete(data.entityId);
      this.recast.removeAgent(data.entityId);
    });

    // Path requests
    this.game.eventBus.on('pathfinding:request', (data: {
      entityId: number;
      targetX: number;
      targetY: number;
      priority?: number;
    }) => {
      const entity = this.world.getEntity(data.entityId);
      if (!entity) return;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) return;

      // Flying units don't need pathfinding
      if (unit.isFlying) {
        unit.setPath([{ x: data.targetX, y: data.targetY }]);
        return;
      }

      this.queuePathRequest({
        entityId: data.entityId,
        startX: transform.x,
        startY: transform.y,
        endX: data.targetX,
        endY: data.targetY,
        priority: data.priority ?? 1,
      });
    });
  }

  private queuePathRequest(request: PathRequest): void {
    // Check failed path cache
    if (this.isPathRecentlyFailed(request.entityId, request.endX, request.endY)) {
      this.clearUnitMovementTarget(request.entityId);
      return;
    }

    // Check if destination is reachable
    if (!this.recast.isWalkable(request.endX, request.endY)) {
      const nearby = this.recast.findNearestPoint(request.endX, request.endY);
      if (!nearby) {
        this.recordFailedPath(request.entityId, request.endX, request.endY);
        this.clearUnitMovementTarget(request.entityId);
        return;
      }
      request.endX = nearby.x;
      request.endY = nearby.y;
    }

    // Remove existing request for this entity
    const existingIdx = this.pendingRequests.findIndex(
      (r) => r.entityId === request.entityId
    );
    if (existingIdx !== -1) {
      this.pendingRequests.splice(existingIdx, 1);
    }

    this.pendingRequests.push(request);
  }

  private clearUnitMovementTarget(entityId: number): void {
    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    unit.path = [];
    unit.pathIndex = 0;
    unit.targetX = null;
    unit.targetY = null;

    if (unit.state === 'moving') {
      unit.state = 'idle';
    } else if (unit.state === 'building') {
      unit.cancelBuilding();
    } else if (unit.state === 'gathering') {
      unit.gatherTargetId = null;
      unit.isMining = false;
      unit.state = 'idle';
    }

    this.unitPathStates.delete(entityId);
  }

  private isPathRecentlyFailed(
    entityId: number,
    destX: number,
    destY: number
  ): boolean {
    const key = `${entityId}_${Math.floor(destX)}_${Math.floor(destY)}`;
    const entry = this.failedPathCache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > FAILED_PATH_CACHE_TTL) {
      this.failedPathCache.delete(key);
      const idx = this.failedPathCacheKeys.indexOf(key);
      if (idx !== -1) this.failedPathCacheKeys.splice(idx, 1);
      return false;
    }

    return true;
  }

  private recordFailedPath(
    entityId: number,
    destX: number,
    destY: number
  ): void {
    const key = `${entityId}_${Math.floor(destX)}_${Math.floor(destY)}`;
    const now = Date.now();

    if (this.failedPathCache.size >= FAILED_PATH_CACHE_SIZE) {
      const oldKey = this.failedPathCacheKeys.shift();
      if (oldKey) this.failedPathCache.delete(oldKey);
    }

    this.failedPathCache.set(key, { timestamp: now, failureCount: 1 });
    this.failedPathCacheKeys.push(key);
  }

  private processPathQueue(): void {
    if (this.pendingRequests.length === 0) return;
    if (!this.navMeshReady) return;

    const toProcess = Math.min(MAX_PATHS_PER_FRAME, this.pendingRequests.length);
    this.pendingRequests.sort((a, b) => b.priority - a.priority);

    for (let i = 0; i < toProcess; i++) {
      const request = this.pendingRequests.shift()!;
      this.processPathRequest(request);
    }
  }

  private processPathRequest(request: PathRequest): void {
    const result = this.findPath(
      request.startX,
      request.startY,
      request.endX,
      request.endY
    );

    const entity = this.world.getEntity(request.entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    if (result.found && result.path.length > 0) {
      unit.setPath(result.path);

      this.unitPathStates.set(request.entityId, {
        lastPosition: { x: request.startX, y: request.startY },
        lastMoveTick: this.game.getCurrentTick(),
        lastRepathTick: this.game.getCurrentTick(),
        destinationX: request.endX,
        destinationY: request.endY,
      });
    } else {
      console.log('[PathfindingSystem] Path FAILED for entity', request.entityId,
        'from', request.startX.toFixed(1), request.startY.toFixed(1),
        'to', request.endX.toFixed(1), request.endY.toFixed(1),
        '- state was:', unit.state);
      this.recordFailedPath(request.entityId, request.endX, request.endY);

      // IMPORTANT: Don't reset target or state when pathfinding fails
      // Let MovementSystem try direct movement instead
      // This is a fallback while navmesh issues are being debugged
      unit.path = [];
      unit.pathIndex = 0;

      // Keep targetX/targetY set so unit can move directly
      // Only clear if target is very far (clearly needs a path)
      const dx = request.endX - request.startX;
      const dy = request.endY - request.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 30) {
        // Target is far, truly unreachable - reset
        console.log('[PathfindingSystem] Target too far, resetting entity', request.entityId, 'to idle');
        unit.targetX = null;
        unit.targetY = null;
        if (unit.state === 'moving') {
          unit.state = 'idle';
        } else if (unit.state === 'building') {
          unit.cancelBuilding();
        } else if (unit.state === 'gathering') {
          unit.gatherTargetId = null;
          unit.isMining = false;
          unit.state = 'idle';
        }
      } else {
        // Target is close - allow direct movement even without path
        console.log('[PathfindingSystem] Target close enough, allowing direct movement for entity', request.entityId);
      }

      this.unitPathStates.delete(request.entityId);
    }
  }

  public findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): PathResult {
    if (!this.navMeshReady) {
      return { path: [], found: false };
    }

    return this.recast.findPath(startX, startY, endX, endY);
  }

  public isWalkable(x: number, y: number): boolean {
    if (!this.navMeshReady) return true; // Fallback to walkable if not ready
    return this.recast.isWalkable(x, y);
  }

  public update(_deltaTime: number): void {
    const updateStart = performance.now();
    const currentTick = this.game.getCurrentTick();

    // Sync buildings on first tick
    if (currentTick === 1) {
      this.syncBuildingsAsObstacles();
    }

    // Process path requests
    this.processPathQueue();

    // Check for stuck units
    this.checkMovingUnits(currentTick);

    // Update crowd simulation (deltaTime in seconds)
    this.recast.updateCrowd(_deltaTime / 1000);

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) {
      debugPerformance.warn(
        `[PathfindingSystem] UPDATE: tick ${currentTick} took ${updateElapsed.toFixed(1)}ms`
      );
    }
  }

  private syncBuildingsAsObstacles(): void {
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    let blockedCount = 0;

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');
      if (!building || !transform) continue;

      if (building.state === 'destroyed' || building.isFlying) continue;

      this.recast.addBoxObstacle(
        entity.id,
        transform.x,
        transform.y,
        building.width,
        building.height
      );
      blockedCount++;
    }

    debugPathfinding.log(
      `[PathfindingSystem] Synced ${blockedCount} buildings as obstacles`
    );
  }

  private checkMovingUnits(currentTick: number): void {
    const entities = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      if (unit.isFlying) {
        this.unitPathStates.delete(entity.id);
        continue;
      }

      if (
        unit.state !== 'moving' &&
        unit.state !== 'attacking' &&
        unit.state !== 'gathering' &&
        unit.state !== 'attackmoving'
      ) {
        this.unitPathStates.delete(entity.id);
        continue;
      }

      let state = this.unitPathStates.get(entity.id);

      if (!state && (unit.targetX !== null || unit.targetEntityId !== null)) {
        state = {
          lastPosition: { x: transform.x, y: transform.y },
          lastMoveTick: currentTick,
          lastRepathTick: currentTick,
          destinationX: unit.targetX ?? transform.x,
          destinationY: unit.targetY ?? transform.y,
        };
        this.unitPathStates.set(entity.id, state);
        continue;
      }

      if (!state) continue;

      if (unit.targetX !== null && unit.targetY !== null) {
        state.destinationX = unit.targetX;
        state.destinationY = unit.targetY;
      }

      const dx = transform.x - state.lastPosition.x;
      const dy = transform.y - state.lastPosition.y;
      const distanceMoved = Math.sqrt(dx * dx + dy * dy);

      if (distanceMoved > MIN_MOVEMENT_THRESHOLD) {
        state.lastPosition = { x: transform.x, y: transform.y };
        state.lastMoveTick = currentTick;
      } else {
        const ticksSinceMove = currentTick - state.lastMoveTick;
        const ticksSinceRepath = currentTick - state.lastRepathTick;

        if (
          ticksSinceMove > MAX_STUCK_TICKS &&
          ticksSinceRepath > PATH_REQUEST_COOLDOWN
        ) {
          const distToDest = Math.sqrt(
            (transform.x - state.destinationX) ** 2 +
              (transform.y - state.destinationY) ** 2
          );

          if (distToDest > 2) {
            unit.path = [];
            unit.pathIndex = 0;

            this.queuePathRequest({
              entityId: entity.id,
              startX: transform.x,
              startY: transform.y,
              endX: state.destinationX,
              endY: state.destinationY,
              priority: 3,
            });

            state.lastMoveTick = currentTick;
            state.lastRepathTick = currentTick;
          }
        }
      }

      if (currentTick - state.lastRepathTick > REPATH_INTERVAL_TICKS) {
        state.lastRepathTick = currentTick;
      }
    }
  }

  // Public API
  public requestPathForEntity(
    entityId: number,
    targetX: number,
    targetY: number
  ): void {
    this.game.eventBus.emit('pathfinding:request', {
      entityId,
      targetX,
      targetY,
    });
  }

  /**
   * Get the Recast navigation instance for crowd management
   */
  public getRecast(): RecastNavigation {
    return this.recast;
  }

  /**
   * Check if navmesh is ready
   */
  public isNavMeshReady(): boolean {
    return this.navMeshReady;
  }

  /**
   * Register decoration collisions as obstacles
   */
  public registerDecorationCollisions(
    collisions: Array<{ x: number; z: number; radius: number }>
  ): void {
    // Decorations are handled by navmesh generation from terrain mesh
    // Large decorations are excluded from walkable geometry
    debugPathfinding.log(
      `[PathfindingSystem] Registered ${collisions.length} decorations (handled by navmesh)`
    );
  }
}
