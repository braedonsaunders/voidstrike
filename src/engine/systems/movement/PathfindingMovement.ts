/**
 * PathfindingMovement - A-star/navmesh pathfinding and crowd management
 *
 * Handles pathfinding requests, Recast crowd agent management,
 * building avoidance, and terrain speed modifiers.
 *
 * Key features:
 * - Crowd agent registration/removal for ground units
 * - Path request throttling to prevent spam
 * - Three-tier building avoidance (hard, soft, predictive)
 * - Terrain speed modifiers
 * - Map bounds clamping
 */

import { Entity } from '../../ecs/Entity';
import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Resource } from '../../components/Resource';
import { EventBus } from '../../core/EventBus';
import { PooledVector2 } from '@/utils/VectorPool';
import { TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { RecastNavigation } from '../../pathfinding/RecastNavigation';
import { debugPathfinding } from '@/utils/debugLogger';
import { collisionConfig } from '@/data/collisionConfig';
import { deterministicMagnitude, deterministicNormalizeWithMagnitude } from '@/utils/FixedPoint';
import { PATH_REQUEST_COOLDOWN_TICKS, USE_RECAST_CROWD } from '@/data/movement.config';

// PERF: Cached building query results to avoid double spatial grid lookups
const cachedBuildingQuery: { entityId: number; results: number[] } = { entityId: -1, results: [] };

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

/**
 * Interface for world access needed by pathfinding
 */
export interface PathfindingWorld {
  getEntity(id: number): Entity | undefined;
  buildingGrid: {
    queryRadius(x: number, y: number, radius: number): number[];
  };
}

/**
 * Interface for game access needed by pathfinding
 */
export interface PathfindingGame {
  getCurrentTick(): number;
  eventBus: EventBus;
  getTerrainAt(x: number, y: number): { feature?: string } | null;
  config: {
    mapWidth: number;
    mapHeight: number;
  };
}

/**
 * PathfindingMovement - Manages pathfinding and crowd simulation
 */
export class PathfindingMovement {
  private lastPathRequestTime: Map<number, number> = new Map();
  private crowdAgents: Set<number> = new Set();
  private recast: RecastNavigation;
  private game: PathfindingGame;
  private world: PathfindingWorld;

  // Rate limiting for warnings
  private crowdAgentFailLogCount = 0;
  private readonly MAX_CROWD_AGENT_FAIL_LOGS = 5;

  constructor(recast: RecastNavigation, game: PathfindingGame, world: PathfindingWorld) {
    this.recast = recast;
    this.game = game;
    this.world = world;
  }

  /**
   * Update world reference (needed after world re-initialization)
   */
  public setWorld(world: PathfindingWorld): void {
    this.world = world;
  }

  /**
   * Clean up tracking data for a unit
   */
  public cleanupUnit(entityId: number): void {
    this.lastPathRequestTime.delete(entityId);
    this.removeAgentIfRegistered(entityId);
  }

  /**
   * Invalidate building query cache (call at start of frame)
   */
  public invalidateBuildingCache(): void {
    cachedBuildingQuery.entityId = -1;
  }

  /**
   * Check if unit is registered with crowd
   */
  public isAgentRegistered(entityId: number): boolean {
    return this.crowdAgents.has(entityId);
  }

  /**
   * Get set of registered crowd agents
   */
  public getCrowdAgents(): Set<number> {
    return this.crowdAgents;
  }

  // ==================== PATH REQUESTS ====================

  /**
   * Request a path with cooldown throttling
   */
  public requestPathWithCooldown(
    entityId: number,
    targetX: number,
    targetY: number,
    force: boolean = false
  ): boolean {
    const currentTick = this.game.getCurrentTick();
    const lastRequestTick = this.lastPathRequestTime.get(entityId) || 0;

    if (!force && currentTick - lastRequestTick < PATH_REQUEST_COOLDOWN_TICKS) {
      return false;
    }

    this.lastPathRequestTime.set(entityId, currentTick);
    this.game.eventBus.emit('pathfinding:request', {
      entityId,
      targetX,
      targetY,
    });
    return true;
  }

  // ==================== CROWD AGENT MANAGEMENT ====================

  /**
   * Ensure unit is registered with crowd
   */
  public ensureAgentRegistered(entityId: number, transform: Transform, unit: Unit): void {
    if (!USE_RECAST_CROWD) return;
    if (unit.isFlying) return;
    if (this.crowdAgents.has(entityId)) return;

    // Use movement domain-aware agent registration
    // Naval units use water navmesh, ground units use ground navmesh
    const agentIndex = this.recast.addAgentForDomain(
      entityId,
      transform.x,
      transform.y,
      unit.movementDomain,
      unit.collisionRadius,
      unit.maxSpeed
    );

    if (agentIndex >= 0) {
      this.crowdAgents.add(entityId);
    } else {
      // Rate-limit warnings to avoid console spam
      if (this.crowdAgentFailLogCount < this.MAX_CROWD_AGENT_FAIL_LOGS) {
        debugPathfinding.warn(
          `[PathfindingMovement] Failed to add crowd agent for entity ${entityId}. ` +
            `Crowd may be at capacity (500 agents). Current agents: ${this.crowdAgents.size}. ` +
            `Unit will use fallback pathfinding without crowd avoidance.`
        );
        this.crowdAgentFailLogCount++;
        if (this.crowdAgentFailLogCount === this.MAX_CROWD_AGENT_FAIL_LOGS) {
          debugPathfinding.warn(
            '[PathfindingMovement] Suppressing further crowd agent failure warnings...'
          );
        }
      }
    }
  }

  /**
   * Remove unit from crowd
   */
  public removeAgentIfRegistered(entityId: number): void {
    if (!this.crowdAgents.has(entityId)) return;
    this.recast.removeAgent(entityId);
    this.crowdAgents.delete(entityId);
  }

  // ==================== CROWD PREPARATION ====================

  /**
   * CROWD FIX: Prepare all crowd agents before the crowd simulation update.
   * This syncs positions and sets targets so the crowd has fresh data.
   */
  public prepareCrowdAgents(entities: Entity[], _dt: number): void {
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      if (!transform || !unit) continue;

      // Skip dead units and flying units (crowd is for ground collision avoidance)
      if (unit.state === 'dead' || unit.isFlying) {
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      // Only register moving units
      const canMove =
        unit.state === 'moving' ||
        unit.state === 'attackmoving' ||
        unit.state === 'attacking' ||
        unit.state === 'gathering' ||
        unit.state === 'patrolling' ||
        unit.state === 'building';

      if (!canMove) {
        this.removeAgentIfRegistered(entity.id);
        continue;
      }

      // Ensure agent is registered
      this.ensureAgentRegistered(entity.id, transform, unit);

      // Sync agent position to entity position ONLY when there's significant drift
      // Constant teleporting disrupts the crowd's path corridor tracking
      if (this.crowdAgents.has(entity.id)) {
        const crowdState = this.recast.getAgentState(entity.id);
        if (crowdState) {
          const driftX = transform.x - crowdState.x;
          const driftY = transform.y - crowdState.y;
          const driftSq = driftX * driftX + driftY * driftY;

          // Only teleport if drift exceeds threshold (2 units)
          // This allows the crowd to compute proper path corridors without disruption
          const DRIFT_THRESHOLD_SQ = 2 * 2;
          if (driftSq > DRIFT_THRESHOLD_SQ) {
            // Pass current height to preserve layer on multi-level navmesh (ramps, platforms)
            this.recast.updateAgentPosition(entity.id, transform.x, transform.y, crowdState.height);
          }
        } else {
          // No crowd state yet - sync position
          this.recast.updateAgentPosition(entity.id, transform.x, transform.y);
        }

        // Calculate target for this unit
        let targetX: number | null = null;
        let targetY: number | null = null;

        if (unit.path.length > 0 && unit.pathIndex < unit.path.length) {
          const waypoint = unit.path[unit.pathIndex];
          targetX = waypoint.x;
          targetY = waypoint.y;
        } else if (unit.targetX !== null && unit.targetY !== null) {
          targetX = unit.targetX;
          targetY = unit.targetY;
        }

        // Attacking units: use target entity position so the crowd agent steers toward
        // the enemy immediately, eliminating the 1-2 frame "pause" where the crowd has
        // no valid target between clearing targetX/targetY and the new path arriving.
        if (targetX === null && unit.state === 'attacking' && unit.targetEntityId !== null) {
          const targetEntity = this.world.getEntity(unit.targetEntityId);
          if (targetEntity) {
            const targetTransform = targetEntity.get<Transform>('Transform');
            if (targetTransform) {
              targetX = targetTransform.x;
              targetY = targetTransform.y;
            }
          }
        }

        // Set target if we have one
        if (targetX !== null && targetY !== null) {
          this.recast.setAgentTarget(entity.id, targetX, targetY);
          // Use unit.maxSpeed for crowd - let the crowd simulation handle velocity fully
          // Previously used currentSpeed which capped velocity to accelerating speed
          this.recast.updateAgentParams(entity.id, {
            maxSpeed: unit.maxSpeed,
            radius: unit.collisionRadius,
          });
        }
      }
    }
  }

  /**
   * Update the crowd simulation
   */
  public updateCrowd(dt: number): void {
    if (USE_RECAST_CROWD) {
      this.recast.updateCrowd(dt);
    }
  }

  /**
   * Get agent state from crowd
   */
  public getAgentState(
    entityId: number
  ): { x: number; y: number; height: number; vx: number; vy: number } | null {
    return this.recast.getAgentState(entityId);
  }

  // ==================== BUILDING AVOIDANCE ====================

  /**
   * PERF: Get cached building query results - avoids duplicate spatial grid lookups
   * Both calculateBuildingAvoidanceForce and resolveHardBuildingCollision need nearby buildings
   */
  private getCachedBuildingQuery(entityId: number, x: number, y: number, radius: number): number[] {
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
  public calculateBuildingAvoidanceForce(
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
    const softMargin = collisionConfig.buildingAvoidanceSoftMargin;
    const hardMargin = collisionConfig.buildingAvoidanceHardMargin;
    const avoidStrength = collisionConfig.buildingAvoidanceStrength;
    const queryRadius = softMargin + selfUnit.collisionRadius + 8;
    const nearbyBuildingIds = this.getCachedBuildingQuery(
      entityId,
      selfTransform.x,
      selfTransform.y,
      queryRadius
    );

    const isCarryingResources =
      selfUnit.isWorker && (selfUnit.carryingMinerals > 0 || selfUnit.carryingPlasma > 0);

    let gatheringExtractorId: number | null = null;
    if (selfUnit.isWorker && selfUnit.state === 'gathering' && selfUnit.gatherTargetId !== null) {
      const resourceEntity = this.world.getEntity(selfUnit.gatherTargetId);
      if (resourceEntity) {
        const resource = resourceEntity.get<Resource>('Resource');
        if (resource && resource.resourceType === 'plasma' && resource.extractorEntityId !== null) {
          gatheringExtractorId = resource.extractorEntityId;
        }
      }
    }

    // Calculate predicted position for predictive avoidance (deterministic)
    const speed = deterministicMagnitude(velocityX, velocityY);
    const predictionTime = collisionConfig.buildingAvoidancePredictionLookahead;
    const predictedX = selfTransform.x + velocityX * predictionTime;
    const predictedY = selfTransform.y + velocityY * predictionTime;

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
      const hardHalfWidth = baseHalfWidth + hardMargin;
      const hardHalfHeight = baseHalfHeight + hardMargin;

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
      const {
        nx: normalizedDx,
        ny: normalizedDy,
        magnitude: distance,
      } = deterministicNormalizeWithMagnitude(dx, dy);

      const hardCollisionDist = selfUnit.collisionRadius + hardMargin;

      if (distance < hardCollisionDist && distance > 0.01) {
        // Push proportional to how deep we are
        const penetration = 1 - distance / hardCollisionDist;
        const strength = avoidStrength * penetration * penetration;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      } else if (distance < 0.01) {
        // Inside building - emergency escape
        const toCenterX = selfTransform.x - buildingTransform.x;
        const toCenterY = selfTransform.y - buildingTransform.y;
        const {
          nx: escapeDirX,
          ny: escapeDirY,
          magnitude: toCenterDist,
        } = deterministicNormalizeWithMagnitude(toCenterX, toCenterY);

        if (toCenterDist > 0.01) {
          forceX += escapeDirX * avoidStrength * 1.5;
          forceY += escapeDirY * avoidStrength * 1.5;
        } else {
          forceX += avoidStrength * 1.5;
        }
        continue; // Skip soft avoidance for emergency case
      }

      // === TIER 2: Soft avoidance (smooth steering in approach zone) ===
      const softHalfWidth = baseHalfWidth + softMargin;
      const softHalfHeight = baseHalfHeight + softMargin;

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
      const {
        nx: softNormalizedDx,
        ny: softNormalizedDy,
        magnitude: softDistance,
      } = deterministicNormalizeWithMagnitude(softDx, softDy);

      const softCollisionDist = selfUnit.collisionRadius + softMargin;

      if (softDistance < softCollisionDist && softDistance > hardCollisionDist) {
        // Gentle steering force in soft zone
        const t = (softDistance - hardCollisionDist) / (softCollisionDist - hardCollisionDist);
        const softStrength = avoidStrength * 0.3 * (1 - t);

        forceX += softNormalizedDx * softStrength;
        forceY += softNormalizedDy * softStrength;
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
        const predDistance = deterministicMagnitude(predDx, predDy);

        // If predicted position would be inside collision zone, steer perpendicular to velocity
        if (predDistance < selfUnit.collisionRadius + hardMargin * 0.5) {
          // Calculate perpendicular direction (choose the one away from building center)
          const toBuildingX = buildingTransform.x - selfTransform.x;
          const toBuildingY = buildingTransform.y - selfTransform.y;

          // Perpendicular to velocity
          const perpX = -velocityY / speed;
          const perpY = velocityX / speed;

          // Choose direction away from building
          const dot = perpX * toBuildingX + perpY * toBuildingY;
          const sign = dot > 0 ? -1 : 1;

          // Use configurable predictive strength multiplier
          const predictiveStrength =
            avoidStrength * collisionConfig.buildingAvoidancePredictiveStrengthMultiplier;
          forceX += perpX * sign * predictiveStrength;
          forceY += perpY * sign * predictiveStrength;
        }
      }
    }

    out.x = forceX;
    out.y = forceY;
  }

  // ==================== HARD COLLISION RESOLUTION ====================

  /**
   * Hard collision resolution - last resort safety net
   *
   * Immediately pushes units out of buildings if they somehow got inside.
   * Uses the same margin as building avoidance for consistency.
   * PERF: Uses cached building query from calculateBuildingAvoidanceForce
   */
  public resolveHardBuildingCollision(entityId: number, transform: Transform, unit: Unit): void {
    // PERF: Use cached query - same query already performed by calculateBuildingAvoidanceForce
    const softMargin = collisionConfig.buildingAvoidanceSoftMargin;
    const hardMargin = collisionConfig.buildingAvoidanceHardMargin;
    const queryRadius = softMargin + unit.collisionRadius + 8;
    const nearbyBuildingIds = this.getCachedBuildingQuery(
      entityId,
      transform.x,
      transform.y,
      queryRadius
    );

    const isCarryingResources =
      unit.isWorker && (unit.carryingMinerals > 0 || unit.carryingPlasma > 0);

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
      const collisionMargin = hardMargin + unit.collisionRadius;
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

        const escapeX = Math.abs(escapeLeft) < Math.abs(escapeRight) ? escapeLeft : escapeRight;
        const escapeY = Math.abs(escapeUp) < Math.abs(escapeDown) ? escapeUp : escapeDown;

        // Push exactly to edge - no buffer to prevent oscillation
        // The navmesh path should keep units away from buildings; this is just a safety net
        // for edge cases like physics push or teleport placing unit inside building
        if (Math.abs(escapeX) < Math.abs(escapeY)) {
          transform.x += escapeX;
        } else {
          transform.y += escapeY;
        }
      }
    }
  }

  // ==================== TERRAIN ====================

  /**
   * Get terrain speed modifier at position
   */
  public getTerrainSpeedModifier(x: number, y: number, isFlying: boolean): number {
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

  // ==================== MAP BOUNDS ====================

  /**
   * Clamp unit position to map boundaries.
   * Prevents units from falling off the edge of the map.
   * Uses a small margin (1 unit) to keep units slightly inside the playable area.
   */
  public clampToMapBounds(transform: Transform): void {
    const margin = 1;
    const minX = margin;
    const minY = margin;
    const maxX = this.game.config.mapWidth - margin;
    const maxY = this.game.config.mapHeight - margin;

    if (transform.x < minX) transform.x = minX;
    else if (transform.x > maxX) transform.x = maxX;

    if (transform.y < minY) transform.y = minY;
    else if (transform.y > maxY) transform.y = maxY;
  }
}
