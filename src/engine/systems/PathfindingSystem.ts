import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Game } from '../core/Game';
import { AStar, PathResult } from '../pathfinding/AStar';
import { HierarchicalAStar } from '../pathfinding/HierarchicalAStar';
import { MapData, TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { debugPathfinding, debugPerformance } from '@/utils/debugLogger';

// Configuration for path invalidation
const REPATH_INTERVAL_TICKS = 60; // Check for repath every 3 seconds at 20 TPS
const BLOCKED_CHECK_RADIUS = 3; // Check cells within this radius for blockage
const MAX_STUCK_TICKS = 20; // If unit hasn't moved for 1 second, repath (less aggressive)
const MIN_MOVEMENT_THRESHOLD = 0.2; // Minimum distance to count as "moved" (20cm)
const PATH_REQUEST_COOLDOWN = 30; // Minimum ticks between path requests (1.5 seconds)

// Path request batching - spread expensive pathfinding across frames
const MAX_PATHS_PER_FRAME = 4; // Process at most this many path requests per frame

// Terrain edge buffer - units can't path right next to terrain edges
// This prevents units from getting stuck on collision with terrain edges
const TERRAIN_EDGE_BUFFER = 1; // Number of cells to buffer around unwalkable terrain

// Failed path caching - prevent re-requesting impossible paths
const FAILED_PATH_CACHE_TTL = 10000; // Don't retry failed paths for 10 seconds
const FAILED_PATH_CACHE_SIZE = 200; // Max number of per-entity cached failures
const GLOBAL_UNREACHABLE_TTL = 15000; // Global unreachable destinations persist for 15 seconds
const GLOBAL_UNREACHABLE_CACHE_SIZE = 100; // Max globally unreachable destinations

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

interface GlobalUnreachableEntry {
  timestamp: number;
  failedEntityCount: number; // How many different entities failed to reach this
}

// Distance threshold for using hierarchical pathfinding
const HIERARCHICAL_PATH_THRESHOLD = 20;

export class PathfindingSystem extends System {
  public priority = 5; // Run before MovementSystem

  private pathfinder: AStar;
  private hierarchicalPathfinder: HierarchicalAStar;
  private unitPathStates: Map<number, UnitPathState> = new Map();
  private pendingRequests: PathRequest[] = [];

  // OPTIMIZED: Use numeric keys instead of string keys to avoid GC pressure
  private blockedCells: Set<number> = new Set();
  private cellsChangedThisTick: Set<number> = new Set();
  private mapWidth: number;
  private mapHeight: number;

  // Failed path cache - prevent re-requesting impossible paths
  // Key format: "entityId_destGridX_destGridY"
  private failedPathCache: Map<string, FailedPathEntry> = new Map();
  private failedPathCacheKeys: string[] = []; // For LRU eviction

  // Global unreachable destination cache - if multiple units fail to reach a destination,
  // it's likely unreachable for everyone. Key format: "destGridX_destGridY"
  private globalUnreachableCache: Map<string, GlobalUnreachableEntry> = new Map();
  private globalUnreachableCacheKeys: string[] = []; // For LRU eviction

  constructor(game: Game, mapWidth: number, mapHeight: number) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.pathfinder = new AStar(mapWidth, mapHeight, 1);
    this.hierarchicalPathfinder = new HierarchicalAStar(mapWidth, mapHeight, 1);
    this.setupEventListeners();
    // Note: loadTerrainData() is called by Game.setTerrainGrid() when map is loaded
    debugPathfinding.log(`[PathfindingSystem] CONSTRUCTOR: dimensions ${mapWidth}x${mapHeight}`);
  }

  /**
   * Reinitialize pathfinding grids with new dimensions.
   * Call this when map dimensions change.
   */
  public reinitialize(mapWidth: number, mapHeight: number): void {
    debugPathfinding.log(`[PathfindingSystem] REINITIALIZE: from ${this.mapWidth}x${this.mapHeight} to ${mapWidth}x${mapHeight}`);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.pathfinder = new AStar(mapWidth, mapHeight, 1);
    this.hierarchicalPathfinder = new HierarchicalAStar(mapWidth, mapHeight, 1);
    this.blockedCells.clear();
    this.cellsChangedThisTick.clear();
    this.pendingRequests = [];
    this.unitPathStates.clear();
    debugPathfinding.log(`[PathfindingSystem] Reinitialized with dimensions ${mapWidth}x${mapHeight}`);
  }

  /**
   * Load terrain walkability into the pathfinding grid.
   * Uses TERRAIN_FEATURE_CONFIG to properly determine walkability and movement costs.
   * Adds buffer zones around unwalkable terrain to prevent units getting stuck on edges.
   */
  public loadTerrainData(): void {
    debugPathfinding.log(`[PathfindingSystem] LOAD_TERRAIN_DATA: called with mapWidth=${this.mapWidth}, mapHeight=${this.mapHeight}`);
    const startTime = performance.now();

    const terrainGrid = this.game.getTerrainGrid();
    if (!terrainGrid) {
      debugPathfinding.warn('[PathfindingSystem] LOAD_TERRAIN_DATA: No terrain grid available');
      return;
    }
    debugPathfinding.log(`[PathfindingSystem] LOAD_TERRAIN_DATA: terrain grid is ${terrainGrid[0]?.length}x${terrainGrid.length}`);

    // First pass: identify all unwalkable cells
    const unwalkableCells = new Set<number>();
    const moveCosts = new Map<number, number>();

    for (let y = 0; y < terrainGrid.length; y++) {
      for (let x = 0; x < terrainGrid[y].length; x++) {
        const cell = terrainGrid[y][x];
        let isWalkable = true;
        let moveCost = 1.0;

        // Check base terrain type
        if (cell.terrain === 'unwalkable') {
          isWalkable = false;
        }

        // Check terrain feature using the config
        if (cell.feature) {
          const feature = cell.feature as TerrainFeature;
          const featureConfig = TERRAIN_FEATURE_CONFIG[feature];

          if (featureConfig) {
            // Feature can override walkability
            if (!featureConfig.walkable) {
              isWalkable = false;
            }

            // Use the feature's speed modifier to set move cost
            // speedModifier < 1 means slower, so moveCost should be higher
            if (featureConfig.speedModifier > 0) {
              moveCost = 1.0 / featureConfig.speedModifier;
            } else {
              // Speed 0 means unwalkable
              isWalkable = false;
            }
          }
        }

        const key = this.cellKey(x, y);
        if (!isWalkable) {
          unwalkableCells.add(key);
        } else {
          moveCosts.set(key, moveCost);
        }
      }
    }

    // Second pass: create buffer zones around unwalkable cells
    // This prevents units from pathing right along terrain edges
    const bufferedCells = new Set<number>();
    const height = terrainGrid.length;
    const width = terrainGrid[0].length;

    for (const key of unwalkableCells) {
      const y = Math.floor(key / this.mapWidth);
      const x = key % this.mapWidth;

      // Add buffer around this unwalkable cell
      for (let dy = -TERRAIN_EDGE_BUFFER; dy <= TERRAIN_EDGE_BUFFER; dy++) {
        for (let dx = -TERRAIN_EDGE_BUFFER; dx <= TERRAIN_EDGE_BUFFER; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const neighborKey = this.cellKey(nx, ny);
            // Only buffer walkable cells that aren't already unwalkable
            if (!unwalkableCells.has(neighborKey)) {
              const neighborCell = terrainGrid[ny][nx];
              // Don't buffer ramps - they need to stay walkable for navigation
              if (neighborCell.terrain !== 'ramp') {
                bufferedCells.add(neighborKey);
              }
            }
          }
        }
      }
    }

    // Third pass: apply walkability and costs
    let blockedCount = 0;
    let bufferedCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = this.cellKey(x, y);

        if (unwalkableCells.has(key)) {
          // Primary unwalkable cell
          this.pathfinder.setWalkable(x, y, false);
          this.hierarchicalPathfinder.setWalkable(x, y, false);
          this.blockedCells.add(key);
          blockedCount++;
        } else if (bufferedCells.has(key)) {
          // Buffer zone cell - increase movement cost significantly instead of blocking
          // This allows paths through edges when necessary but discourages them
          const baseCost = moveCosts.get(key) || 1.0;
          const bufferedCost = baseCost * 3.0; // High cost discourages but doesn't block
          this.pathfinder.setMoveCost(x, y, bufferedCost);
          this.hierarchicalPathfinder.setMoveCost(x, y, bufferedCost);
          bufferedCount++;
        } else {
          // Normal walkable cell - apply regular movement cost
          const cost = moveCosts.get(key) || 1.0;
          this.pathfinder.setMoveCost(x, y, cost);
          this.hierarchicalPathfinder.setMoveCost(x, y, cost);
        }
      }
    }

    const elapsed = performance.now() - startTime;
    debugPathfinding.log(`[PathfindingSystem] LOAD_TERRAIN_DATA: completed in ${elapsed.toFixed(1)}ms - ${blockedCount} blocked, ${bufferedCount} buffered`);

    // Rebuild hierarchical pathfinding graph after terrain is loaded
    this.hierarchicalPathfinder.rebuildAbstractGraph();
  }

  /**
   * Convert (x, y) to numeric cell key - avoids string allocation
   */
  private cellKey(x: number, y: number): number {
    return Math.floor(y) * this.mapWidth + Math.floor(x);
  }

  /**
   * Initialize the pathfinding grid from terrain data.
   * Must be called after the game is created with the map data.
   * Uses TERRAIN_FEATURE_CONFIG to properly determine walkability and movement costs.
   */
  public initializeFromTerrain(mapData: MapData): void {
    debugPathfinding.log('[PathfindingSystem] Initializing from terrain data...');
    let blockedCount = 0;

    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const cell = mapData.terrain[y][x];
        let isWalkable = true;
        let moveCost = 1.0;

        // Check base terrain type
        if (cell.terrain === 'unwalkable') {
          isWalkable = false;
        }

        // Check terrain feature using the config
        if (cell.feature) {
          const feature = cell.feature as TerrainFeature;
          const featureConfig = TERRAIN_FEATURE_CONFIG[feature];

          if (featureConfig) {
            if (!featureConfig.walkable) {
              isWalkable = false;
            }
            if (featureConfig.speedModifier > 0) {
              moveCost = 1.0 / featureConfig.speedModifier;
            } else {
              isWalkable = false;
            }
          }
        }

        if (!isWalkable) {
          this.pathfinder.setWalkable(x, y, false);
          this.hierarchicalPathfinder.setWalkable(x, y, false);
          this.blockedCells.add(this.cellKey(x, y));
          blockedCount++;
        } else {
          this.pathfinder.setMoveCost(x, y, moveCost);
          this.hierarchicalPathfinder.setMoveCost(x, y, moveCost);
        }
      }
    }

    debugPathfinding.log(`[PathfindingSystem] Marked ${blockedCount} cells as unwalkable`);

    // Rebuild hierarchical pathfinding graph
    this.hierarchicalPathfinder.rebuildAbstractGraph();
  }

  private setupEventListeners(): void {
    // Listen for building placement to block cells
    this.game.eventBus.on('building:placed', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.blockArea(data.position.x, data.position.y, data.width, data.height);
    });

    // Listen for building destruction to unblock cells
    this.game.eventBus.on('building:destroyed', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.unblockArea(data.position.x, data.position.y, data.width, data.height);
    });

    // Listen for building construction started
    this.game.eventBus.on('building:constructionStarted', (data: {
      entityId: number;
      position: { x: number; y: number };
      width: number;
      height: number;
    }) => {
      this.blockArea(data.position.x, data.position.y, data.width, data.height);
    });

    // Clean up path states when units die to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.unitPathStates.delete(data.entityId);
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.unitPathStates.delete(data.entityId);
    });

    // Handle move commands - queue paths for batched processing
    this.game.eventBus.on('pathfinding:request', (data: {
      entityId: number;
      targetX: number;
      targetY: number;
      priority?: number;
    }) => {
      const entity = this.world.getEntity(data.entityId);
      if (!entity) return;

      const transform = entity.get<Transform>('Transform');
      if (!transform) return;

      const unit = entity.get<Unit>('Unit');
      if (!unit) return;

      // Flying units don't need pathfinding - they move directly to target
      if (unit.isFlying) {
        // Set a direct path for flying units (no pathfinding needed)
        unit.setPath([{ x: data.targetX, y: data.targetY }]);
        return;
      }

      // Queue the request instead of processing immediately
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

  /**
   * Queue a path request for batched processing.
   * Removes any existing request for the same entity.
   * Skips requests to destinations that recently failed.
   */
  private queuePathRequest(request: PathRequest): void {
    // Check failed path cache - don't retry paths that recently failed
    if (this.isPathRecentlyFailed(request.entityId, request.endX, request.endY)) {
      // CRITICAL: Also clear unit's target so it stops requesting
      this.clearUnitMovementTarget(request.entityId);
      return; // Skip this request
    }

    // Early walkability check - skip obviously unreachable destinations
    const endGridX = Math.floor(request.endX);
    const endGridY = Math.floor(request.endY);
    if (!this.pathfinder.isWalkable(endGridX, endGridY)) {
      // Try to find nearby walkable cell before queueing
      const nearby = this.findNearbyWalkableCell(request.endX, request.endY, 5);
      if (!nearby) {
        // No walkable cell nearby - record as failed and clear target
        this.recordFailedPath(request.entityId, request.endX, request.endY);
        this.clearUnitMovementTarget(request.entityId);
        return;
      }
      // Update request to use nearby walkable cell
      request.endX = nearby.x;
      request.endY = nearby.y;
    }

    // Remove existing request for this entity (newer request supersedes)
    const existingIdx = this.pendingRequests.findIndex(r => r.entityId === request.entityId);
    if (existingIdx !== -1) {
      this.pendingRequests.splice(existingIdx, 1);
    }

    // Add to queue - higher priority requests go first
    this.pendingRequests.push(request);
  }

  /**
   * Clear a unit's movement target to stop it from requesting paths.
   */
  private clearUnitMovementTarget(entityId: number): void {
    const entity = this.world.getEntity(entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    unit.path = [];
    unit.pathIndex = 0;
    unit.targetX = null;
    unit.targetY = null;

    // Reset workers stuck in building/gathering states back to idle
    // so they can be reassigned by the AI system
    if (unit.state === 'moving') {
      unit.state = 'idle';
    } else if (unit.state === 'building') {
      // Cancel construction assignment so worker becomes available
      unit.cancelBuilding();
    } else if (unit.state === 'gathering') {
      // Clear gather target so worker becomes available
      unit.gatherTargetId = null;
      unit.isMining = false;
      unit.state = 'idle';
    }

    this.unitPathStates.delete(entityId);
  }

  /**
   * Check if a path to this destination recently failed.
   * Returns TRUE immediately on any failure - no waiting for multiple failures.
   */
  private isPathRecentlyFailed(entityId: number, destX: number, destY: number): boolean {
    const destGridX = Math.floor(destX);
    const destGridY = Math.floor(destY);
    const now = Date.now();

    // FIRST: Check global unreachable cache (destination unreachable for everyone)
    const globalKey = `${destGridX}_${destGridY}`;
    const globalEntry = this.globalUnreachableCache.get(globalKey);
    if (globalEntry) {
      if (now - globalEntry.timestamp > GLOBAL_UNREACHABLE_TTL) {
        // Expired - remove from cache
        this.globalUnreachableCache.delete(globalKey);
        const idx = this.globalUnreachableCacheKeys.indexOf(globalKey);
        if (idx !== -1) this.globalUnreachableCacheKeys.splice(idx, 1);
      } else if (globalEntry.failedEntityCount >= 2) {
        // 2+ units failed to reach this destination - block ALL units
        return true;
      }
    }

    // SECOND: Check per-entity cache
    const key = `${entityId}_${destGridX}_${destGridY}`;
    const entry = this.failedPathCache.get(key);
    if (!entry) return false;

    // If TTL expired, remove from cache
    if (now - entry.timestamp > FAILED_PATH_CACHE_TTL) {
      this.failedPathCache.delete(key);
      const idx = this.failedPathCacheKeys.indexOf(key);
      if (idx !== -1) this.failedPathCacheKeys.splice(idx, 1);
      return false;
    }

    // Block on ANY failure - don't wait for multiple failures
    // This is the key fix: return true immediately on first failure
    return true;
  }

  /**
   * Record a failed path attempt.
   * Updates both per-entity cache and global unreachable cache.
   */
  private recordFailedPath(entityId: number, destX: number, destY: number): void {
    const destGridX = Math.floor(destX);
    const destGridY = Math.floor(destY);
    const now = Date.now();

    // 1. Update per-entity cache
    const key = `${entityId}_${destGridX}_${destGridY}`;
    const existing = this.failedPathCache.get(key);

    if (existing && now - existing.timestamp < FAILED_PATH_CACHE_TTL) {
      // Increment failure count
      existing.failureCount++;
      existing.timestamp = now;
    } else {
      // New entry or expired - start fresh
      if (this.failedPathCache.size >= FAILED_PATH_CACHE_SIZE) {
        // LRU eviction
        const oldKey = this.failedPathCacheKeys.shift();
        if (oldKey) this.failedPathCache.delete(oldKey);
      }

      this.failedPathCache.set(key, { timestamp: now, failureCount: 1 });
      this.failedPathCacheKeys.push(key);
    }

    // 2. Update global unreachable cache
    // Track that this destination failed for this entity
    const globalKey = `${destGridX}_${destGridY}`;
    const globalExisting = this.globalUnreachableCache.get(globalKey);

    if (globalExisting && now - globalExisting.timestamp < GLOBAL_UNREACHABLE_TTL) {
      // Check if this entity is a new failure for this destination
      // (Use the per-entity cache to determine if this is a new entity)
      if (!existing || now - existing.timestamp >= FAILED_PATH_CACHE_TTL) {
        globalExisting.failedEntityCount++;
        globalExisting.timestamp = now;
      }
    } else {
      // New entry or expired
      if (this.globalUnreachableCache.size >= GLOBAL_UNREACHABLE_CACHE_SIZE) {
        // LRU eviction
        const oldKey = this.globalUnreachableCacheKeys.shift();
        if (oldKey) this.globalUnreachableCache.delete(oldKey);
      }

      this.globalUnreachableCache.set(globalKey, { timestamp: now, failedEntityCount: 1 });
      this.globalUnreachableCacheKeys.push(globalKey);
    }
  }

  /**
   * Clear failed path cache for an entity (e.g., when destination changes).
   */
  private clearFailedPathsForEntity(entityId: number): void {
    const prefix = `${entityId}_`;
    for (const key of [...this.failedPathCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.failedPathCache.delete(key);
        const idx = this.failedPathCacheKeys.indexOf(key);
        if (idx !== -1) this.failedPathCacheKeys.splice(idx, 1);
      }
    }
  }

  /**
   * Process queued path requests (up to MAX_PATHS_PER_FRAME).
   */
  private processPathQueue(): void {
    if (this.pendingRequests.length === 0) return;

    const queueSize = this.pendingRequests.length;
    const toProcess = Math.min(MAX_PATHS_PER_FRAME, queueSize);

    // Only log if queue is backing up (more than we can process)
    if (queueSize > MAX_PATHS_PER_FRAME) {
      debugPathfinding.log(`[Pathfinding] Processing queue: ${queueSize} pending, processing ${toProcess}`);
    }

    const queueStart = performance.now();

    // Sort by priority (higher first) - only sort when we have requests
    this.pendingRequests.sort((a, b) => b.priority - a.priority);

    // Process up to MAX_PATHS_PER_FRAME requests
    for (let i = 0; i < toProcess; i++) {
      const request = this.pendingRequests.shift()!;
      this.processPathRequest(request);
    }

    const queueElapsed = performance.now() - queueStart;
    if (queueElapsed > 10) {
      debugPerformance.warn(`[PathfindingSystem] PROCESS_QUEUE: ${toProcess} paths took ${queueElapsed.toFixed(1)}ms (${(queueElapsed/toProcess).toFixed(1)}ms each)`);
    }
  }

  private blockArea(centerX: number, centerY: number, width: number, height: number): void {
    const halfW = width / 2;
    const halfH = height / 2;

    // Calculate grid cell bounds (cells are unit squares)
    // For a building from (47.5, 47.5) to (52.5, 52.5), we block cells 47-52
    const minX = Math.floor(centerX - halfW);
    const maxX = Math.ceil(centerX + halfW) - 1; // -1 because cell 53 starts at 53.0
    const minY = Math.floor(centerY - halfH);
    const maxY = Math.ceil(centerY + halfH) - 1;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // Bounds check
        if (x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight) continue;

        const key = this.cellKey(x, y);
        this.blockedCells.add(key);
        this.cellsChangedThisTick.add(key);
        this.pathfinder.setWalkable(x, y, false);
        this.hierarchicalPathfinder.setWalkable(x, y, false);
      }
    }
  }

  private unblockArea(centerX: number, centerY: number, width: number, height: number): void {
    const halfW = width / 2;
    const halfH = height / 2;

    // Calculate grid cell bounds (cells are unit squares)
    const minX = Math.floor(centerX - halfW);
    const maxX = Math.ceil(centerX + halfW) - 1;
    const minY = Math.floor(centerY - halfH);
    const maxY = Math.ceil(centerY + halfH) - 1;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // Bounds check
        if (x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight) continue;

        const key = this.cellKey(x, y);
        this.blockedCells.delete(key);
        this.cellsChangedThisTick.add(key);
        this.pathfinder.setWalkable(x, y, true);
        this.hierarchicalPathfinder.setWalkable(x, y, true);
      }
    }
  }

  private processPathRequest(request: PathRequest): void {
    // Calculate path using the smart routing (hierarchical for long paths, regular for short)
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

    // CRITICAL FIX: Do NOT try expensive fallback pathfinding attempts!
    // The old code would try up to 3 full pathfinding attempts per request:
    // 1. Original path (hits MAX_ITERATIONS for unreachable destinations)
    // 2. Alternate end destination (hits MAX_ITERATIONS again)
    // 3. Alternate start position (hits MAX_ITERATIONS again)
    // This caused 45,000+ A* iterations per failed request!
    //
    // Instead, if the first attempt fails, we immediately record failure.
    // The failed path cache will prevent retry spam.

    if (result.found && result.path.length > 0) {
      unit.setPath(result.path);

      // Track the destination for repath checks
      this.unitPathStates.set(request.entityId, {
        lastPosition: { x: request.startX, y: request.startY },
        lastMoveTick: this.game.getCurrentTick(),
        lastRepathTick: this.game.getCurrentTick(),
        destinationX: request.endX,
        destinationY: request.endY,
      });
    } else {
      // Path failed - record in cache to prevent retry spam
      this.recordFailedPath(request.entityId, request.endX, request.endY);

      // Clear the unit's current path so it doesn't keep trying
      unit.path = [];
      unit.pathIndex = 0;

      // CRITICAL: Clear the unit's target to stop endless path requests
      // Without this, MovementSystem will keep requesting paths every cooldown
      unit.targetX = null;
      unit.targetY = null;

      // Reset workers stuck in building/gathering states back to idle
      // so they can be reassigned by the AI system
      if (unit.state === 'moving') {
        unit.state = 'idle';
      } else if (unit.state === 'building') {
        // Cancel construction assignment so worker becomes available
        unit.cancelBuilding();
      } else if (unit.state === 'gathering') {
        // Clear gather target so worker becomes available
        unit.gatherTargetId = null;
        unit.isMining = false;
        unit.state = 'idle';
      }

      // Remove from unitPathStates since the destination is unreachable
      this.unitPathStates.delete(request.entityId);

      // Path completely failed - only log occasionally to avoid spam
      const failedEntry = this.failedPathCache.get(`${request.entityId}_${Math.floor(request.endX)}_${Math.floor(request.endY)}`);
      if (failedEntry && failedEntry.failureCount === 1) {
        debugPathfinding.warn(`[PathfindingSystem] Failed to find path for entity ${request.entityId} from (${request.startX.toFixed(1)}, ${request.startY.toFixed(1)}) to (${request.endX.toFixed(1)}, ${request.endY.toFixed(1)}) - destination unreachable, clearing target`);
      }
    }
  }

  /**
   * Find a nearby walkable cell using spiral search pattern.
   */
  private findNearbyWalkableCell(x: number, y: number, maxRadius: number): { x: number; y: number } | null {
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);

    // Check if original position is walkable
    if (this.pathfinder.isWalkable(gridX, gridY)) {
      return { x: gridX + 0.5, y: gridY + 0.5 };
    }

    // Spiral search for nearby walkable cell
    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue; // Only check perimeter

          const checkX = gridX + dx;
          const checkY = gridY + dy;

          if (this.pathfinder.isWalkable(checkX, checkY)) {
            return { x: checkX + 0.5, y: checkY + 0.5 };
          }
        }
      }
    }

    return null;
  }

  public findPath(startX: number, startY: number, endX: number, endY: number): PathResult {
    const findStart = performance.now();

    // Use hierarchical pathfinding for long distances
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let result: PathResult;
    let useHierarchical = false;

    if (distance > HIERARCHICAL_PATH_THRESHOLD) {
      useHierarchical = true;
      result = this.hierarchicalPathfinder.findPath(startX, startY, endX, endY);
    } else {
      result = this.pathfinder.findPath(startX, startY, endX, endY);
    }

    const findElapsed = performance.now() - findStart;
    if (findElapsed > 5) { // Only log if > 5ms
      debugPerformance.log(`[PathfindingSystem] FIND_PATH: ${useHierarchical ? 'HIER' : 'BASE'} (${startX.toFixed(0)},${startY.toFixed(0)}) -> (${endX.toFixed(0)},${endY.toFixed(0)}) dist=${distance.toFixed(0)} took ${findElapsed.toFixed(1)}ms found=${result.found} pathLen=${result.path.length}`);
    }

    return result;
  }

  public isWalkable(x: number, y: number): boolean {
    return this.pathfinder.isWalkable(x, y);
  }

  public update(_deltaTime: number): void {
    const updateStart = performance.now();
    const currentTick = this.game.getCurrentTick();

    // Sync blocked cells with existing buildings on first tick
    if (currentTick === 1) {
      this.syncBlockedCellsWithBuildings();
    }

    // Check for path invalidation due to cell changes
    if (this.cellsChangedThisTick.size > 0) {
      this.invalidateAffectedPaths();
      this.cellsChangedThisTick.clear();
    }

    // Process queued path requests (batched to avoid freezing)
    this.processPathQueue();

    // Check moving units for stuck detection and periodic repath
    this.checkMovingUnits(currentTick);

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) { // More than one frame at 60fps
      debugPerformance.warn(`[PathfindingSystem] UPDATE: tick ${currentTick} took ${updateElapsed.toFixed(1)}ms`);
    }
  }

  private syncBlockedCellsWithBuildings(): void {
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    let blockedBuildingCount = 0;

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      // Only block complete or under-construction buildings (not destroyed/flying)
      if (building.state === 'destroyed' || building.isFlying) continue;

      this.blockArea(transform.x, transform.y, building.width, building.height);
      blockedBuildingCount++;
      debugPathfinding.log(`[PathfindingSystem] Blocked ${building.name} at (${transform.x}, ${transform.y}), size ${building.width}x${building.height}`);
    }

    debugPathfinding.log(`[PathfindingSystem] Synced ${blockedBuildingCount} buildings as obstacles`);

    this.cellsChangedThisTick.clear(); // Don't trigger invalidation on initial sync

    // Rebuild hierarchical graph after syncing all buildings
    this.hierarchicalPathfinder.rebuildAbstractGraph();
  }

  private invalidateAffectedPaths(): void {
    const entities = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;

      // Only check units that are moving and have a path
      if (unit.state !== 'moving' || unit.path.length === 0) continue;

      // Check if any cell in the current path was changed
      if (this.isPathAffected(unit.path, unit.pathIndex)) {
        const state = this.unitPathStates.get(entity.id);
        if (state) {
          // Recalculate path to original destination
          this.queuePathRequest({
            entityId: entity.id,
            startX: transform.x,
            startY: transform.y,
            endX: state.destinationX,
            endY: state.destinationY,
            priority: 2, // Higher priority for invalidated paths
          });
        }
      }
    }
  }

  private isPathAffected(path: Array<{ x: number; y: number }>, fromIndex: number): boolean {
    for (let i = fromIndex; i < path.length; i++) {
      const waypoint = path[i];
      const wx = Math.floor(waypoint.x);
      const wy = Math.floor(waypoint.y);
      const key = this.cellKey(wx, wy);
      if (this.cellsChangedThisTick.has(key)) {
        return true;
      }
      // Also check adjacent cells for units with collision radius
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const adjKey = this.cellKey(wx + dx, wy + dy);
          if (this.cellsChangedThisTick.has(adjKey)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private checkMovingUnits(currentTick: number): void {
    const entities = this.world.getEntitiesWith('Unit', 'Transform');

    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit')!;
      const transform = entity.get<Transform>('Transform')!;

      // Flying units don't need pathfinding stuck detection
      if (unit.isFlying) {
        this.unitPathStates.delete(entity.id);
        continue;
      }

      // Only check units that are trying to move
      if (unit.state !== 'moving' && unit.state !== 'attacking' && unit.state !== 'gathering' && unit.state !== 'attackmoving') {
        // Clean up state for non-moving units
        this.unitPathStates.delete(entity.id);
        continue;
      }

      let state = this.unitPathStates.get(entity.id);

      // If no state exists, create one
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

      // Update destination if it changed
      if (unit.targetX !== null && unit.targetY !== null) {
        state.destinationX = unit.targetX;
        state.destinationY = unit.targetY;
      }

      // Check if unit has moved
      const dx = transform.x - state.lastPosition.x;
      const dy = transform.y - state.lastPosition.y;
      const distanceMoved = Math.sqrt(dx * dx + dy * dy);

      if (distanceMoved > MIN_MOVEMENT_THRESHOLD) {
        // Unit is moving, update state
        state.lastPosition = { x: transform.x, y: transform.y };
        state.lastMoveTick = currentTick;
      } else {
        // Unit hasn't moved - check if stuck
        const ticksSinceMove = currentTick - state.lastMoveTick;
        const ticksSinceRepath = currentTick - state.lastRepathTick;

        if (ticksSinceMove > MAX_STUCK_TICKS && ticksSinceRepath > PATH_REQUEST_COOLDOWN) {
          // Unit is stuck - check if current waypoint or next cell is blocked
          let needsRepath = true;

          // Check if we're near the destination (stuck in a crowd is OK)
          const distToDest = Math.sqrt(
            (transform.x - state.destinationX) ** 2 +
            (transform.y - state.destinationY) ** 2
          );
          if (distToDest < 2) {
            needsRepath = false; // Close enough, don't spam repaths
          }

          if (needsRepath && (unit.path.length > 0 || (unit.targetX !== null && unit.targetY !== null))) {
            // Clear current path and recalculate
            debugPathfinding.log(`[PathfindingSystem] STUCK_REPATH: entity ${entity.id} stuck for ${ticksSinceMove} ticks at (${transform.x.toFixed(1)},${transform.y.toFixed(1)})`);
            unit.path = [];
            unit.pathIndex = 0;

            this.queuePathRequest({
              entityId: entity.id,
              startX: transform.x,
              startY: transform.y,
              endX: state.destinationX,
              endY: state.destinationY,
              priority: 3, // Highest priority for stuck units
            });
            state.lastMoveTick = currentTick; // Reset stuck timer
            state.lastRepathTick = currentTick; // Reset repath timer
          }
        }
      }

      // Periodic repath check (for units that are moving but may have suboptimal paths)
      if (currentTick - state.lastRepathTick > REPATH_INTERVAL_TICKS) {
        state.lastRepathTick = currentTick;

        // Check if there's a significantly blocked path ahead
        if (this.isPathSignificantlyBlocked(unit.path, unit.pathIndex)) {
          debugPathfinding.log(`[PathfindingSystem] PERIODIC_REPATH: entity ${entity.id} path blocked, requesting new path`);
          this.queuePathRequest({
            entityId: entity.id,
            startX: transform.x,
            startY: transform.y,
            endX: state.destinationX,
            endY: state.destinationY,
            priority: 1,
          });
        }
      }
    }
  }

  private isPathSignificantlyBlocked(path: Array<{ x: number; y: number }>, fromIndex: number): boolean {
    let blockedCount = 0;
    const checkCount = Math.min(5, path.length - fromIndex);
    const blockedWaypoints: string[] = [];

    for (let i = fromIndex; i < fromIndex + checkCount; i++) {
      if (i >= path.length) break;
      const waypoint = path[i];
      if (!this.pathfinder.isWalkable(waypoint.x, waypoint.y)) {
        blockedCount++;
        blockedWaypoints.push(`(${waypoint.x.toFixed(1)},${waypoint.y.toFixed(1)})`);
      }
    }

    if (blockedCount > 0) {
      debugPathfinding.log(`[PathfindingSystem] PATH_BLOCKED: ${blockedCount}/${checkCount} waypoints blocked: ${blockedWaypoints.join(', ')}`);
    }

    return blockedCount > 0;
  }

  // Public API for other systems
  public requestPathForEntity(entityId: number, targetX: number, targetY: number): void {
    this.game.eventBus.emit('pathfinding:request', {
      entityId,
      targetX,
      targetY,
    });
  }

  public getPathfinder(): AStar {
    return this.pathfinder;
  }

  /**
   * Register decoration collisions (rocks, large obstacles) with pathfinding.
   * Large decorations are marked as completely unwalkable - units cannot path through rocks.
   */
  public registerDecorationCollisions(collisions: Array<{ x: number; z: number; radius: number }>): void {
    const DECORATION_BLOCKING_RADIUS = 1.0; // Only block decorations with radius >= this value

    let decorationsBlocked = 0;

    for (const deco of collisions) {
      // Only process larger decorations that would actually block units
      if (deco.radius < DECORATION_BLOCKING_RADIUS) continue;

      // Note: deco.z corresponds to world Y (map coordinate)
      const centerX = deco.x;
      const centerY = deco.z;
      const effectiveRadius = Math.ceil(deco.radius);

      // Mark cells covered by this decoration as completely unwalkable
      for (let dy = -effectiveRadius; dy <= effectiveRadius; dy++) {
        for (let dx = -effectiveRadius; dx <= effectiveRadius; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= deco.radius) {
            const cellX = Math.floor(centerX + dx);
            const cellY = Math.floor(centerY + dy);

            // Bounds check
            if (cellX < 0 || cellX >= this.mapWidth || cellY < 0 || cellY >= this.mapHeight) {
              continue;
            }

            // Don't modify already blocked cells (terrain)
            if (!this.pathfinder.isWalkable(cellX, cellY)) {
              continue;
            }

            // Mark as completely unwalkable - units cannot path through rocks
            this.pathfinder.setWalkable(cellX, cellY, false);
            this.hierarchicalPathfinder.setWalkable(cellX, cellY, false);
            decorationsBlocked++;
          }
        }
      }
    }

    if (decorationsBlocked > 0) {
      debugPathfinding.log(`[PathfindingSystem] Registered ${decorationsBlocked} cells with decoration obstacles`);
      // Rebuild hierarchical graph after adding decorations
      this.hierarchicalPathfinder.rebuildAbstractGraph();
    }
  }
}
