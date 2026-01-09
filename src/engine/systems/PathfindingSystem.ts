import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Game } from '../core/Game';
import { AStar, PathResult } from '../pathfinding/AStar';

// Configuration for path invalidation
const REPATH_INTERVAL_TICKS = 40; // Check for repath every 2 seconds at 20 TPS
const BLOCKED_CHECK_RADIUS = 3; // Check cells within this radius for blockage
const MAX_STUCK_TICKS = 20; // If unit hasn't moved for this many ticks, repath

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

export class PathfindingSystem extends System {
  public priority = 5; // Run before MovementSystem

  private pathfinder: AStar;
  private unitPathStates: Map<number, UnitPathState> = new Map();
  private pendingRequests: PathRequest[] = [];
  private blockedCells: Set<string> = new Set();

  // Track which cells changed this tick for efficient invalidation
  private cellsChangedThisTick: Set<string> = new Set();

  constructor(game: Game, mapWidth: number, mapHeight: number) {
    super(game);
    this.pathfinder = new AStar(mapWidth, mapHeight, 1);
    this.setupEventListeners();
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
        const key = `${x},${y}`;
        this.blockedCells.add(key);
        this.cellsChangedThisTick.add(key);
        this.pathfinder.setWalkable(x, y, false);
      }
    }
  }

  private unblockArea(centerX: number, centerY: number, width: number, height: number): void {
    const halfW = width / 2;
    const halfH = height / 2;

    for (let y = Math.floor(centerY - halfH); y <= Math.ceil(centerY + halfH); y++) {
      for (let x = Math.floor(centerX - halfW); x <= Math.ceil(centerX + halfW); x++) {
        const key = `${x},${y}`;
        this.blockedCells.delete(key);
        this.cellsChangedThisTick.add(key);
        this.pathfinder.setWalkable(x, y, true);
      }
    }
  }

  private requestPath(request: PathRequest): void {
    // Calculate path immediately for now (could be batched later)
    const result = this.pathfinder.findPath(
      request.startX,
      request.startY,
      request.endX,
      request.endY
    );

    if (result.found && result.path.length > 0) {
      const entity = this.world.getEntity(request.entityId);
      if (entity) {
        const unit = entity.get<Unit>('Unit');
        if (unit) {
          unit.setPath(result.path);

          // Track the destination for repath checks
          this.unitPathStates.set(request.entityId, {
            lastPosition: { x: request.startX, y: request.startY },
            lastMoveTick: this.game.getCurrentTick(),
            lastRepathTick: this.game.getCurrentTick(),
            destinationX: request.endX,
            destinationY: request.endY,
          });
        }
      }
    }
  }

  public findPath(startX: number, startY: number, endX: number, endY: number): PathResult {
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
      const key = `${Math.floor(waypoint.x)},${Math.floor(waypoint.y)}`;
      if (this.cellsChangedThisTick.has(key)) {
        return true;
      }
      // Also check adjacent cells for units with collision radius
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const adjKey = `${Math.floor(waypoint.x) + dx},${Math.floor(waypoint.y) + dy}`;
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
      if (unit.state !== 'moving' && unit.state !== 'attacking' && unit.state !== 'gathering') {
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

      // Check if unit has moved
      const dx = transform.x - state.lastPosition.x;
      const dy = transform.y - state.lastPosition.y;
      const distanceMoved = Math.sqrt(dx * dx + dy * dy);

      if (distanceMoved > 0.1) {
        // Unit is moving, update state
        state.lastPosition = { x: transform.x, y: transform.y };
        state.lastMoveTick = currentTick;
      } else {
        // Unit hasn't moved - check if stuck
        const ticksSinceMove = currentTick - state.lastMoveTick;

        if (ticksSinceMove > MAX_STUCK_TICKS && unit.path.length > 0) {
          // Unit is stuck, check if next waypoint is blocked
          if (unit.pathIndex < unit.path.length) {
            const nextWaypoint = unit.path[unit.pathIndex];
            if (!this.pathfinder.isWalkable(nextWaypoint.x, nextWaypoint.y)) {
              // Path is blocked, recalculate
              this.requestPath({
                entityId: entity.id,
                startX: transform.x,
                startY: transform.y,
                endX: state.destinationX,
                endY: state.destinationY,
                priority: 3, // Highest priority for stuck units
              });
              state.lastMoveTick = currentTick; // Reset stuck timer
            }
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
