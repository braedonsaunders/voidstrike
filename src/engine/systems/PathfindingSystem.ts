/**
 * Pathfinding System - Recast Navigation Integration
 *
 * Uses industry-standard WASM-based pathfinding via recast-navigation-js.
 * Features:
 * - NavMesh generation from terrain geometry
 * - O(1) path queries via NavMeshQuery
 * - DetourCrowd for RVO-based collision avoidance
 * - TileCache for dynamic obstacles (buildings)
 * - Web Worker for off-thread path computation (prevents main thread blocking)
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
import { distance, clamp } from '@/utils/math';

// Path request batching - increased since worker handles computation off-thread
const MAX_PATHS_PER_FRAME = 16; // Worker can handle more without blocking main thread
const PATH_REQUEST_COOLDOWN = 20; // Ticks between requests (1 second at 20 TPS)

// Stuck detection
const MAX_STUCK_TICKS = 20;
const MIN_MOVEMENT_THRESHOLD = 0.2;
const REPATH_INTERVAL_TICKS = 60;

// Failed path caching - use ticks for determinism (200 ticks = 10s at 20 TPS)
const FAILED_PATH_CACHE_TTL_TICKS = 200;
const FAILED_PATH_CACHE_SIZE = 200;

interface PathRequest {
  entityId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  priority: number;
  movementDomain?: 'ground' | 'water' | 'amphibious' | 'air';
}

/**
 * PERF: Binary max-heap priority queue for path requests
 * Maintains sorted order on insertion: O(log n) vs O(n log n) for full sort
 */
class PathRequestPriorityQueue {
  private heap: PathRequest[] = [];
  private entityIndex: Map<number, number> = new Map(); // entityId -> heap index

  get length(): number {
    return this.heap.length;
  }

  push(request: PathRequest): void {
    // Remove existing request for same entity
    const existingIdx = this.entityIndex.get(request.entityId);
    if (existingIdx !== undefined) {
      this.removeAt(existingIdx);
    }

    // Add to end and bubble up
    this.heap.push(request);
    this.entityIndex.set(request.entityId, this.heap.length - 1);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): PathRequest | undefined {
    if (this.heap.length === 0) return undefined;

    const result = this.heap[0];
    this.entityIndex.delete(result.entityId);

    if (this.heap.length === 1) {
      this.heap.pop();
      return result;
    }

    // Move last to top and bubble down
    const last = this.heap.pop()!;
    this.heap[0] = last;
    this.entityIndex.set(last.entityId, 0);
    this.bubbleDown(0);

    return result;
  }

  clear(): void {
    this.heap.length = 0;
    this.entityIndex.clear();
  }

  private removeAt(index: number): void {
    if (index >= this.heap.length) return;

    const removed = this.heap[index];
    this.entityIndex.delete(removed.entityId);

    if (index === this.heap.length - 1) {
      this.heap.pop();
      return;
    }

    const last = this.heap.pop()!;
    this.heap[index] = last;
    this.entityIndex.set(last.entityId, index);

    // Reheapify
    if (index > 0 && this.heap[index].priority > this.heap[this.parent(index)].priority) {
      this.bubbleUp(index);
    } else {
      this.bubbleDown(index);
    }
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIdx = this.parent(index);
      if (this.heap[index].priority <= this.heap[parentIdx].priority) break;

      this.swap(index, parentIdx);
      index = parentIdx;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      let largest = index;
      const left = this.leftChild(index);
      const right = this.rightChild(index);

      if (left < this.heap.length && this.heap[left].priority > this.heap[largest].priority) {
        largest = left;
      }
      if (right < this.heap.length && this.heap[right].priority > this.heap[largest].priority) {
        largest = right;
      }

      if (largest === index) break;

      this.swap(index, largest);
      index = largest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
    this.entityIndex.set(this.heap[i].entityId, i);
    this.entityIndex.set(this.heap[j].entityId, j);
  }

  private parent(i: number): number { return Math.floor((i - 1) / 2); }
  private leftChild(i: number): number { return 2 * i + 1; }
  private rightChild(i: number): number { return 2 * i + 2; }
}

interface UnitPathState {
  lastPosition: { x: number; y: number };
  lastMoveTick: number;
  lastRepathTick: number;
  destinationX: number;
  destinationY: number;
}

interface FailedPathEntry {
  tick: number; // Game tick for deterministic timing
  failureCount: number;
}

export class PathfindingSystem extends System {
  public readonly name = 'PathfindingSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after BuildingPlacementSystem)

  private recast: RecastNavigation;
  private unitPathStates: Map<number, UnitPathState> = new Map();
  // PERF: Use priority queue instead of array + sort for O(log n) insertion
  private pendingRequests: PathRequestPriorityQueue = new PathRequestPriorityQueue();
  private mapWidth: number;
  private mapHeight: number;

  // Failed path cache
  private failedPathCache: Map<string, FailedPathEntry> = new Map();
  private failedPathCacheKeys: string[] = [];

  // Track if navmesh is ready
  private navMeshReady: boolean = false;

  // Custom terrain height function (from rendered terrain for accurate heights)
  private terrainHeightFunction: ((x: number, z: number) => number) | null = null;

  // Web Worker for off-thread path computation
  private pathWorker: Worker | null = null;
  private workerReady: boolean = false;
  private workerWasmInitialized: boolean = false; // Track if worker WASM is ready
  private workerRequestId: number = 0;
  private pendingWorkerRequests: Map<number, PathRequest> = new Map();

  // Cached geometry for worker initialization
  private cachedNavMeshGeometry: { positions: Float32Array; indices: Uint32Array } | null = null;
  private cachedHeightMap: { data: Float32Array; width: number; height: number } | null = null;

  constructor(game: Game, mapWidth: number, mapHeight: number) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.recast = getRecastNavigation();
    this.setupEventListeners();
    this.initializeWorker();

    debugPathfinding.log(
      `[PathfindingSystem] Initialized for ${mapWidth}x${mapHeight} map`
    );
  }

  /**
   * Initialize the pathfinding web worker
   */
  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      debugPathfinding.warn('[PathfindingSystem] Web Workers not supported, using main thread fallback');
      return;
    }

    try {
      // Create worker as ES module (required for Next.js 16+ Turbopack)
      this.pathWorker = new Worker(
        new URL('../../workers/pathfinding.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.pathWorker.onmessage = this.handleWorkerMessage.bind(this);
      this.pathWorker.onerror = (error) => {
        debugPathfinding.error('[PathfindingSystem] Worker error:', error);
        this.workerReady = false;
      };

      // Initialize WASM in worker
      this.pathWorker.postMessage({ type: 'init' });

      debugPathfinding.log('[PathfindingSystem] Web Worker created');
    } catch (error) {
      debugPathfinding.warn('[PathfindingSystem] Failed to create worker:', error);
      this.pathWorker = null;
    }
  }

  /**
   * Handle messages from the pathfinding worker
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const message = event.data;

    switch (message.type) {
      case 'initialized':
        if (message.success) {
          this.workerWasmInitialized = true;
          debugPathfinding.log('[PathfindingSystem] Worker WASM initialized');
          // If we have cached geometry, send it to worker now that WASM is ready
          if (this.cachedNavMeshGeometry && this.navMeshReady) {
            this.sendGeometryToWorker();
          }
        } else {
          debugPathfinding.error('[PathfindingSystem] Worker WASM init failed');
        }
        break;

      case 'navMeshLoaded':
        if (message.success) {
          this.workerReady = true;
          debugPathfinding.log('[PathfindingSystem] Worker navmesh loaded');
        } else {
          debugPathfinding.error('[PathfindingSystem] Worker navmesh load failed');
        }
        break;

      case 'pathResult':
        this.handlePathResult(message.requestId, message.path, message.found);
        break;
    }
  }

  /**
   * Send navmesh geometry to worker
   */
  private sendGeometryToWorker(): void {
    if (!this.pathWorker || !this.cachedNavMeshGeometry) return;

    if (!this.cachedHeightMap) {
      this.cachedHeightMap = this.buildWorkerHeightMap();
    }

    this.pathWorker.postMessage({
      type: 'loadNavMeshFromGeometry',
      positions: this.cachedNavMeshGeometry.positions,
      indices: this.cachedNavMeshGeometry.indices,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      heightMap: this.cachedHeightMap.data,
      heightMapWidth: this.cachedHeightMap.width,
      heightMapHeight: this.cachedHeightMap.height,
    });
  }

  private buildWorkerHeightMap(): { data: Float32Array; width: number; height: number } {
    const gridWidth = Math.floor(this.mapWidth) + 1;
    const gridHeight = Math.floor(this.mapHeight) + 1;
    const heightMap = new Float32Array(gridWidth * gridHeight);
    const heightFn = this.terrainHeightFunction ?? ((x: number, z: number) => this.game.getTerrainHeightAt(x, z));

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        heightMap[y * gridWidth + x] = heightFn(x, y);
      }
    }

    return { data: heightMap, width: gridWidth, height: gridHeight };
  }

  /**
   * Handle path result from worker
   */
  private handlePathResult(
    requestId: number,
    path: Array<{ x: number; y: number }>,
    found: boolean
  ): void {
    const request = this.pendingWorkerRequests.get(requestId);
    if (!request) return;

    this.pendingWorkerRequests.delete(requestId);

    const entity = this.world.getEntity(request.entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    if (found && path.length > 0) {
      unit.setPath(path);

      this.unitPathStates.set(request.entityId, {
        lastPosition: { x: request.startX, y: request.startY },
        lastMoveTick: this.game.getCurrentTick(),
        lastRepathTick: this.game.getCurrentTick(),
        destinationX: request.endX,
        destinationY: request.endY,
      });
    } else {
      this.recordFailedPath(request.entityId, request.endX, request.endY);
      unit.path = [];
      unit.pathIndex = 0;

      const dist = distance(request.startX, request.startY, request.endX, request.endY);

      if (dist > 30) {
        if (unit.state === 'moving') {
          unit.targetX = null;
          unit.targetY = null;
          unit.state = 'idle';
        } else if (unit.state !== 'building' && unit.state !== 'gathering') {
          unit.targetX = null;
          unit.targetY = null;
        }
      }

      this.unitPathStates.delete(request.entityId);
    }
  }

  /**
   * Send obstacle update to worker
   */
  private sendObstacleToWorker(
    action: 'add' | 'remove',
    entityId: number,
    centerX: number,
    centerY: number,
    width: number,
    height: number
  ): void {
    if (!this.pathWorker || !this.workerReady) return;

    if (action === 'add') {
      this.pathWorker.postMessage({
        type: 'addObstacle',
        entityId,
        centerX,
        centerY,
        width,
        height,
      });
    } else {
      this.pathWorker.postMessage({
        type: 'removeObstacle',
        entityId,
      });
    }
  }

  /**
   * Set the terrain height function used by the crowd simulation.
   * This should be called with the same height function used to generate
   * the navmesh geometry to ensure agents are placed on the navmesh surface.
   *
   * Critical: Using mismatched heights causes agents to be off-navmesh,
   * resulting in near-zero velocities from the crowd simulation.
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.terrainHeightFunction = fn;
    this.cachedHeightMap = null;
    // Update the recast terrain height provider if navmesh is already ready
    if (this.navMeshReady) {
      this.recast.setTerrainHeightProvider(fn);
      debugPathfinding.log('[PathfindingSystem] Updated terrain height provider');
    }
    if (this.pathWorker && this.workerWasmInitialized && this.cachedNavMeshGeometry && this.navMeshReady) {
      this.sendGeometryToWorker();
    }
  }

  /**
   * Reinitialize for new map dimensions
   */
  public reinitialize(mapWidth: number, mapHeight: number): void {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.pendingRequests.clear(); // PERF: Use clear() instead of array reassignment
    this.unitPathStates.clear();
    this.failedPathCache.clear();
    this.failedPathCacheKeys = [];
    this.navMeshReady = false;
    this.workerReady = false;
    this.workerWasmInitialized = false;
    this.pendingWorkerRequests.clear();
    this.cachedNavMeshGeometry = null;
    this.cachedHeightMap = null;

    debugPathfinding.log(
      `[PathfindingSystem] Reinitialized for ${mapWidth}x${mapHeight}`
    );
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.pathWorker) {
      this.pathWorker.terminate();
      this.pathWorker = null;
    }
    this.workerReady = false;
    this.workerWasmInitialized = false;
    this.pendingWorkerRequests.clear();
    this.cachedNavMeshGeometry = null;
    this.cachedHeightMap = null;
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

      // Cache geometry for worker
      this.cachedNavMeshGeometry = { positions, indices };

      // Send geometry to worker only if WASM is already initialized
      // Otherwise, handleWorkerMessage will send it when WASM init completes
      if (this.pathWorker && this.workerWasmInitialized) {
        this.sendGeometryToWorker();
      }

      // Wire up terrain height provider for elevation-aware pathfinding
      // Use custom function if set (for accurate heightMap values), else fall back to game
      if (this.terrainHeightFunction) {
        this.recast.setTerrainHeightProvider(this.terrainHeightFunction);
        debugPathfinding.log('[PathfindingSystem] Using custom terrain height function');
      } else {
        this.recast.setTerrainHeightProvider((x, z) => {
          return this.game.getTerrainHeightAt(x, z);
        });
        debugPathfinding.log('[PathfindingSystem] Using game terrain height fallback');
      }

      // Register any pending decoration obstacles now that navmesh is ready
      this.onNavMeshReady();
    } else {
      debugPathfinding.warn('[PathfindingSystem] NavMesh generation failed');
    }

    return success;
  }

  /**
   * Initialize water navmesh from water geometry
   * Called by Game when terrain is loaded and has water cells
   */
  public async initializeWaterNavMesh(
    positions: Float32Array,
    indices: Uint32Array
  ): Promise<boolean> {
    debugPathfinding.log('[PathfindingSystem] Initializing water navmesh...');

    const success = await this.recast.generateWaterNavMesh(
      positions,
      indices,
      this.mapWidth,
      this.mapHeight
    );

    if (success) {
      debugPathfinding.log('[PathfindingSystem] Water navmesh initialized successfully');
    } else {
      debugPathfinding.log('[PathfindingSystem] No water navmesh generated (map may not have water)');
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

    if (success) {
      // Wire up terrain height provider for elevation-aware pathfinding
      // Use custom function if set (for accurate heightMap values), else fall back to game
      if (this.terrainHeightFunction) {
        this.recast.setTerrainHeightProvider(this.terrainHeightFunction);
        debugPathfinding.log('[PathfindingSystem] Using custom terrain height function');
      } else {
        this.recast.setTerrainHeightProvider((x, z) => {
          return this.game.getTerrainHeightAt(x, z);
        });
        debugPathfinding.log('[PathfindingSystem] Using game terrain height fallback');
      }

      // Register any pending decoration obstacles now that navmesh is ready
      this.onNavMeshReady();
    }

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
      // Add cylinder obstacle (5-10x faster than box for TileCache updates)
      this.recast.addObstacle(
        data.entityId,
        data.position.x,
        data.position.y,
        data.width,
        data.height
      );
      // Forward to worker (for path queries)
      this.sendObstacleToWorker('add', data.entityId, data.position.x, data.position.y, data.width, data.height);
    });

    this.game.eventBus.on('building:destroyed', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.recast.removeObstacle(data.entityId);
      // Forward to worker
      this.sendObstacleToWorker('remove', data.entityId, 0, 0, 0, 0);
    });

    this.game.eventBus.on('building:constructionStarted', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      // Add cylinder obstacle (5-10x faster than box for TileCache updates)
      this.recast.addObstacle(
        data.entityId,
        data.position.x,
        data.position.y,
        data.width,
        data.height
      );
      // Forward to worker
      this.sendObstacleToWorker('add', data.entityId, data.position.x, data.position.y, data.width, data.height);
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

      // Air units use direct paths (no terrain collision)
      if (unit.movementDomain === 'air') {
        const margin = 1;
        const clampedX = clamp(data.targetX, margin, this.mapWidth - margin);
        const clampedY = clamp(data.targetY, margin, this.mapHeight - margin);
        unit.setPath([{ x: clampedX, y: clampedY }]);
        return;
      }

      this.queuePathRequest({
        entityId: data.entityId,
        startX: transform.x,
        startY: transform.y,
        endX: data.targetX,
        endY: data.targetY,
        priority: data.priority ?? 1,
        movementDomain: unit.movementDomain,
      });
    });
  }

  private queuePathRequest(request: PathRequest): void {
    // Clamp destination to map bounds to prevent pathfinding to positions outside the map
    const margin = 1;
    request.endX = clamp(request.endX, margin, this.mapWidth - margin);
    request.endY = clamp(request.endY, margin, this.mapHeight - margin);

    const entity = this.world.getEntity(request.entityId);
    const unit = entity?.get<Unit>('Unit');
    const isBuilding = unit?.state === 'building' && unit?.constructingBuildingId !== null;

    // Check failed path cache - but skip for building workers who need to keep trying
    if (!isBuilding && this.isPathRecentlyFailed(request.entityId, request.endX, request.endY)) {
      this.clearUnitMovementTarget(request.entityId);
      return;
    }

    const domain = request.movementDomain ?? unit?.movementDomain ?? 'ground';

    // Check if destination is reachable (domain-aware)
    const isWalkable = this.recast.isWalkableForDomain(request.endX, request.endY, domain);
    if (!isWalkable) {
      const nearby = this.recast.findNearestPointForDomain(request.endX, request.endY, domain);
      if (!nearby) {
        // For building workers, don't record failure - the building center is expected
        // to be blocked. They'll keep trying to find a path on subsequent updates.
        if (!isBuilding) {
          this.recordFailedPath(request.entityId, request.endX, request.endY);
        }
        this.clearUnitMovementTarget(request.entityId);
        return;
      }
      request.endX = nearby.x;
      request.endY = nearby.y;
    }

    // PERF: Priority queue handles duplicate removal internally with O(log n) operations
    this.pendingRequests.push(request);
  }

  private clearUnitMovementTarget(entityId: number): void {
    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    const transform = entity.get<Transform>('Transform');
    if (!unit) return;

    unit.path = [];
    unit.pathIndex = 0;

    if (unit.state === 'moving') {
      unit.targetX = null;
      unit.targetY = null;
      unit.state = 'idle';
    } else if (unit.state === 'building' && unit.constructingBuildingId !== null && transform) {
      // Path to building center failed (blocked by building obstacle).
      // Calculate a valid interaction point on the building perimeter instead.
      const buildingEntity = this.world.getEntity(unit.constructingBuildingId);
      if (buildingEntity) {
        const buildingTransform = buildingEntity.get<Transform>('Transform');
        const building = buildingEntity.get<Building>('Building');
        if (buildingTransform && building) {
          const interactionPoint = this.calculateInteractionPoint(
            buildingTransform.x,
            buildingTransform.y,
            building.width,
            building.height,
            transform.x,
            transform.y,
            3.0 // Construction range
          );
          if (interactionPoint) {
            unit.targetX = interactionPoint.x;
            unit.targetY = interactionPoint.y;
            // Don't clear constructingBuildingId - worker should continue to construction site
            debugPathfinding.log(
              `[PathfindingSystem] Worker ${entityId} rerouted to interaction point (${interactionPoint.x.toFixed(1)}, ${interactionPoint.y.toFixed(1)}) for building ${unit.constructingBuildingId}`
            );
          }
        }
      }
    } else if (unit.state === 'gathering' && unit.gatherTargetId !== null && transform) {
      // Path to resource failed. Calculate interaction point for the resource.
      const resourceEntity = this.world.getEntity(unit.gatherTargetId);
      if (resourceEntity) {
        const resourceTransform = resourceEntity.get<Transform>('Transform');
        if (resourceTransform) {
          const interactionPoint = this.calculateInteractionPoint(
            resourceTransform.x,
            resourceTransform.y,
            0, // Resources are point targets
            0,
            transform.x,
            transform.y,
            2.0 // Gathering range
          );
          if (interactionPoint) {
            unit.targetX = interactionPoint.x;
            unit.targetY = interactionPoint.y;
            // Don't clear gatherTargetId - worker should continue to resource
            debugPathfinding.log(
              `[PathfindingSystem] Worker ${entityId} rerouted to interaction point (${interactionPoint.x.toFixed(1)}, ${interactionPoint.y.toFixed(1)}) for resource ${unit.gatherTargetId}`
            );
          }
        }
      }
    } else {
      unit.targetX = null;
      unit.targetY = null;
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

    // Use tick-based timing for determinism across clients
    const currentTick = this.game.getCurrentTick();
    if (currentTick - entry.tick > FAILED_PATH_CACHE_TTL_TICKS) {
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
    const currentTick = this.game.getCurrentTick();

    if (this.failedPathCache.size >= FAILED_PATH_CACHE_SIZE) {
      const oldKey = this.failedPathCacheKeys.shift();
      if (oldKey) this.failedPathCache.delete(oldKey);
    }

    this.failedPathCache.set(key, { tick: currentTick, failureCount: 1 });
    this.failedPathCacheKeys.push(key);
  }

  private processPathQueue(): void {
    if (this.pendingRequests.length === 0) return;
    if (!this.navMeshReady) return;

    const toProcess = Math.min(MAX_PATHS_PER_FRAME, this.pendingRequests.length);
    // PERF: Priority queue maintains sorted order - no need to sort()
    // pop() returns highest priority first in O(log n)

    for (let i = 0; i < toProcess; i++) {
      const request = this.pendingRequests.pop();
      if (request) {
        this.processPathRequest(request);
      }
    }
  }

  private processPathRequest(request: PathRequest): void {
    const entity = this.world.getEntity(request.entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    const domain = request.movementDomain ?? unit.movementDomain ?? 'ground';

    // Use worker for path computation if available (non-blocking)
    // NOTE: Worker only supports ground navmesh right now.
    if (this.pathWorker && this.workerReady && domain === 'ground') {
      const requestId = this.workerRequestId++;
      this.pendingWorkerRequests.set(requestId, request);

      // Get terrain heights for start/end positions
      const startHeight = this.terrainHeightFunction
        ? this.terrainHeightFunction(request.startX, request.startY)
        : 0;
      const endHeight = this.terrainHeightFunction
        ? this.terrainHeightFunction(request.endX, request.endY)
        : 0;

      this.pathWorker.postMessage({
        type: 'findPath',
        requestId,
        startX: request.startX,
        startY: request.startY,
        endX: request.endX,
        endY: request.endY,
        agentRadius: unit.collisionRadius,
        startHeight,
        endHeight,
      });
      return;
    }

    // Fallback to main thread (blocking) if worker not available
    // Use movement domain-aware pathfinding
    const result = this.findPathForDomain(
      request.startX,
      request.startY,
      request.endX,
      request.endY,
      domain,
      unit.collisionRadius
    );

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
      this.recordFailedPath(request.entityId, request.endX, request.endY);

      // Don't reset target or state when pathfinding fails for nearby targets
      // Let MovementSystem try direct movement instead
      unit.path = [];
      unit.pathIndex = 0;

      // Keep targetX/targetY set so unit can move directly
      // Only clear if target is very far (clearly needs a path)
      const dist = distance(request.startX, request.startY, request.endX, request.endY);

      if (dist > 30) {
        // Target is far, truly unreachable - reset for non-building units
        if (unit.state === 'moving') {
          unit.targetX = null;
          unit.targetY = null;
          unit.state = 'idle';
        } else if (unit.state === 'building') {
          // FIX: Don't cancel building assignments - let workers keep trying.
          // BuildingPlacementSystem will handle detecting if building is orphaned.
          // The building center being far doesn't mean the construction site is unreachable.
        } else if (unit.state === 'gathering') {
          // FIX: Same as building workers - don't cancel gather assignments.
          // ResourceSystem will keep reassigning targets and workers will use direct movement.
          unit.targetX = null;
          unit.targetY = null;
          // DON'T clear gatherTargetId or change state
        } else {
          unit.targetX = null;
          unit.targetY = null;
        }
      }
      // If dist <= 30, target is close - allow direct movement even without path

      this.unitPathStates.delete(request.entityId);
    }
  }

  public findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    agentRadius: number = 0.5
  ): PathResult {
    if (!this.navMeshReady) {
      return { path: [], found: false };
    }

    return this.recast.findPath(startX, startY, endX, endY, agentRadius);
  }

  /**
   * Find path with movement domain awareness.
   * Uses the appropriate navmesh based on the unit's movement domain.
   */
  public findPathForDomain(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    domain: 'ground' | 'water' | 'amphibious' | 'air',
    agentRadius: number = 0.5
  ): PathResult {
    return this.recast.findPathForDomain(startX, startY, endX, endY, domain, agentRadius);
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

    // NOTE: Crowd simulation is updated in MovementSystem AFTER setting targets
    // This ensures the crowd has fresh position/target data when it runs

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

      // Use cylinder obstacles (5-10x faster than box for TileCache updates)
      this.recast.addObstacle(
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

      const distanceMoved = distance(state.lastPosition.x, state.lastPosition.y, transform.x, transform.y);

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
              movementDomain: unit.movementDomain,
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
   * Decorations like rocks and trees block pathfinding
   */
  public registerDecorationCollisions(
    collisions: Array<{ x: number; z: number; radius: number }>
  ): void {
    if (!this.navMeshReady) {
      debugPathfinding.log(
        `[PathfindingSystem] NavMesh not ready, deferring ${collisions.length} decoration obstacles`
      );
      // Store for later registration when navmesh is ready
      this.pendingDecorations = collisions;
      return;
    }

    this.addDecorationObstacles(collisions);
  }

  private pendingDecorations: Array<{ x: number; z: number; radius: number }> | null = null;

  /**
   * Add decorations as TileCache obstacles
   * Called after navmesh is ready
   * FIX: Now also syncs obstacles to pathfinding worker for multiplayer consistency
   */
  private addDecorationObstacles(
    collisions: Array<{ x: number; z: number; radius: number }>
  ): void {
    let addedCount = 0;

    for (let i = 0; i < collisions.length; i++) {
      const deco = collisions[i];

      // Only add obstacles for decorations with significant radius
      // Small decorations (grass, small bushes) don't need to block pathfinding
      if (deco.radius < 0.5) continue;

      // Use negative entity IDs for decorations to avoid collision with unit/building IDs
      // Start at -10000 to leave room for other negative ID uses
      const decorationEntityId = -10000 - i;

      const width = deco.radius * 2;  // diameter
      const height = deco.radius * 2; // diameter

      // Add cylinder obstacle for the decoration (main thread)
      this.recast.addObstacle(
        decorationEntityId,
        deco.x,
        deco.z, // Note: z is the world Y coordinate in game space
        width,
        height
      );

      // FIX: Also send to worker for consistent pathfinding in multiplayer
      // Without this, worker paths through decorations while main thread respects them
      this.sendObstacleToWorker('add', decorationEntityId, deco.x, deco.z, width, height);

      addedCount++;
    }

    debugPathfinding.log(
      `[PathfindingSystem] Added ${addedCount} decoration obstacles (of ${collisions.length} total decorations) - synced to worker`
    );
  }

  /**
   * Called when navmesh initialization completes
   * Registers any pending decorations that were deferred
   */
  private onNavMeshReady(): void {
    if (this.pendingDecorations) {
      this.addDecorationObstacles(this.pendingDecorations);
      this.pendingDecorations = null;
    }
  }

  // ==================== INTERACTION POINT CALCULATION ====================

  /**
   * Calculate a valid navmesh point where a unit can stand to interact with a building/resource.
   *
   * The problem: Buildings are navmesh obstacles, so paths to their centers fail.
   * The solution: Calculate a point on the building's perimeter that IS on the navmesh.
   *
   * @param targetX - Center X of the building/resource
   * @param targetY - Center Y of the building/resource
   * @param targetWidth - Width of the building (use 0 for point targets like resources)
   * @param targetHeight - Height of the building (use 0 for point targets)
   * @param workerX - Worker's current X position
   * @param workerY - Worker's current Y position
   * @param interactionRange - How close the worker needs to be (default 2.0)
   * @returns Valid navmesh point, or null if none found
   */
  public calculateInteractionPoint(
    targetX: number,
    targetY: number,
    targetWidth: number,
    targetHeight: number,
    workerX: number,
    workerY: number,
    interactionRange: number = 2.0
  ): { x: number; y: number } | null {
    // Calculate direction from target to worker
    const dx = workerX - targetX;
    const dy = workerY - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.01) {
      // Worker is at center - pick arbitrary direction
      return this.findValidPerimeterPoint(targetX, targetY, targetWidth, targetHeight, 1, 0, interactionRange);
    }

    // Normalize direction
    const dirX = dx / dist;
    const dirY = dy / dist;

    // First try: point on perimeter in direction of worker
    const result = this.findValidPerimeterPoint(targetX, targetY, targetWidth, targetHeight, dirX, dirY, interactionRange);
    if (result) return result;

    // Second try: sample points around the perimeter
    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
    for (const angle of angles) {
      const sampleDirX = Math.cos(angle);
      const sampleDirY = Math.sin(angle);
      const sampleResult = this.findValidPerimeterPoint(targetX, targetY, targetWidth, targetHeight, sampleDirX, sampleDirY, interactionRange);
      if (sampleResult) return sampleResult;
    }

    // Fallback: use navmesh nearest point query
    const halfW = targetWidth / 2 + interactionRange;
    const halfH = targetHeight / 2 + interactionRange;
    const fallbackX = targetX + dirX * halfW;
    const fallbackY = targetY + dirY * halfH;

    return this.recast.findNearestPoint(fallbackX, fallbackY);
  }

  /**
   * Find a valid navmesh point on the building perimeter in a given direction.
   */
  private findValidPerimeterPoint(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    dirX: number,
    dirY: number,
    interactionRange: number
  ): { x: number; y: number } | null {
    // Calculate point outside the building + interaction margin
    const halfW = width / 2 + interactionRange;
    const halfH = height / 2 + interactionRange;

    // Project direction onto perimeter (rectangular)
    let pointX: number;
    let pointY: number;

    if (Math.abs(dirX) > Math.abs(dirY)) {
      // Hit left/right edge
      pointX = centerX + (dirX > 0 ? halfW : -halfW);
      pointY = centerY + dirY * halfH * (Math.abs(dirY) / Math.abs(dirX));
      pointY = clamp(pointY, centerY - halfH, centerY + halfH);
    } else {
      // Hit top/bottom edge
      pointY = centerY + (dirY > 0 ? halfH : -halfH);
      pointX = centerX + dirX * halfW * (Math.abs(dirX) / Math.max(Math.abs(dirY), 0.01));
      pointX = clamp(pointX, centerX - halfW, centerX + halfW);
    }

    // Check if this point is on the navmesh
    if (this.recast.isWalkable(pointX, pointY)) {
      return { x: pointX, y: pointY };
    }

    // Try navmesh nearest point from this position
    return this.recast.findNearestPoint(pointX, pointY);
  }
}
