/**
 * Movement System - Recast Crowd Integration
 *
 * Handles unit movement using Recast's DetourCrowd for collision avoidance.
 * The crowd simulation uses RVO (Reciprocal Velocity Obstacles) internally.
 */

import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Velocity } from '../components/Velocity';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { Game } from '../core/Game';
import { PooledVector2 } from '@/utils/VectorPool';
import { TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { getRecastNavigation, RecastNavigation } from '../pathfinding/RecastNavigation';
import { debugPerformance } from '@/utils/debugLogger';

// Steering behavior constants - SC2-style soft separation
const SEPARATION_RADIUS = 1.0;
const SEPARATION_STRENGTH = 2.0;
const MAX_AVOIDANCE_FORCE = 1.5;
const MAX_AVOIDANCE_FORCE_SQ = MAX_AVOIDANCE_FORCE * MAX_AVOIDANCE_FORCE; // PERF: Pre-computed squared

// Building avoidance - CRITICAL for preventing units stuck on building edges
// Margin must exceed unit collision radius (0.5) for proper clearance
const BUILDING_AVOIDANCE_STRENGTH = 35.0; // Increased for stronger push
const BUILDING_AVOIDANCE_MARGIN = 0.6;    // Margin > collision radius
const BUILDING_AVOIDANCE_SOFT_MARGIN = 1.5; // Early detection zone for smooth steering
const BUILDING_PREDICTION_LOOKAHEAD = 0.5;  // Seconds to look ahead for collision

// Path request cooldown
const PATH_REQUEST_COOLDOWN_MS = 500;

// Use Recast crowd for collision avoidance
const USE_RECAST_CROWD = false; // Temporarily disabled - crowd velocity returns 0

// Static temp vectors
const tempSeparation: PooledVector2 = { x: 0, y: 0 };
const tempBuildingAvoid: PooledVector2 = { x: 0, y: 0 };

// PERF: Cached building query results to avoid double spatial grid lookups
const cachedBuildingQuery: { entityId: number; results: number[] } = { entityId: -1, results: [] };

// PERF: Separation force throttle interval (recalculate every N ticks instead of every frame)
const SEPARATION_THROTTLE_TICKS = 5;

// PERF: Static array to avoid allocation on every building avoidance check
const DROP_OFF_BUILDINGS = Object.freeze([
  'headquarters',
  'orbital_station',
  'bastion',
  'nexus',
  'hatchery',
  'lair',
  'hive',
]);

// PERF: Pooled formation position buffer to avoid allocation per move command
const FORMATION_BUFFER_SIZE = 256; // Max units in a single move command
const formationBuffer: Array<{ x: number; y: number }> = [];
for (let i = 0; i < FORMATION_BUFFER_SIZE; i++) {
  formationBuffer.push({ x: 0, y: 0 });
}

export class MovementSystem extends System {
  public priority = 10;

  private arrivalThreshold = 0.5;
  private decelerationThreshold = 2.0;
  private lastPathRequestTime: Map<number, number> = new Map();
  private recast: RecastNavigation;

  // Track which units are registered with crowd
  private crowdAgents: Set<number> = new Set();

  // PERF: Cached separation forces to avoid recalculating every frame
  private separationCache: Map<number, { x: number; y: number; tick: number }> = new Map();
  private currentTick: number = 0;

  constructor(game: Game) {
    super(game);
    this.recast = getRecastNavigation();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:move', this.handleMoveCommand.bind(this));
    this.game.eventBus.on('command:patrol', this.handlePatrolCommand.bind(this));

    // Clean up path request tracking and separation cache when units die to prevent memory leaks
    this.game.eventBus.on('unit:died', (data: { entityId: number }) => {
      this.lastPathRequestTime.delete(data.entityId);
      this.separationCache.delete(data.entityId);
    });
    this.game.eventBus.on('unit:destroyed', (data: { entityId: number }) => {
      this.lastPathRequestTime.delete(data.entityId);
      this.separationCache.delete(data.entityId);
    });
  }

  private requestPathWithCooldown(
    entityId: number,
    targetX: number,
    targetY: number,
    force: boolean = false
  ): boolean {
    const now = Date.now();
    const lastRequest = this.lastPathRequestTime.get(entityId) || 0;

    if (!force && now - lastRequest < PATH_REQUEST_COOLDOWN_MS) {
      return false;
    }

    this.lastPathRequestTime.set(entityId, now);
    this.game.eventBus.emit('pathfinding:request', {
      entityId,
      targetX,
      targetY,
    });
    return true;
  }

  private handleMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, targetPosition, queue } = data;

    const positions = this.calculateFormationPositions(
      targetPosition.x,
      targetPosition.y,
      entityIds.length
    );

    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i];
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const pos = positions[i];

      if (queue) {
        unit.queueCommand({
          type: 'move',
          targetX: pos.x,
          targetY: pos.y,
        });
      } else {
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }

        unit.setMoveTarget(pos.x, pos.y);
        unit.path = [];
        unit.pathIndex = 0;
        this.requestPathWithCooldown(entityId, pos.x, pos.y, true);
      }
    }
  }

  private handlePatrolCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean;
  }): void {
    const { entityIds, targetPosition, queue } = data;

    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      if (!unit || !transform) continue;

      if (queue) {
        unit.queueCommand({
          type: 'patrol',
          targetX: targetPosition.x,
          targetY: targetPosition.y,
        });
      } else {
        unit.setPatrol(
          transform.x,
          transform.y,
          targetPosition.x,
          targetPosition.y
        );
        this.requestPathWithCooldown(
          entityId,
          targetPosition.x,
          targetPosition.y,
          true
        );
      }
    }
  }

  /**
   * Calculate formation positions for a group move command
   * PERF: Uses pooled buffer to avoid array allocation per move command
   * Returns a slice of the pooled buffer - DO NOT store reference, copy values immediately
   */
  private calculateFormationPositions(
    targetX: number,
    targetY: number,
    count: number
  ): Array<{ x: number; y: number }> {
    // Clamp to buffer size
    const effectiveCount = Math.min(count, FORMATION_BUFFER_SIZE);

    if (effectiveCount === 1) {
      formationBuffer[0].x = targetX;
      formationBuffer[0].y = targetY;
      return formationBuffer;
    }

    const spacing = 1.5;
    const cols = Math.ceil(Math.sqrt(effectiveCount));
    const rows = Math.ceil(effectiveCount / cols);
    const offsetX = ((cols - 1) * spacing) / 2;
    const offsetY = ((rows - 1) * spacing) / 2;

    // PERF: Reuse pooled buffer objects instead of allocating new ones
    for (let i = 0; i < effectiveCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      formationBuffer[i].x = targetX + col * spacing - offsetX;
      formationBuffer[i].y = targetY + row * spacing - offsetY;
    }

    return formationBuffer;
  }

  /**
   * Ensure unit is registered with crowd
   */
  private ensureAgentRegistered(
    entityId: number,
    transform: Transform,
    unit: Unit
  ): void {
    if (!USE_RECAST_CROWD) return;
    if (unit.isFlying) return;
    if (this.crowdAgents.has(entityId)) return;

    const agentIndex = this.recast.addAgent(
      entityId,
      transform.x,
      transform.y,
      unit.collisionRadius,
      unit.maxSpeed
    );

    if (agentIndex >= 0) {
      this.crowdAgents.add(entityId);
    }
  }

  /**
   * Remove unit from crowd
   */
  private removeAgentIfRegistered(entityId: number): void {
    if (!this.crowdAgents.has(entityId)) return;
    this.recast.removeAgent(entityId);
    this.crowdAgents.delete(entityId);
  }

  /**
   * Calculate separation force (SC2-style soft avoidance)
   * PERF: Results are cached and only recalculated every SEPARATION_THROTTLE_TICKS ticks
   */
  private calculateSeparationForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2
  ): void {
    if (selfUnit.state === 'gathering') {
      out.x = 0;
      out.y = 0;
      return;
    }

    // PERF: Check cache first - reuse result if calculated recently
    const cached = this.separationCache.get(selfId);
    if (cached && (this.currentTick - cached.tick) < SEPARATION_THROTTLE_TICKS) {
      out.x = cached.x;
      out.y = cached.y;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    const nearbyIds = this.world.unitGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      SEPARATION_RADIUS + selfUnit.collisionRadius
    );

    for (const entityId of nearbyIds) {
      if (entityId === selfId) continue;

      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const otherTransform = entity.get<Transform>('Transform');
      const otherUnit = entity.get<Unit>('Unit');
      if (!otherTransform || !otherUnit) continue;

      if (otherUnit.state === 'dead') continue;
      if (selfUnit.isFlying !== otherUnit.isFlying) continue;
      if (otherUnit.state === 'gathering') continue;
      // Allow workers to clip into each other for easier mining
      if (selfUnit.isWorker && otherUnit.isWorker) continue;

      const dx = selfTransform.x - otherTransform.x;
      const dy = selfTransform.y - otherTransform.y;
      const distanceSq = dx * dx + dy * dy;

      const combinedRadius = selfUnit.collisionRadius + otherUnit.collisionRadius;
      const separationDist = Math.max(combinedRadius * 0.5, SEPARATION_RADIUS);
      const separationDistSq = separationDist * separationDist;

      // PERF: Use squared distance for threshold check, only sqrt when needed
      if (distanceSq < separationDistSq && distanceSq > 0.0001) {
        const distance = Math.sqrt(distanceSq);
        const strength = SEPARATION_STRENGTH * (1 - distance / separationDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      }
    }

    // PERF: Use squared magnitude comparison first
    const magnitudeSq = forceX * forceX + forceY * forceY;
    if (magnitudeSq > MAX_AVOIDANCE_FORCE_SQ) {
      const magnitude = Math.sqrt(magnitudeSq);
      const scale = MAX_AVOIDANCE_FORCE / magnitude;
      forceX *= scale;
      forceY *= scale;
    }

    // PERF: Cache the result
    this.separationCache.set(selfId, { x: forceX, y: forceY, tick: this.currentTick });

    out.x = forceX;
    out.y = forceY;
  }

  /**
   * PERF: Get cached building query results - avoids duplicate spatial grid lookups
   * Both calculateBuildingAvoidanceForce and resolveHardBuildingCollision need nearby buildings
   */
  private getCachedBuildingQuery(
    entityId: number,
    x: number,
    y: number,
    radius: number
  ): number[] {
    // Return cached results if same entity (called twice per frame for same entity)
    if (cachedBuildingQuery.entityId === entityId) {
      return cachedBuildingQuery.results;
    }

    // New entity - perform query and cache results
    const results = this.world.buildingGrid.queryRadius(x, y, radius);
    cachedBuildingQuery.entityId = entityId;
    cachedBuildingQuery.results.length = 0;
    for (const id of results) {
      cachedBuildingQuery.results.push(id);
    }
    return cachedBuildingQuery.results;
  }

  /**
   * Calculate building avoidance force with predictive collision detection
   *
   * Uses three-tier avoidance:
   * 1. Hard avoidance - immediate push when very close (within margin)
   * 2. Soft avoidance - gentle steering when approaching (soft margin zone)
   * 3. Predictive avoidance - steer away from predicted collision points
   *
   * PERF: Uses cached building query to avoid duplicate spatial grid lookups
   */
  private calculateBuildingAvoidanceForce(
    entityId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2,
    velocityX: number = 0,
    velocityY: number = 0
  ): void {
    if (selfUnit.isFlying) {
      out.x = 0;
      out.y = 0;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    // Query larger radius to include soft avoidance zone
    // PERF: Use cached query - same query used by resolveHardBuildingCollision
    const queryRadius = BUILDING_AVOIDANCE_SOFT_MARGIN + selfUnit.collisionRadius + 8;
    const nearbyBuildingIds = this.getCachedBuildingQuery(
      entityId,
      selfTransform.x,
      selfTransform.y,
      queryRadius
    );

    const isCarryingResources =
      selfUnit.isWorker &&
      (selfUnit.carryingMinerals > 0 || selfUnit.carryingVespene > 0);

    let gatheringExtractorId: number | null = null;
    if (
      selfUnit.isWorker &&
      selfUnit.state === 'gathering' &&
      selfUnit.gatherTargetId !== null
    ) {
      const resourceEntity = this.world.getEntity(selfUnit.gatherTargetId);
      if (resourceEntity) {
        const resource = resourceEntity.get<Resource>('Resource');
        if (
          resource &&
          resource.resourceType === 'vespene' &&
          resource.extractorEntityId !== null
        ) {
          gatheringExtractorId = resource.extractorEntityId;
        }
      }
    }

    // Calculate predicted position for predictive avoidance
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    const predictedX = selfTransform.x + velocityX * BUILDING_PREDICTION_LOOKAHEAD;
    const predictedY = selfTransform.y + velocityY * BUILDING_PREDICTION_LOOKAHEAD;

    for (const buildingId of nearbyBuildingIds) {
      if (selfUnit.constructingBuildingId === buildingId) continue;
      if (gatheringExtractorId === buildingId) continue;

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      if (isCarryingResources && DROP_OFF_BUILDINGS.includes(building.buildingId)) {
        continue;
      }

      const baseHalfWidth = building.width / 2;
      const baseHalfHeight = building.height / 2;

      // === TIER 1: Hard avoidance (immediate collision prevention) ===
      const hardHalfWidth = baseHalfWidth + BUILDING_AVOIDANCE_MARGIN;
      const hardHalfHeight = baseHalfHeight + BUILDING_AVOIDANCE_MARGIN;

      const clampedX = Math.max(
        buildingTransform.x - hardHalfWidth,
        Math.min(selfTransform.x, buildingTransform.x + hardHalfWidth)
      );
      const clampedY = Math.max(
        buildingTransform.y - hardHalfHeight,
        Math.min(selfTransform.y, buildingTransform.y + hardHalfHeight)
      );

      const dx = selfTransform.x - clampedX;
      const dy = selfTransform.y - clampedY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const hardCollisionDist = selfUnit.collisionRadius + BUILDING_AVOIDANCE_MARGIN;

      if (distance < hardCollisionDist && distance > 0.01) {
        // Strong push proportional to how deep we are
        const penetration = 1 - (distance / hardCollisionDist);
        const strength = BUILDING_AVOIDANCE_STRENGTH * penetration * penetration; // Quadratic for stronger close push
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      } else if (distance < 0.01) {
        // Inside building - emergency escape
        const toCenterX = selfTransform.x - buildingTransform.x;
        const toCenterY = selfTransform.y - buildingTransform.y;
        const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

        if (toCenterDist > 0.01) {
          forceX += (toCenterX / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH * 1.5;
          forceY += (toCenterY / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH * 1.5;
        } else {
          forceX += BUILDING_AVOIDANCE_STRENGTH * 1.5;
        }
        continue; // Skip soft avoidance for emergency case
      }

      // === TIER 2: Soft avoidance (smooth steering in approach zone) ===
      const softHalfWidth = baseHalfWidth + BUILDING_AVOIDANCE_SOFT_MARGIN;
      const softHalfHeight = baseHalfHeight + BUILDING_AVOIDANCE_SOFT_MARGIN;

      const softClampedX = Math.max(
        buildingTransform.x - softHalfWidth,
        Math.min(selfTransform.x, buildingTransform.x + softHalfWidth)
      );
      const softClampedY = Math.max(
        buildingTransform.y - softHalfHeight,
        Math.min(selfTransform.y, buildingTransform.y + softHalfHeight)
      );

      const softDx = selfTransform.x - softClampedX;
      const softDy = selfTransform.y - softClampedY;
      const softDistance = Math.sqrt(softDx * softDx + softDy * softDy);

      const softCollisionDist = selfUnit.collisionRadius + BUILDING_AVOIDANCE_SOFT_MARGIN;

      if (softDistance < softCollisionDist && softDistance > hardCollisionDist) {
        // Gentle steering force in soft zone
        const t = (softDistance - hardCollisionDist) / (softCollisionDist - hardCollisionDist);
        const softStrength = BUILDING_AVOIDANCE_STRENGTH * 0.3 * (1 - t);
        const normalizedDx = softDx / softDistance;
        const normalizedDy = softDy / softDistance;

        forceX += normalizedDx * softStrength;
        forceY += normalizedDy * softStrength;
      }

      // === TIER 3: Predictive avoidance (steer away from future collision) ===
      if (speed > 0.5) {
        const predClampedX = Math.max(
          buildingTransform.x - hardHalfWidth,
          Math.min(predictedX, buildingTransform.x + hardHalfWidth)
        );
        const predClampedY = Math.max(
          buildingTransform.y - hardHalfHeight,
          Math.min(predictedY, buildingTransform.y + hardHalfHeight)
        );

        const predDx = predictedX - predClampedX;
        const predDy = predictedY - predClampedY;
        const predDistance = Math.sqrt(predDx * predDx + predDy * predDy);

        // If predicted position would be inside collision zone, steer perpendicular to velocity
        if (predDistance < selfUnit.collisionRadius + BUILDING_AVOIDANCE_MARGIN * 0.5) {
          // Calculate perpendicular direction (choose the one away from building center)
          const toBuildingX = buildingTransform.x - selfTransform.x;
          const toBuildingY = buildingTransform.y - selfTransform.y;

          // Perpendicular to velocity
          const perpX = -velocityY / speed;
          const perpY = velocityX / speed;

          // Choose direction away from building
          const dot = perpX * toBuildingX + perpY * toBuildingY;
          const sign = dot > 0 ? -1 : 1;

          const predictiveStrength = BUILDING_AVOIDANCE_STRENGTH * 0.5;
          forceX += perpX * sign * predictiveStrength;
          forceY += perpY * sign * predictiveStrength;
        }
      }
    }

    out.x = forceX;
    out.y = forceY;
  }

  public update(deltaTime: number): void {
    const updateStart = performance.now();
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    const dt = deltaTime / 1000;

    // PERF: Track current tick for separation force throttling
    this.currentTick = this.game.getCurrentTick();

    // PERF: Invalidate building query cache at start of frame
    cachedBuildingQuery.entityId = -1;

    // Update spatial grid
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;
      if (unit.state !== 'dead') {
        this.world.unitGrid.update(
          entity.id,
          transform.x,
          transform.y,
          unit.collisionRadius
        );
      }
    }

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const velocity = entity.get<Velocity>('Velocity');
      if (!transform || !unit || !velocity) continue;

      // Handle dead units
      if (unit.state === 'dead') {
        velocity.zero();
        this.world.unitGrid.remove(entity.id);
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      const canMove =
        unit.state === 'moving' ||
        unit.state === 'attackmoving' ||
        unit.state === 'attacking' ||
        unit.state === 'gathering' ||
        unit.state === 'patrolling' ||
        unit.state === 'building';

      if (!canMove) {
        if (unit.currentSpeed > 0) {
          unit.currentSpeed = Math.max(
            0,
            unit.currentSpeed - unit.acceleration * dt * 2
          );
        }
        velocity.zero();
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      // Ensure agent is in crowd for collision avoidance
      if (USE_RECAST_CROWD && !unit.isFlying) {
        this.ensureAgentRegistered(entity.id, transform, unit);
      }

      // Get current target
      let targetX: number | null = null;
      let targetY: number | null = null;

      if (unit.path.length > 0 && unit.pathIndex < unit.path.length) {
        const waypoint = unit.path[unit.pathIndex];
        targetX = waypoint.x;
        targetY = waypoint.y;
      } else if (unit.targetX !== null && unit.targetY !== null) {
        targetX = unit.targetX;
        targetY = unit.targetY;

        if (!unit.isFlying) {
          const directDx = unit.targetX - transform.x;
          const directDy = unit.targetY - transform.y;
          // PERF: Use squared distance - avoid sqrt for simple threshold check
          const directDistanceSq = directDx * directDx + directDy * directDy;

          const needsPath =
            unit.state === 'moving' ||
            unit.state === 'gathering' ||
            unit.state === 'building';
          if (directDistanceSq > 9 && needsPath) { // 9 = 3^2
            this.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY);
          }
        }
      }

      // Handle attacking state
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        const targetEntity = this.world.getEntity(unit.targetEntityId);
        if (targetEntity) {
          const targetTransform = targetEntity.get<Transform>('Transform');
          const targetBuilding = targetEntity.get<Building>('Building');
          if (targetTransform) {
            let effectiveDistance: number;
            let attackTargetX = targetTransform.x;
            let attackTargetY = targetTransform.y;
            let needsToEscape = false;

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
              effectiveDistance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

              const standOffDistance = unit.attackRange * 0.8;
              const minSafeDistance = unit.collisionRadius + 0.5;

              if (effectiveDistance > minSafeDistance) {
                const dirX = edgeDx / effectiveDistance;
                const dirY = edgeDy / effectiveDistance;
                attackTargetX = clampedX + dirX * standOffDistance;
                attackTargetY = clampedY + dirY * standOffDistance;
              } else {
                needsToEscape = true;
                const awayDx = transform.x - targetTransform.x;
                const awayDy = transform.y - targetTransform.y;
                const awayDist = Math.sqrt(awayDx * awayDx + awayDy * awayDy);
                if (awayDist > 0.1) {
                  const escapeDistance =
                    Math.max(halfW, halfH) + standOffDistance + 0.5;
                  attackTargetX =
                    targetTransform.x + (awayDx / awayDist) * escapeDistance;
                  attackTargetY =
                    targetTransform.y + (awayDy / awayDist) * escapeDistance;
                } else {
                  attackTargetX = targetTransform.x + halfW + standOffDistance + 0.5;
                  attackTargetY = targetTransform.y;
                }
              }
            } else {
              effectiveDistance = transform.distanceTo(targetTransform);
            }

            if (effectiveDistance > unit.attackRange || needsToEscape) {
              targetX = attackTargetX;
              targetY = attackTargetY;
            } else {
              transform.rotation = Math.atan2(
                targetTransform.y - transform.y,
                targetTransform.x - transform.x
              );
              unit.currentSpeed = Math.max(
                0,
                unit.currentSpeed - unit.acceleration * dt * 2
              );
              velocity.zero();
              continue;
            }
          }
        } else {
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      if (targetX === null || targetY === null) {
        if (unit.executeNextCommand()) {
          if (unit.targetX !== null && unit.targetY !== null) {
            unit.path = [];
            unit.pathIndex = 0;
            this.requestPathWithCooldown(
              entity.id,
              unit.targetX,
              unit.targetY,
              true
            );
          }
        } else {
          unit.currentSpeed = Math.max(
            0,
            unit.currentSpeed - unit.acceleration * dt * 2
          );
        }
        velocity.zero();
        continue;
      }

      const dx = targetX - transform.x;
      const dy = targetY - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check arrival
      if (distance < this.arrivalThreshold) {
        if (unit.path.length > 0 && unit.pathIndex < unit.path.length - 1) {
          unit.pathIndex++;
        } else if (unit.state === 'patrolling') {
          unit.nextPatrolPoint();
          unit.path = [];
          unit.pathIndex = 0;
          if (unit.targetX !== null && unit.targetY !== null) {
            this.requestPathWithCooldown(
              entity.id,
              unit.targetX,
              unit.targetY,
              true
            );
          }
        } else {
          if (unit.state === 'gathering') {
            unit.targetX = null;
            unit.targetY = null;
            velocity.zero();
            continue;
          }

          if (unit.state === 'building') {
            unit.targetX = null;
            unit.targetY = null;
            unit.currentSpeed = 0;
            velocity.zero();
            continue;
          }

          if (unit.executeNextCommand()) {
            if (unit.targetX !== null && unit.targetY !== null) {
              unit.path = [];
              unit.pathIndex = 0;
              this.requestPathWithCooldown(
                entity.id,
                unit.targetX,
                unit.targetY,
                true
              );
            }
          } else {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      // Calculate speed
      let targetSpeed = unit.maxSpeed;
      const terrainSpeedMod = this.getTerrainSpeedModifier(
        transform.x,
        transform.y,
        unit.isFlying
      );
      targetSpeed *= terrainSpeedMod;

      if (distance < this.decelerationThreshold) {
        targetSpeed = targetSpeed * (distance / this.decelerationThreshold);
        targetSpeed = Math.max(targetSpeed, unit.maxSpeed * terrainSpeedMod * 0.3);
      }

      if (unit.currentSpeed < targetSpeed) {
        unit.currentSpeed = Math.min(
          targetSpeed,
          unit.currentSpeed + unit.acceleration * dt
        );
      } else if (unit.currentSpeed > targetSpeed) {
        unit.currentSpeed = Math.max(
          targetSpeed,
          unit.currentSpeed - unit.acceleration * dt * 2
        );
      }

      // Calculate velocity
      let finalVx = 0;
      let finalVy = 0;

      if (USE_RECAST_CROWD && this.crowdAgents.has(entity.id) && !unit.isFlying) {
        // Use Recast crowd velocity
        this.recast.setAgentTarget(entity.id, targetX, targetY);
        this.recast.updateAgentParams(entity.id, {
          maxSpeed: unit.currentSpeed,
          radius: unit.collisionRadius,
        });

        const state = this.recast.getAgentState(entity.id);
        if (state) {
          finalVx = state.vx;
          finalVy = state.vy;

          // Sync position if significantly different (teleport recovery)
          const posDx = state.x - transform.x;
          const posDy = state.y - transform.y;
          if (Math.abs(posDx) > 0.5 || Math.abs(posDy) > 0.5) {
            this.recast.updateAgentPosition(entity.id, transform.x, transform.y);
          }
        } else {
          // Fallback to direct movement
          if (distance > 0.01) {
            finalVx = (dx / distance) * unit.currentSpeed;
            finalVy = (dy / distance) * unit.currentSpeed;
          }
        }
      } else {
        // Direct movement for flying units or when crowd not available
        let prefVx = 0;
        let prefVy = 0;
        if (distance > 0.01) {
          prefVx = (dx / distance) * unit.currentSpeed;
          prefVy = (dy / distance) * unit.currentSpeed;
        }

        // Simple separation for non-crowd units
        if (!unit.isFlying && distance > this.arrivalThreshold * 2) {
          this.calculateSeparationForce(entity.id, transform, unit, tempSeparation);
          const separationWeight =
            distance > this.decelerationThreshold ? 0.5 : 0.1;

          let dirX = distance > 0.01 ? dx / distance : 0;
          let dirY = distance > 0.01 ? dy / distance : 0;

          dirX += tempSeparation.x * separationWeight;
          dirY += tempSeparation.y * separationWeight;

          const newMag = Math.sqrt(dirX * dirX + dirY * dirY);
          if (newMag > 0.01) {
            dirX /= newMag;
            dirY /= newMag;
          }

          finalVx = dirX * unit.currentSpeed;
          finalVy = dirY * unit.currentSpeed;
        } else {
          finalVx = prefVx;
          finalVy = prefVy;
        }
      }

      // Building avoidance (always active) - pass current velocity for predictive avoidance
      // PERF: Pass entityId for cached building query (shared with hard collision check)
      this.calculateBuildingAvoidanceForce(entity.id, transform, unit, tempBuildingAvoid, finalVx, finalVy);
      finalVx += tempBuildingAvoid.x;
      finalVy += tempBuildingAvoid.y;

      // Apply velocity
      const speedDamping = unit.currentSpeed < unit.maxSpeed * 0.2 ? 0.5 : 1.0;
      velocity.x = finalVx * speedDamping;
      velocity.y = finalVy * speedDamping;

      // Update rotation
      const targetRotation = Math.atan2(dy, dx);
      const rotationDiff = targetRotation - transform.rotation;

      let normalizedDiff = rotationDiff;
      while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
      while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;

      const turnRate = 8 * dt;
      if (Math.abs(normalizedDiff) < turnRate) {
        transform.rotation = targetRotation;
      } else {
        transform.rotation += Math.sign(normalizedDiff) * turnRate;
      }

      // Apply movement
      transform.translate(velocity.x * dt, velocity.y * dt);

      // Hard collision resolution
      // PERF: Uses same cached building query as avoidance force above
      if (!unit.isFlying) {
        this.resolveHardBuildingCollision(entity.id, transform, unit);
      }
    }

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) {
      debugPerformance.warn(
        `[MovementSystem] UPDATE: ${entities.length} entities took ${updateElapsed.toFixed(1)}ms`
      );
    }
  }

  private getTerrainSpeedModifier(
    x: number,
    y: number,
    isFlying: boolean
  ): number {
    if (isFlying) return 1.0;

    const cell = this.game.getTerrainAt(x, y);
    if (!cell) return 1.0;

    const feature: TerrainFeature = (cell.feature as TerrainFeature) || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    if (isFlying && config.flyingIgnores) {
      return 1.0;
    }

    return config.speedModifier;
  }

  /**
   * Hard collision resolution - last resort safety net
   *
   * Immediately pushes units out of buildings if they somehow got inside.
   * Uses the same margin as building avoidance for consistency.
   * PERF: Uses cached building query from calculateBuildingAvoidanceForce
   */
  private resolveHardBuildingCollision(entityId: number, transform: Transform, unit: Unit): void {
    // PERF: Use cached query - same query already performed by calculateBuildingAvoidanceForce
    const queryRadius = BUILDING_AVOIDANCE_SOFT_MARGIN + unit.collisionRadius + 8;
    const nearbyBuildingIds = this.getCachedBuildingQuery(
      entityId,
      transform.x,
      transform.y,
      queryRadius
    );

    const isCarryingResources =
      unit.isWorker &&
      (unit.carryingMinerals > 0 || unit.carryingVespene > 0);

    for (const buildingId of nearbyBuildingIds) {
      if (unit.constructingBuildingId === buildingId) continue;

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      if (isCarryingResources && DROP_OFF_BUILDINGS.includes(building.buildingId)) {
        continue;
      }

      // Use consistent margin with building avoidance system
      const collisionMargin = BUILDING_AVOIDANCE_MARGIN + unit.collisionRadius;
      const halfWidth = building.width / 2 + collisionMargin;
      const halfHeight = building.height / 2 + collisionMargin;

      const dx = transform.x - buildingTransform.x;
      const dy = transform.y - buildingTransform.y;

      if (Math.abs(dx) < halfWidth && Math.abs(dy) < halfHeight) {
        // Calculate shortest escape direction
        const escapeLeft = -(halfWidth + dx);
        const escapeRight = halfWidth - dx;
        const escapeUp = -(halfHeight + dy);
        const escapeDown = halfHeight - dy;

        const escapeX =
          Math.abs(escapeLeft) < Math.abs(escapeRight) ? escapeLeft : escapeRight;
        const escapeY =
          Math.abs(escapeUp) < Math.abs(escapeDown) ? escapeUp : escapeDown;

        // Push out with extra buffer to prevent oscillation
        const pushBuffer = 0.3;
        if (Math.abs(escapeX) < Math.abs(escapeY)) {
          transform.x += escapeX + (escapeX > 0 ? pushBuffer : -pushBuffer);
        } else {
          transform.y += escapeY + (escapeY > 0 ? pushBuffer : -pushBuffer);
        }
      }
    }
  }
}
