/**
 * MovementOrchestrator - Coordinates all movement subsystems
 *
 * Main coordinator for RTS unit movement. Brings together:
 * - FlockingBehavior: Boids-style steering (separation, cohesion, alignment)
 * - PathfindingMovement: A-star/navmesh pathfinding and crowd simulation
 * - FormationMovement: Magic box detection and group formations
 *
 * Also handles:
 * - Spatial grid updates for neighbor queries
 * - WASM SIMD boids acceleration
 * - Attack-move and patrol commands
 * - Idle unit repulsion
 * - Entity caching for performance
 */

import { Entity, getEntityIndex } from '../../ecs/Entity';
import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Velocity } from '../../components/Velocity';
import { Selectable } from '../../components/Selectable';
import type { IGameInstance } from '../../core/IGameInstance';
import { World } from '../../ecs/World';
import { PooledVector2 } from '@/utils/VectorPool';
import { RecastNavigation, getRecastNavigation } from '../../pathfinding/RecastNavigation';
import { debugPerformance, debugPathfinding, debugResources } from '@/utils/debugLogger';
import {
  snapValue,
  QUANT_POSITION,
  deterministicMagnitude,
  deterministicNormalizeWithMagnitude,
} from '@/utils/FixedPoint';
import { WasmBoids, getWasmBoids } from '../../wasm/WasmBoids';
import { CROWD_MAX_AGENTS } from '@/data/pathfinding.config';
import { stateToEnum } from '../../core/SpatialGrid';
import { collisionConfig } from '@/data/collisionConfig';
import AssetManager from '@/assets/AssetManager';
import {
  USE_RECAST_CROWD,
  TRULY_IDLE_THRESHOLD_TICKS,
  TRULY_IDLE_PROCESS_INTERVAL,
  UNIT_TURN_RATE,
  ATTACK_STANDOFF_MULTIPLIER,
} from '@/data/movement.config';

/**
 * Velocity deadzone - velocities below this magnitude are zeroed.
 * Prevents residual forces (separation nudges, smoothing artifacts) from
 * producing micro-movements that trigger walk animation on stationary units.
 */
const VELOCITY_DEADZONE = 0.05;
import { validateEntityAlive } from '@/utils/EntityValidator';

import { FlockingBehavior, FlockingEntityCache, FlockingSpatialGrid } from './FlockingBehavior';
import { PathfindingMovement, PathfindingWorld, PathfindingGame } from './PathfindingMovement';
import { FormationMovement, PathRequestCallback } from './FormationMovement';

// Static temp vectors for steering behaviors
const tempSeparation: PooledVector2 = { x: 0, y: 0 };
const tempCohesion: PooledVector2 = { x: 0, y: 0 };
const tempAlignment: PooledVector2 = { x: 0, y: 0 };
const tempBuildingAvoid: PooledVector2 = { x: 0, y: 0 };
const tempPhysicsPush: PooledVector2 = { x: 0, y: 0 };
const tempStuckNudge: PooledVector2 = { x: 0, y: 0 };

/**
 * MovementOrchestrator - Main coordinator for all movement systems
 */
export class MovementOrchestrator {
  // Sub-modules
  private flocking: FlockingBehavior;
  private pathfinding: PathfindingMovement;
  private formation: FormationMovement;

  // Core references
  private game: IGameInstance;
  private world: World;
  private recast: RecastNavigation;

  // Movement parameters
  private arrivalThreshold = 0.8;
  private decelerationThreshold = 2.0;

  // WASM SIMD boids acceleration
  private wasmBoids: WasmBoids | null = null;
  private useWasmBoids: boolean = false;
  private wasmBoidsInitializing: boolean = false;
  private static readonly WASM_UNIT_THRESHOLD = 20;

  // PERF: Truly idle tracking - units that have been stationary for many ticks
  // These units get processed at much lower frequency
  private trulyIdleTicks: Map<number, number> = new Map();
  private lastIdlePosition: Map<number, { x: number; y: number }> = new Map();

  // PERF: Naval unit boundary enforcement - store last valid water position
  // When a naval unit goes on land, immediately snap back to this position
  private lastValidNavalWaterPosition: Map<number, { x: number; y: number }> = new Map();

  // PERF: Dirty flag for separation - only recalculate when neighbors changed
  private unitMovedThisTick: Set<number> = new Set();

  // PERF: Player ID to numeric index mapping for SpatialGrid
  private playerIdToIndex: Map<string, number> = new Map();
  private nextPlayerIndex: number = 1;

  // PERF: Track entities that need grid updates (dirty flag optimization)
  private gridDirtyEntities: Set<number> = new Set();
  private lastGridPositions: Float32Array;
  private readonly GRID_UPDATE_THRESHOLD_SQ = 0.25;

  // PERF: Cached entity data to avoid repeated lookups in single frame
  private frameEntityCache: Map<number, { transform: Transform; unit: Unit; velocity: Velocity }> =
    new Map();

  // Current tick for caching
  private currentTick: number = 0;

  constructor(game: IGameInstance, world: World) {
    this.game = game;
    this.world = world;
    this.recast = getRecastNavigation();

    // Initialize sub-modules
    this.flocking = new FlockingBehavior();
    this.pathfinding = new PathfindingMovement(
      this.recast,
      game as PathfindingGame,
      world as unknown as PathfindingWorld
    );

    // Create path request callback that forwards to pathfinding module
    const pathRequestCallback: PathRequestCallback = (entityId, targetX, targetY, force) => {
      return this.pathfinding.requestPathWithCooldown(entityId, targetX, targetY, force);
    };

    this.formation = new FormationMovement(world, game.eventBus, pathRequestCallback, game);

    // Initialize typed arrays for grid position tracking
    const maxEntities = 4096;
    this.lastGridPositions = new Float32Array(maxEntities * 2);

    // Initialize WASM boids
    this.initWasmBoids();
  }

  /**
   * Set world reference (needed after world re-initialization)
   */
  public setWorld(world: World): void {
    this.world = world;
    this.pathfinding.setWorld(world as unknown as PathfindingWorld);
    this.formation.setWorld(world);
  }

  /**
   * Fast O(1) check if a position is on navigable water terrain for naval units.
   * Uses terrain grid lookup instead of expensive navmesh queries.
   *
   * Only water_deep is valid for naval units. water_shallow represents beaches
   * and shallow water where ground units can wade, but boats cannot navigate.
   */
  private isNavalWaterTerrain(x: number, y: number): boolean {
    const cell = this.game.getTerrainAt(x, y);
    if (!cell) return false;
    const feature = cell.feature || 'none';
    // Only deep water is valid for naval units - shallow water is for wading ground units
    return feature === 'water_deep';
  }

  /**
   * Setup event listeners for movement commands
   */
  public setupEventListeners(): void {
    this.game.eventBus.on('command:move', this.formation.handleMoveCommand.bind(this.formation));
    this.game.eventBus.on('command:attackMove', this.handleAttackMoveCommand.bind(this));
    this.game.eventBus.on('command:patrol', this.handlePatrolCommand.bind(this));
    this.game.eventBus.on(
      'command:formation',
      this.formation.handleFormationCommand.bind(this.formation)
    );

    // Clean up tracking data when units die to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.cleanupUnitTracking(data.entityId);
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.cleanupUnitTracking(data.entityId);
    });
  }

  /**
   * Clean up all tracking data for a unit
   */
  public cleanupUnitTracking(entityId: number): void {
    this.flocking.cleanupUnit(entityId);
    this.pathfinding.cleanupUnit(entityId);
    this.trulyIdleTicks.delete(entityId);
    this.lastIdlePosition.delete(entityId);
    this.unitMovedThisTick.delete(entityId);
    this.frameEntityCache.delete(entityId);
  }

  /**
   * Get numeric player index for SpatialGrid storage
   */
  private getPlayerIndex(playerId: string): number {
    let index = this.playerIdToIndex.get(playerId);
    if (index === undefined) {
      index = this.nextPlayerIndex++;
      this.playerIdToIndex.set(playerId, index);
    }
    return index;
  }

  /**
   * Initialize WASM SIMD boids module asynchronously
   */
  private async initWasmBoids(): Promise<void> {
    if (this.wasmBoidsInitializing) return;
    this.wasmBoidsInitializing = true;

    try {
      this.wasmBoids = await getWasmBoids(CROWD_MAX_AGENTS);
      this.useWasmBoids = this.wasmBoids.isAvailable();

      if (this.useWasmBoids) {
        // Configure WASM with game parameters from collision config
        this.wasmBoids.setSeparationParams(
          collisionConfig.separationMultiplier,
          collisionConfig.separationStrengthIdle,
          collisionConfig.separationMaxForce
        );
        this.wasmBoids.setCohesionParams(
          8.0, // COHESION_RADIUS
          0.1 // COHESION_STRENGTH
        );
        this.wasmBoids.setAlignmentParams(
          4.0, // ALIGNMENT_RADIUS
          0.3 // ALIGNMENT_STRENGTH
        );

        debugPathfinding.log('[MovementOrchestrator] WASM SIMD boids enabled');
      } else {
        debugPathfinding.log('[MovementOrchestrator] WASM SIMD unavailable, using JS fallback');
      }
    } catch (error) {
      debugPathfinding.warn('[MovementOrchestrator] WASM boids init failed:', error);
      this.useWasmBoids = false;
    }

    this.wasmBoidsInitializing = false;
  }

  // ==================== COMMAND HANDLERS ====================

  /**
   * Validate and adjust target position for unit's movement domain.
   * Returns adjusted target or null if no valid position exists.
   * PERF: Uses O(1) terrain lookup for naval units instead of expensive navmesh queries.
   */
  private validateTargetForDomain(
    targetX: number,
    targetY: number,
    domain: import('../../pathfinding/RecastNavigation').MovementDomain
  ): { x: number; y: number } | null {
    // Air units can go anywhere
    if (domain === 'air') {
      return { x: targetX, y: targetY };
    }

    // Naval units: use fast O(1) terrain lookup
    if (domain === 'water') {
      const isWater = this.isNavalWaterTerrain(targetX, targetY);
      if (isWater) {
        return { x: targetX, y: targetY };
      }
      // Find nearest water point (only when needed)
      return this.recast.findNearestPointForDomain(targetX, targetY, 'water');
    }

    // Ground/amphibious units: use navmesh validation (command-time only, not per-frame)
    const isValid = this.recast.isWalkableForDomain(targetX, targetY, domain);
    if (isValid) {
      return { x: targetX, y: targetY };
    }

    return this.recast.findNearestPointForDomain(targetX, targetY, domain);
  }

  /**
   * Handle attack-move command
   */
  private handleAttackMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, targetPosition, queue } = data;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!validateEntityAlive(entity, entityId, 'MovementOrchestrator:handleAttackMoveCommand'))
        continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      // Validate target for unit's movement domain (prevents boats on land, etc.)
      const validatedTarget = this.validateTargetForDomain(
        targetPosition.x,
        targetPosition.y,
        unit.movementDomain
      );
      if (!validatedTarget) continue;

      if (queue) {
        unit.queueCommand({
          type: 'attackmove',
          targetX: validatedTarget.x,
          targetY: validatedTarget.y,
        });
      } else {
        unit.setAttackMoveTarget(validatedTarget.x, validatedTarget.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.pathfinding.requestPathWithCooldown(
          entityId,
          validatedTarget.x,
          validatedTarget.y,
          true
        );
      }
    }
  }

  /**
   * Handle patrol command
   */
  private handlePatrolCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, targetPosition, queue } = data;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!validateEntityAlive(entity, entityId, 'MovementOrchestrator:handlePatrolCommand'))
        continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      // Validate target for unit's movement domain (prevents boats on land, etc.)
      const validatedTarget = this.validateTargetForDomain(
        targetPosition.x,
        targetPosition.y,
        unit.movementDomain
      );
      if (!validatedTarget) continue;

      if (queue) {
        unit.queueCommand({
          type: 'patrol',
          targetX: validatedTarget.x,
          targetY: validatedTarget.y,
        });
      } else {
        unit.setPatrol(transform.x, transform.y, validatedTarget.x, validatedTarget.y);
        this.pathfinding.requestPathWithCooldown(
          entityId,
          validatedTarget.x,
          validatedTarget.y,
          true
        );
        // Set initial rotation to face target direction
        transform.rotation = Math.atan2(
          -(validatedTarget.y - transform.y),
          validatedTarget.x - transform.x
        );
      }
    }
  }

  // ==================== MAIN UPDATE ====================

  /**
   * Main update loop - coordinates all movement subsystems
   */
  public update(deltaTime: number, entities: Entity[]): void {
    const updateStart = performance.now();
    const dt = deltaTime / 1000;

    // Track current tick for caching
    this.currentTick = this.game.getCurrentTick();
    this.flocking.setCurrentTick(this.currentTick);

    // Invalidate caches at start of frame
    this.pathfinding.invalidateBuildingCache();
    this.unitMovedThisTick.clear();
    this.frameEntityCache.clear();
    this.gridDirtyEntities.clear();

    // PERF OPTIMIZATION: Merged single pass for spatial grid update and entity caching
    this.updateSpatialGrid(entities);

    // CROWD FIX: Prepare and update crowd simulation
    if (USE_RECAST_CROWD) {
      this.pathfinding.prepareCrowdAgents(entities, dt);
      this.pathfinding.updateCrowd(dt);
    }

    // WASM SIMD boids: batch process when we have enough units
    const useWasmThisFrame =
      this.useWasmBoids &&
      this.wasmBoids !== null &&
      entities.length >= MovementOrchestrator.WASM_UNIT_THRESHOLD;

    if (useWasmThisFrame) {
      this.wasmBoids!.syncEntities(entities, this.world.unitGrid);
      this.wasmBoids!.computeForces();
    }

    // Process each entity
    for (const entity of entities) {
      this.processEntity(entity, dt, useWasmThisFrame);
    }

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) {
      debugPerformance.warn(
        `[MovementOrchestrator] UPDATE: ${entities.length} entities took ${updateElapsed.toFixed(1)}ms`
      );
    }
  }

  /**
   * Update spatial grid with entity positions
   */
  private updateSpatialGrid(entities: Entity[]): void {
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const velocity = entity.get<Velocity>('Velocity');
      if (!transform || !unit || !velocity) continue;

      // Cache entity data for this frame
      this.frameEntityCache.set(entity.id, { transform, unit, velocity });

      if (unit.state === 'dead') {
        this.world.unitGrid.remove(entity.id);
        continue;
      }

      // DIRTY FLAG: Check if position changed significantly
      const posIdx = getEntityIndex(entity.id) * 2;
      const lastX = this.lastGridPositions[posIdx];
      const lastY = this.lastGridPositions[posIdx + 1];
      const dx = transform.x - lastX;
      const dy = transform.y - lastY;
      const distSq = dx * dx + dy * dy;

      const needsGridUpdate = distSq > this.GRID_UPDATE_THRESHOLD_SQ || lastX === 0;

      if (needsGridUpdate) {
        const selectable = entity.get<Selectable>('Selectable');
        const playerId = selectable ? this.getPlayerIndex(selectable.playerId) : 0;

        // Unit has active attack command if it's attack-moving or in assault mode
        // These units should not yield to physics push and should always seek targets
        const hasActiveAttackCommand =
          unit.isInAssaultMode ||
          unit.state === 'attackmoving' ||
          (unit.state === 'attacking' && unit.targetEntityId !== null);

        this.world.unitGrid.updateFull(
          entity.id,
          transform.x,
          transform.y,
          unit.collisionRadius,
          unit.isFlying,
          stateToEnum(unit.state),
          playerId,
          unit.collisionRadius,
          unit.isWorker,
          unit.maxSpeed,
          hasActiveAttackCommand
        );

        this.lastGridPositions[posIdx] = transform.x;
        this.lastGridPositions[posIdx + 1] = transform.y;
        this.gridDirtyEntities.add(entity.id);
      } else {
        this.world.unitGrid.updateState(entity.id, stateToEnum(unit.state));
      }
    }
  }

  /**
   * Process a single entity's movement
   */
  private processEntity(entity: Entity, dt: number, useWasmThisFrame: boolean): void {
    const cached = this.frameEntityCache.get(entity.id);
    if (!cached) return;

    const { transform, unit, velocity } = cached;

    // Store previous rotation for render interpolation
    transform.prevRotation = transform.rotation;

    // Handle dead units
    if (unit.state === 'dead') {
      velocity.zero();
      this.world.unitGrid.remove(entity.id);
      this.pathfinding.removeAgentIfRegistered(entity.id);
      return;
    }

    const canMove =
      unit.state === 'moving' ||
      unit.state === 'attackmoving' ||
      unit.state === 'attacking' ||
      unit.state === 'gathering' ||
      unit.state === 'patrolling' ||
      unit.state === 'building';

    if (!canMove) {
      this.processIdleUnit(entity.id, transform, unit, velocity, dt);
      return;
    }

    // Ensure agent is in crowd
    if (USE_RECAST_CROWD && !unit.isFlying) {
      this.pathfinding.ensureAgentRegistered(entity.id, transform, unit);
    }

    // Debug gathering workers
    if (unit.state === 'gathering' && this.currentTick % 100 === 0 && entity.id % 5 === 0) {
      const selectable = entity.get<Selectable>('Selectable');
      debugResources.log(
        `[MovementOrchestrator] ${selectable?.playerId} gathering worker ${entity.id}: targetX=${unit.targetX?.toFixed(1)}, targetY=${unit.targetY?.toFixed(1)}, pos=(${transform.x.toFixed(1)}, ${transform.y.toFixed(1)}), speed=${unit.currentSpeed.toFixed(2)}, maxSpeed=${unit.maxSpeed}`
      );
    }

    // Get current target
    let targetX: number | null = null;
    let targetY: number | null = null;

    if (unit.path.length > 0 && unit.pathIndex < unit.path.length) {
      const waypoint = unit.path[unit.pathIndex];
      targetX = waypoint.x;
      targetY = waypoint.y;

      // PERF: Only validate waypoints for naval units using O(1) terrain lookup
      // Ground/air units rely on navmesh pathfinding which already validates terrain
      if (unit.movementDomain === 'water' && !unit.isFlying) {
        const isWaterWaypoint = this.isNavalWaterTerrain(targetX, targetY);
        if (!isWaterWaypoint) {
          // Skip invalid waypoints - naval unit shouldn't walk on land
          unit.pathIndex++;
          if (unit.pathIndex >= unit.path.length) {
            // All waypoints exhausted - clear path, boundary enforcement will handle correction
            unit.path = [];
            unit.pathIndex = 0;
          }
          return; // Re-process on next frame with next waypoint
        }
      }
    } else if (unit.targetX !== null && unit.targetY !== null) {
      // PERF: Only validate direct targets for naval units using O(1) terrain lookup
      if (unit.movementDomain === 'water' && !unit.isFlying) {
        const isWaterTarget = this.isNavalWaterTerrain(unit.targetX, unit.targetY);
        if (!isWaterTarget) {
          // Invalid target for naval unit - find nearest water point
          const nearestWater = this.recast.findNearestPointForDomain(
            unit.targetX,
            unit.targetY,
            'water'
          );
          if (nearestWater) {
            unit.targetX = nearestWater.x;
            unit.targetY = nearestWater.y;
          } else {
            // No water found - clear target and stop
            unit.clearTarget();
            velocity.zero();
            return;
          }
        }
      }

      targetX = unit.targetX;
      targetY = unit.targetY;

      if (!unit.isFlying) {
        const directDx = unit.targetX - transform.x;
        const directDy = unit.targetY - transform.y;
        const directDistanceSq = directDx * directDx + directDy * directDy;

        const needsPath =
          unit.state === 'moving' || unit.state === 'attackmoving' ||
          unit.state === 'gathering' || unit.state === 'building';
        if (directDistanceSq > 9 && needsPath) {
          this.pathfinding.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY);
        }
      }
    }

    // Handle attacking state
    if (unit.state === 'attacking' && unit.targetEntityId !== null) {
      const result = this.processAttackingUnit(
        entity.id,
        transform,
        unit,
        velocity,
        dt,
        useWasmThisFrame
      );
      if (result.handled) {
        targetX = result.targetX;
        targetY = result.targetY;
        if (result.skipMovement) return;
      } else {
        if (!unit.executeNextCommand()) {
          unit.clearTarget();
        }
        velocity.zero();
        return;
      }
    }

    if (targetX === null || targetY === null) {
      if (unit.executeNextCommand()) {
        if (unit.targetX !== null && unit.targetY !== null) {
          unit.path = [];
          unit.pathIndex = 0;
          this.pathfinding.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY, true);
        }
      } else {
        unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.deceleration * dt);
      }
      velocity.zero();
      return;
    }

    const dx = targetX - transform.x;
    const dy = targetY - transform.y;
    const distance = deterministicMagnitude(dx, dy);

    // Check arrival
    if (distance < this.arrivalThreshold) {
      if (this.handleArrival(entity.id, transform, unit, velocity, dt)) {
        return;
      }
    }

    // Calculate and apply velocity
    this.calculateAndApplyVelocity(
      entity.id,
      transform,
      unit,
      velocity,
      dt,
      targetX,
      targetY,
      dx,
      dy,
      distance,
      useWasmThisFrame
    );
  }

  /**
   * Process an idle/non-moving unit
   */
  private processIdleUnit(
    entityId: number,
    transform: Transform,
    unit: Unit,
    velocity: Velocity,
    dt: number
  ): void {
    if (unit.currentSpeed > 0) {
      unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.deceleration * dt);
    }
    this.pathfinding.removeAgentIfRegistered(entityId);

    // IDLE REPULSION: Apply separation forces to idle units
    // Skip units near friendly combat or in assault mode - they should hold position
    // and fight, not drift away from the engagement due to separation forces
    if (unit.state === 'idle' && !unit.isFlying && !unit.isNearFriendlyCombat && !unit.isInAssaultMode) {
      const lastPos = this.lastIdlePosition.get(entityId);
      const currentIdleTicks = this.trulyIdleTicks.get(entityId) || 0;

      if (lastPos) {
        const movedDist = Math.abs(transform.x - lastPos.x) + Math.abs(transform.y - lastPos.y);
        if (movedDist < 0.01) {
          this.trulyIdleTicks.set(entityId, currentIdleTicks + 1);
        } else {
          this.trulyIdleTicks.set(entityId, 0);
          this.unitMovedThisTick.add(entityId);
        }
      }
      this.lastIdlePosition.set(entityId, { x: transform.x, y: transform.y });

      // PERF: Skip truly idle units except at reduced frequency
      const isTrulyIdle = currentIdleTicks >= TRULY_IDLE_THRESHOLD_TICKS;
      if (isTrulyIdle && this.currentTick % TRULY_IDLE_PROCESS_INTERVAL !== 0) {
        velocity.zero();
        return;
      }

      this.flocking.calculateSeparationForce(
        entityId,
        transform,
        unit,
        tempSeparation,
        Infinity,
        this.world.unitGrid as unknown as FlockingSpatialGrid
      );
      const sepMagSq = tempSeparation.x * tempSeparation.x + tempSeparation.y * tempSeparation.y;

      if (sepMagSq > collisionConfig.idleSeparationThreshold) {
        const {
          nx: sepNx,
          ny: sepNy,
          magnitude: sepMag,
        } = deterministicNormalizeWithMagnitude(tempSeparation.x, tempSeparation.y);
        const idleRepelSpeed = Math.min(
          unit.maxSpeed * collisionConfig.idleRepelSpeedMultiplier,
          sepMag * collisionConfig.separationStrengthIdle * 0.5
        );
        velocity.x = sepNx * idleRepelSpeed;
        velocity.y = sepNy * idleRepelSpeed;

        // Update rotation
        const targetRotation = Math.atan2(-velocity.y, velocity.x);
        const rotationDiff = targetRotation - transform.rotation;
        let normalizedDiff = rotationDiff;
        while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
        while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;
        const turnRate = UNIT_TURN_RATE * dt;
        if (Math.abs(normalizedDiff) < turnRate) {
          transform.rotation = targetRotation;
        } else {
          transform.rotation += Math.sign(normalizedDiff) * turnRate;
        }

        // For naval units, save position before movement for potential revert
        const isNaval = unit.movementDomain === 'water' && !unit.isFlying;
        const preMovePosX = transform.x;
        const preMovePosY = transform.y;

        // Apply movement
        transform.translate(velocity.x * dt, velocity.y * dt);
        transform.x = snapValue(transform.x, QUANT_POSITION);
        transform.y = snapValue(transform.y, QUANT_POSITION);
        this.pathfinding.clampToMapBounds(transform);

        this.unitMovedThisTick.add(entityId);
        this.trulyIdleTicks.set(entityId, 0);
        this.pathfinding.resolveHardBuildingCollision(entityId, transform, unit);

        // CRITICAL: Naval boundary check must be LAST
        if (isNaval) {
          const isOnWater = this.isNavalWaterTerrain(transform.x, transform.y);
          if (isOnWater) {
            this.lastValidNavalWaterPosition.set(entityId, { x: transform.x, y: transform.y });
          } else {
            // Revert to pre-move position
            transform.x = preMovePosX;
            transform.y = preMovePosY;
          }
        }

        // Zero velocity after position update - idle separation is a position
        // adjustment, not intentional movement. Keeps idle animation playing.
        velocity.zero();
        return;
      }
    }

    velocity.zero();
  }

  /**
   * Process unit in attacking state
   */
  private processAttackingUnit(
    entityId: number,
    transform: Transform,
    unit: Unit,
    velocity: Velocity,
    dt: number,
    _useWasmThisFrame: boolean
  ): { handled: boolean; skipMovement: boolean; targetX: number | null; targetY: number | null } {
    const targetEntity = this.world.getEntity(unit.targetEntityId!);
    // Validate target exists and is not destroyed
    if (
      !validateEntityAlive(
        targetEntity,
        unit.targetEntityId!,
        'MovementOrchestrator:processAttackingUnit'
      )
    ) {
      return { handled: false, skipMovement: false, targetX: null, targetY: null };
    }

    const targetTransform = targetEntity.get<Transform>('Transform');
    const targetBuilding =
      targetEntity.get<import('../../components/Building').Building>('Building');
    const targetUnit = targetEntity.get<Unit>('Unit');
    if (!targetTransform) {
      return { handled: false, skipMovement: false, targetX: null, targetY: null };
    }

    let effectiveDistance: number;
    let attackTargetX = targetTransform.x;
    let attackTargetY = targetTransform.y;
    let needsToEscape = false;

    const attackerRadius = AssetManager.getCachedVisualRadius(unit.unitId, unit.collisionRadius);

    if (targetBuilding) {
      const halfW = targetBuilding.width / 2;
      const halfH = targetBuilding.height / 2;
      const clampedX = Math.max(
        targetTransform.x - halfW,
        Math.min(transform.x, targetTransform.x + halfW)
      );
      const clampedY = Math.max(
        targetTransform.y - halfH,
        Math.min(transform.y, targetTransform.y + halfH)
      );
      const edgeDx = transform.x - clampedX;
      const edgeDy = transform.y - clampedY;
      const edgeDist = deterministicMagnitude(edgeDx, edgeDy);
      effectiveDistance = Math.max(0, edgeDist - attackerRadius);

      const standOffDistance = unit.attackRange * ATTACK_STANDOFF_MULTIPLIER;
      const minSafeDistance = attackerRadius + 0.5;

      if (effectiveDistance > minSafeDistance && edgeDist > 0.01) {
        const dirX = edgeDx / edgeDist;
        const dirY = edgeDy / edgeDist;
        attackTargetX = clampedX + dirX * standOffDistance;
        attackTargetY = clampedY + dirY * standOffDistance;
      } else {
        needsToEscape = true;
        const awayDx = transform.x - targetTransform.x;
        const awayDy = transform.y - targetTransform.y;
        const {
          nx: awayNx,
          ny: awayNy,
          magnitude: awayDist,
        } = deterministicNormalizeWithMagnitude(awayDx, awayDy);
        if (awayDist > 0.1) {
          const escapeDistance = Math.max(halfW, halfH) + standOffDistance + 0.5;
          attackTargetX = targetTransform.x + awayNx * escapeDistance;
          attackTargetY = targetTransform.y + awayNy * escapeDistance;
        } else {
          attackTargetX = targetTransform.x + halfW + standOffDistance + 0.5;
          attackTargetY = targetTransform.y;
        }
      }
    } else {
      const centerDistance = transform.distanceTo(targetTransform);
      const targetRadius = targetUnit
        ? AssetManager.getCachedVisualRadius(targetUnit.unitId, targetUnit.collisionRadius)
        : 0.5;
      effectiveDistance = Math.max(0, centerDistance - attackerRadius - targetRadius);
    }

    if (effectiveDistance > unit.attackRange || needsToEscape) {
      if (!unit.isFlying) {
        this.pathfinding.requestPathWithCooldown(entityId, attackTargetX, attackTargetY);
      }
      return { handled: true, skipMovement: false, targetX: attackTargetX, targetY: attackTargetY };
    } else {
      // In range - apply separation while attacking
      transform.rotation = Math.atan2(
        -(targetTransform.y - transform.y),
        targetTransform.x - transform.x
      );

      this.flocking.calculateSeparationForce(
        entityId,
        transform,
        unit,
        tempSeparation,
        0,
        this.world.unitGrid as unknown as FlockingSpatialGrid
      );

      const combatMoveSpeed = unit.maxSpeed * collisionConfig.combatSpreadSpeedMultiplier;
      const {
        nx: sepNx,
        ny: sepNy,
        magnitude: sepMag,
      } = deterministicNormalizeWithMagnitude(tempSeparation.x, tempSeparation.y);

      if (sepMag > collisionConfig.combatSeparationThreshold) {
        // Use velocity temporarily for position delta
        const spreadVx = sepNx * combatMoveSpeed;
        const spreadVy = sepNy * combatMoveSpeed;

        // For naval units, save position before movement for potential revert
        const isNaval = unit.movementDomain === 'water' && !unit.isFlying;
        const preMovePosX = transform.x;
        const preMovePosY = transform.y;

        transform.translate(spreadVx * dt, spreadVy * dt);
        transform.x = snapValue(transform.x, QUANT_POSITION);
        transform.y = snapValue(transform.y, QUANT_POSITION);
        this.pathfinding.clampToMapBounds(transform);

        if (!unit.isFlying) {
          this.pathfinding.resolveHardBuildingCollision(entityId, transform, unit);
        }

        // CRITICAL: Naval boundary check must be LAST
        if (isNaval) {
          const isOnWater = this.isNavalWaterTerrain(transform.x, transform.y);
          if (isOnWater) {
            this.lastValidNavalWaterPosition.set(entityId, { x: transform.x, y: transform.y });
          } else {
            // Revert to pre-move position
            transform.x = preMovePosX;
            transform.y = preMovePosY;
          }
        }
      }

      // Zero velocity - combat separation is a position adjustment,
      // not intentional movement. Keeps attack animation playing.
      velocity.zero();

      unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.deceleration * dt);
      return { handled: true, skipMovement: true, targetX: null, targetY: null };
    }
  }

  /**
   * Handle unit arrival at destination
   *
   * RTS-STYLE: Attack-move units that arrive at their destination don't go fully idle.
   * Instead they stay in "assault mode" - idle but aggressively scanning for enemies.
   * This prevents units from standing around in enemy bases doing nothing.
   */
  private handleArrival(
    entityId: number,
    transform: Transform,
    unit: Unit,
    velocity: Velocity,
    _dt: number
  ): boolean {
    if (unit.path.length > 0 && unit.pathIndex < unit.path.length - 1) {
      unit.pathIndex++;
      return false;
    } else if (unit.state === 'patrolling') {
      unit.nextPatrolPoint();
      unit.path = [];
      unit.pathIndex = 0;
      if (unit.targetX !== null && unit.targetY !== null) {
        this.pathfinding.requestPathWithCooldown(entityId, unit.targetX, unit.targetY, true);
      }
      return false;
    } else if (unit.state === 'attackmoving') {
      // RTS-STYLE: Attack-move arrived at destination
      // Don't go fully idle - stay in assault mode, keep scanning for enemies
      unit.targetX = null;
      unit.targetY = null;
      unit.path = [];
      unit.pathIndex = 0;
      unit.state = 'idle';
      // Assault mode is preserved! Unit will keep scanning for targets in CombatSystem
      // The isInAssaultMode flag was set when setAttackMoveTarget() was called
      velocity.zero();
      transform.syncPrevious();
      return true;
    } else {
      if (unit.state === 'gathering') {
        const isCarryingResources = unit.carryingMinerals > 0 || unit.carryingPlasma > 0;
        if (!isCarryingResources) {
          unit.targetX = null;
          unit.targetY = null;
          velocity.zero();
          transform.syncPrevious();
          return true;
        }
        velocity.zero();
        transform.syncPrevious();
        return true;
      }

      if (unit.state === 'building') {
        unit.targetX = null;
        unit.targetY = null;
        unit.currentSpeed = 0;
        velocity.zero();
        transform.syncPrevious();
        return true;
      }

      if (unit.executeNextCommand()) {
        if (unit.targetX !== null && unit.targetY !== null) {
          unit.path = [];
          unit.pathIndex = 0;
          this.pathfinding.requestPathWithCooldown(entityId, unit.targetX, unit.targetY, true);
        }
      } else {
        unit.clearTarget();
      }
      velocity.zero();
      transform.syncPrevious();
      return true;
    }
  }

  /**
   * Calculate and apply velocity for a moving unit
   */
  private calculateAndApplyVelocity(
    entityId: number,
    transform: Transform,
    unit: Unit,
    velocity: Velocity,
    dt: number,
    targetX: number,
    targetY: number,
    dx: number,
    dy: number,
    distance: number,
    useWasmThisFrame: boolean
  ): void {
    // Calculate speed
    let targetSpeed = unit.maxSpeed;
    const terrainSpeedMod = this.pathfinding.getTerrainSpeedModifier(
      transform.x,
      transform.y,
      unit.isFlying
    );
    targetSpeed *= terrainSpeedMod;

    if (distance < this.decelerationThreshold) {
      targetSpeed = targetSpeed * (distance / this.decelerationThreshold);
      targetSpeed = Math.max(targetSpeed, unit.maxSpeed * terrainSpeedMod * 0.3);
    }

    // Acceleration
    if (unit.currentSpeed < targetSpeed) {
      unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + unit.acceleration * dt);
    } else if (unit.currentSpeed > targetSpeed) {
      unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - unit.deceleration * dt);
    }

    // Calculate velocity
    let finalVx = 0;
    let finalVy = 0;
    let crowdHeight: number | null = null; // Track navmesh height for terrain following

    const entityCache: FlockingEntityCache = {
      get: (id: number) => this.frameEntityCache.get(id),
    };
    const unitGrid = this.world.unitGrid as unknown as FlockingSpatialGrid;

    if (USE_RECAST_CROWD && this.pathfinding.isAgentRegistered(entityId) && !unit.isFlying) {
      const state = this.pathfinding.getAgentState(entityId);
      if (state) {
        finalVx = state.vx;
        finalVy = state.vy;
        crowdHeight = state.height; // Store height for terrain following

        // Fallback if crowd returns zero velocity
        const velMagSq = finalVx * finalVx + finalVy * finalVy;
        if (velMagSq < 0.0001 && distance > this.arrivalThreshold) {
          if (distance > 2 && unit.path.length > 0) {
            debugPathfinding.warn(
              `[MovementOrchestrator] Crowd returned zero velocity for entity ${entityId}. ` +
                `Pos: (${transform.x.toFixed(1)}, ${transform.y.toFixed(1)}), ` +
                `Target: (${targetX.toFixed(1)}, ${targetY.toFixed(1)}), Distance: ${distance.toFixed(1)}`
            );
          }
          if (distance > 0.01) {
            // Calculate initial direction toward target
            let fallbackVx = (dx / distance) * unit.maxSpeed;
            let fallbackVy = (dy / distance) * unit.maxSpeed;

            // Apply building avoidance to prevent going through buildings
            // This is critical when NavMesh crowd fails - we must still respect obstacles
            this.pathfinding.calculateBuildingAvoidanceForce(
              entityId,
              transform,
              unit,
              tempBuildingAvoid,
              fallbackVx,
              fallbackVy
            );
            fallbackVx += tempBuildingAvoid.x;
            fallbackVy += tempBuildingAvoid.y;

            // Reduce speed when building avoidance is active to prevent overshooting
            const avoidMag = deterministicMagnitude(tempBuildingAvoid.x, tempBuildingAvoid.y);
            if (avoidMag > 0.5) {
              // Strong avoidance active - reduce speed to allow steering to take effect
              const speedReduction = Math.max(0.3, 1.0 - avoidMag * 0.3);
              fallbackVx *= speedReduction;
              fallbackVy *= speedReduction;
            }

            finalVx = fallbackVx;
            finalVy = fallbackVy;
          }
        }

        // Add arrival spreading - skip for combat units who should converge, not spread
        const isInCombatState = unit.state === 'attackmoving' || unit.state === 'attacking' ||
          unit.isInAssaultMode || unit.isNearFriendlyCombat;
        const distToFinalTarget =
          unit.targetX !== null && unit.targetY !== null
            ? deterministicMagnitude(unit.targetX - transform.x, unit.targetY - transform.y)
            : distance;

        if (distToFinalTarget < collisionConfig.arrivalSpreadRadius && !isInCombatState) {
          if (useWasmThisFrame) {
            const wasmForces = this.wasmBoids!.getForces(entityId);
            if (wasmForces) {
              tempSeparation.x = wasmForces.separationX;
              tempSeparation.y = wasmForces.separationY;
            } else {
              this.flocking.calculateSeparationForce(
                entityId,
                transform,
                unit,
                tempSeparation,
                distToFinalTarget,
                unitGrid
              );
            }
          } else {
            this.flocking.calculateSeparationForce(
              entityId,
              transform,
              unit,
              tempSeparation,
              distToFinalTarget,
              unitGrid
            );
          }
          finalVx += tempSeparation.x * collisionConfig.arrivalSpreadStrength;
          finalVy += tempSeparation.y * collisionConfig.arrivalSpreadStrength;
        }

        // Add cohesion and alignment
        if (
          unit.state === 'moving' ||
          unit.state === 'attackmoving' ||
          unit.state === 'patrolling'
        ) {
          if (useWasmThisFrame) {
            const wasmForces = this.wasmBoids!.getForces(entityId);
            if (wasmForces) {
              tempCohesion.x = wasmForces.cohesionX;
              tempCohesion.y = wasmForces.cohesionY;
              tempAlignment.x = wasmForces.alignmentX;
              tempAlignment.y = wasmForces.alignmentY;
            } else {
              this.flocking.calculateCohesionForce(
                entityId,
                transform,
                unit,
                tempCohesion,
                unitGrid
              );
              this.flocking.calculateAlignmentForce(
                entityId,
                transform,
                unit,
                velocity,
                tempAlignment,
                unitGrid,
                entityCache
              );
            }
          } else {
            this.flocking.calculateCohesionForce(entityId, transform, unit, tempCohesion, unitGrid);
            this.flocking.calculateAlignmentForce(
              entityId,
              transform,
              unit,
              velocity,
              tempAlignment,
              unitGrid,
              entityCache
            );
          }
          finalVx += tempCohesion.x;
          finalVy += tempCohesion.y;
          finalVx += tempAlignment.x;
          finalVy += tempAlignment.y;
        }
      } else {
        // Fallback to direct movement
        if (distance > 0.01) {
          finalVx = (dx / distance) * unit.currentSpeed;
          finalVy = (dy / distance) * unit.currentSpeed;
        }
      }
    } else {
      // Direct movement for flying units or non-crowd
      let prefVx = 0;
      let prefVy = 0;
      if (distance > 0.01) {
        prefVx = (dx / distance) * unit.currentSpeed;
        prefVy = (dy / distance) * unit.currentSpeed;
      }

      const distToFinalTarget =
        unit.targetX !== null && unit.targetY !== null
          ? deterministicMagnitude(unit.targetX - transform.x, unit.targetY - transform.y)
          : distance;

      if (!unit.isFlying) {
        if (useWasmThisFrame) {
          const wasmForces = this.wasmBoids!.getForces(entityId);
          if (wasmForces) {
            tempSeparation.x = wasmForces.separationX;
            tempSeparation.y = wasmForces.separationY;
            tempCohesion.x = wasmForces.cohesionX;
            tempCohesion.y = wasmForces.cohesionY;
            tempAlignment.x = wasmForces.alignmentX;
            tempAlignment.y = wasmForces.alignmentY;
          } else {
            this.flocking.preBatchNeighbors(entityId, transform, unit, unitGrid);
            this.flocking.calculateSeparationForce(
              entityId,
              transform,
              unit,
              tempSeparation,
              distToFinalTarget,
              unitGrid
            );
            this.flocking.calculateCohesionForce(entityId, transform, unit, tempCohesion, unitGrid);
            this.flocking.calculateAlignmentForce(
              entityId,
              transform,
              unit,
              velocity,
              tempAlignment,
              unitGrid,
              entityCache
            );
          }
        } else {
          this.flocking.preBatchNeighbors(entityId, transform, unit, unitGrid);
          this.flocking.calculateSeparationForce(
            entityId,
            transform,
            unit,
            tempSeparation,
            distToFinalTarget,
            unitGrid
          );
          this.flocking.calculateCohesionForce(entityId, transform, unit, tempCohesion, unitGrid);
          this.flocking.calculateAlignmentForce(
            entityId,
            transform,
            unit,
            velocity,
            tempAlignment,
            unitGrid,
            entityCache
          );
        }

        finalVx = prefVx + tempSeparation.x;
        finalVy = prefVy + tempSeparation.y;

        if (
          unit.state === 'moving' ||
          unit.state === 'attackmoving' ||
          unit.state === 'patrolling'
        ) {
          finalVx += tempCohesion.x;
          finalVy += tempCohesion.y;
          finalVx += tempAlignment.x;
          finalVy += tempAlignment.y;
        }
      } else {
        // Flying units
        this.flocking.calculateSeparationForce(
          entityId,
          transform,
          unit,
          tempSeparation,
          distToFinalTarget,
          unitGrid
        );
        finalVx = prefVx + tempSeparation.x * collisionConfig.flyingSeparationMultiplier;
        finalVy = prefVy + tempSeparation.y * collisionConfig.flyingSeparationMultiplier;
      }
    }

    // Building avoidance - Two modes:
    // 1. Full steering for non-crowd paths (flying units or crowd unavailable)
    // 2. Emergency-only for crowd agents (safety net when NavMesh fails)
    if (!USE_RECAST_CROWD || unit.isFlying || !this.pathfinding.isAgentRegistered(entityId)) {
      // Full building avoidance for non-crowd paths
      this.pathfinding.calculateBuildingAvoidanceForce(
        entityId,
        transform,
        unit,
        tempBuildingAvoid,
        finalVx,
        finalVy
      );
      finalVx += tempBuildingAvoid.x;
      finalVy += tempBuildingAvoid.y;
    } else {
      // Emergency building avoidance for crowd agents - only when very close to building
      // This is a safety net for when NavMesh obstacles fail to register properly
      this.pathfinding.calculateBuildingAvoidanceForce(
        entityId,
        transform,
        unit,
        tempBuildingAvoid,
        finalVx,
        finalVy
      );
      const avoidMag = deterministicMagnitude(tempBuildingAvoid.x, tempBuildingAvoid.y);
      // Only apply if strong avoidance is detected (unit is close to building)
      // This prevents oscillation while still catching penetration cases
      if (avoidMag > 1.5) {
        // Apply emergency avoidance with reduced strength to avoid oscillation
        finalVx += tempBuildingAvoid.x * 0.7;
        finalVy += tempBuildingAvoid.y * 0.7;
      }
    }

    // Physics pushing
    if (!unit.isFlying) {
      this.flocking.calculatePhysicsPush(entityId, transform, unit, tempPhysicsPush, unitGrid);
      finalVx += tempPhysicsPush.x;
      finalVy += tempPhysicsPush.y;
    }

    // Velocity smoothing
    const smoothed = this.flocking.smoothVelocity(
      entityId,
      finalVx,
      finalVy,
      velocity.x,
      velocity.y
    );
    finalVx = smoothed.vx;
    finalVy = smoothed.vy;

    // Stuck detection
    const currentVelMag = deterministicMagnitude(finalVx, finalVy);
    if (distance > this.arrivalThreshold) {
      this.flocking.handleStuckDetection(
        entityId,
        transform,
        unit,
        currentVelMag,
        distance,
        tempStuckNudge
      );
      finalVx += tempStuckNudge.x;
      finalVy += tempStuckNudge.y;
    }

    // Velocity deadzone: zero out micro-velocities from residual forces
    const finalMag = deterministicMagnitude(finalVx, finalVy);
    if (finalMag < VELOCITY_DEADZONE) {
      finalVx = 0;
      finalVy = 0;
    }

    // Apply velocity
    velocity.x = finalVx;
    velocity.y = finalVy;

    // Update rotation
    const targetRotation = Math.atan2(-dy, dx);
    const rotationDiff = targetRotation - transform.rotation;
    let normalizedDiff = rotationDiff;
    while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
    while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;
    const turnRate = UNIT_TURN_RATE * dt;
    if (Math.abs(normalizedDiff) < turnRate) {
      transform.rotation = targetRotation;
    } else {
      transform.rotation += Math.sign(normalizedDiff) * turnRate;
    }

    // For naval units, save position before movement for potential revert
    const isNaval = unit.movementDomain === 'water' && !unit.isFlying;
    let preMovePosX = 0;
    let preMovePosY = 0;
    if (isNaval) {
      preMovePosX = transform.x;
      preMovePosY = transform.y;
    }

    // Apply movement
    transform.translate(velocity.x * dt, velocity.y * dt);
    transform.x = snapValue(transform.x, QUANT_POSITION);
    transform.y = snapValue(transform.y, QUANT_POSITION);
    this.pathfinding.clampToMapBounds(transform);

    // Update Z height for terrain following (ramps, elevated platforms)
    // Use crowd agent's height if available (most accurate for navmesh surface)
    if (crowdHeight !== null && !unit.isFlying) {
      transform.z = crowdHeight;
    }

    // Hard collision resolution (can push units, so must happen before naval boundary check)
    if (!unit.isFlying) {
      this.pathfinding.resolveHardBuildingCollision(entityId, transform, unit);
    }

    // CRITICAL: Naval boundary enforcement must be LAST to catch any force that pushed onto land
    // This includes separation, building collision, physics push, etc.
    if (isNaval) {
      const isOnWater = this.isNavalWaterTerrain(transform.x, transform.y);
      if (isOnWater) {
        // Valid - save this position
        this.lastValidNavalWaterPosition.set(entityId, { x: transform.x, y: transform.y });
      } else {
        // On land - revert to pre-move position if it was valid, otherwise use last known good
        const wasValidBefore = this.isNavalWaterTerrain(preMovePosX, preMovePosY);
        if (wasValidBefore) {
          transform.x = preMovePosX;
          transform.y = preMovePosY;
          velocity.x = 0;
          velocity.y = 0;
        } else {
          // Pre-move was also invalid - use last known valid position
          const lastValid = this.lastValidNavalWaterPosition.get(entityId);
          if (lastValid) {
            transform.x = lastValid.x;
            transform.y = lastValid.y;
            velocity.x = 0;
            velocity.y = 0;
          } else {
            // No valid position known - find nearest water (expensive, but rare)
            const nearestWater = this.recast.findNearestPointForDomain(
              transform.x,
              transform.y,
              'water'
            );
            if (nearestWater) {
              transform.x = nearestWater.x;
              transform.y = nearestWater.y;
              velocity.x = 0;
              velocity.y = 0;
              this.lastValidNavalWaterPosition.set(entityId, {
                x: nearestWater.x,
                y: nearestWater.y,
              });
            }
          }
        }
      }
    }
  }
}
