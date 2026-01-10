import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Game } from '../core/Game';
import { AStar, PathResult } from '../pathfinding/AStar';
import { HierarchicalAStar } from '../pathfinding/HierarchicalAStar';
import { MapData, TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { debugPathfinding } from '@/utils/debugLogger';

// Configuration for path invalidation
const REPATH_INTERVAL_TICKS = 30; // Check for repath every 1.5 seconds at 20 TPS
const BLOCKED_CHECK_RADIUS = 3; // Check cells within this radius for blockage
const MAX_STUCK_TICKS = 6; // If unit hasn't moved for this many ticks, repath (faster recovery)
const MIN_MOVEMENT_THRESHOLD = 0.05; // Minimum distance to count as "moved"
const PATH_REQUEST_COOLDOWN = 10; // Minimum ticks between path requests to prevent spam

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

  constructor(game: Game, mapWidth: number, mapHeight: number) {
    super(game);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.pathfinder = new AStar(mapWidth, mapHeight, 1);
    this.hierarchicalPathfinder = new HierarchicalAStar(mapWidth, mapHeight, 1);
    this.setupEventListeners();
    // Note: loadTerrainData() is called by Game.setTerrainGrid() when map is loaded
  }

  /**
   * Load terrain walkability into the pathfinding grid.
   * Uses TERRAIN_FEATURE_CONFIG to properly determine walkability and movement costs.
   */
  public loadTerrainData(): void {
    const terrainGrid = this.game.getTerrainGrid();
    if (!terrainGrid) {
      debugPathfinding.warn('[PathfindingSystem] No terrain grid available');
      return;
    }

    let blockedCount = 0;
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

        // Apply walkability
        if (!isWalkable) {
          this.pathfinder.setWalkable(x, y, false);
          this.hierarchicalPathfinder.setWalkable(x, y, false);
          this.blockedCells.add(this.cellKey(x, y));
          blockedCount++;
        } else {
          // Apply movement cost (roads have cost < 1, forests/mud have cost > 1)
          this.pathfinder.setMoveCost(x, y, moveCost);
          this.hierarchicalPathfinder.setMoveCost(x, y, moveCost);
        }
      }
    }

    debugPathfinding.log(`[PathfindingSystem] Loaded terrain: ${blockedCount} cells blocked`);

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
    console.log('[PathfindingSystem] Initializing from terrain data...');
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

    // Handle move commands - calculate paths
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

      this.requestPath({
        entityId: data.entityId,
        startX: transform.x,
        startY: transform.y,
        endX: data.targetX,
        endY: data.targetY,
        priority: data.priority ?? 1,
      });
    });
  }

  private blockArea(centerX: number, centerY: number, width: number, height: number): void {
    const halfW = width / 2;
    const halfH = height / 2;

    for (let y = Math.floor(centerY - halfH); y <= Math.ceil(centerY + halfH); y++) {
      for (let x = Math.floor(centerX - halfW); x <= Math.ceil(centerX + halfW); x++) {
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

    for (let y = Math.floor(centerY - halfH); y <= Math.ceil(centerY + halfH); y++) {
      for (let x = Math.floor(centerX - halfW); x <= Math.ceil(centerX + halfW); x++) {
        const key = this.cellKey(x, y);
        this.blockedCells.delete(key);
        this.cellsChangedThisTick.add(key);
        this.pathfinder.setWalkable(x, y, true);
        this.hierarchicalPathfinder.setWalkable(x, y, true);
      }
    }
  }

  private requestPath(request: PathRequest): void {
    // Calculate path immediately for now (could be batched later)
    let result = this.pathfinder.findPath(
      request.startX,
      request.startY,
      request.endX,
      request.endY
    );

    const entity = this.world.getEntity(request.entityId);
    if (!entity) return;

    const unit = entity.get<Unit>('Unit');
    if (!unit) return;

    // If no path found, try to find path to nearest walkable cell from destination
    if (!result.found || result.path.length === 0) {
      debugPathfinding.log(`[PathfindingSystem] No path from (${request.startX.toFixed(1)}, ${request.startY.toFixed(1)}) to (${request.endX.toFixed(1)}, ${request.endY.toFixed(1)}), trying alternate destination`);

      // Try to find a nearby walkable destination
      const alternateEnd = this.findNearbyWalkableCell(request.endX, request.endY, 10);
      if (alternateEnd) {
        result = this.pathfinder.findPath(
          request.startX,
          request.startY,
          alternateEnd.x,
          alternateEnd.y
        );
      }

      // If still no path, check if the start position is the problem
      if (!result.found || result.path.length === 0) {
        // Try to find path from nearby walkable cell (unit might be stuck)
        const alternateStart = this.findNearbyWalkableCell(request.startX, request.startY, 5);
        if (alternateStart && alternateEnd) {
          result = this.pathfinder.findPath(
            alternateStart.x,
            alternateStart.y,
            alternateEnd.x,
            alternateEnd.y
          );
          // Prepend a waypoint to get to the alternate start
          if (result.found && result.path.length > 0) {
            result.path.unshift({ x: alternateStart.x, y: alternateStart.y });
          }
        }
      }
    }

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
      // Path completely failed - log for debugging
      debugPathfinding.warn(`[PathfindingSystem] Failed to find any path for entity ${request.entityId} from (${request.startX.toFixed(1)}, ${request.startY.toFixed(1)}) to (${request.endX.toFixed(1)}, ${request.endY.toFixed(1)})`);
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
    // Use hierarchical pathfinding for long distances
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > HIERARCHICAL_PATH_THRESHOLD) {
      return this.hierarchicalPathfinder.findPath(startX, startY, endX, endY);
    }

    return this.pathfinder.findPath(startX, startY, endX, endY);
  }

  public isWalkable(x: number, y: number): boolean {
    return this.pathfinder.isWalkable(x, y);
  }

  public update(_deltaTime: number): void {
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

    // Check moving units for stuck detection and periodic repath
    this.checkMovingUnits(currentTick);
  }

  private syncBlockedCellsWithBuildings(): void {
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;
      this.blockArea(transform.x, transform.y, building.width, building.height);
    }
    this.cellsChangedThisTick.clear(); // Don't trigger invalidation on initial sync
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
          this.requestPath({
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
            unit.path = [];
            unit.pathIndex = 0;

            this.requestPath({
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
          this.requestPath({
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

    for (let i = fromIndex; i < fromIndex + checkCount; i++) {
      if (i >= path.length) break;
      const waypoint = path[i];
      if (!this.pathfinder.isWalkable(waypoint.x, waypoint.y)) {
        blockedCount++;
      }
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
}
