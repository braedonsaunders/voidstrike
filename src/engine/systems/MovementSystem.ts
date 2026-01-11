import { System } from '../ecs/System';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Velocity } from '../components/Velocity';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';
import { Game } from '../core/Game';
import { PooledVector2 } from '@/utils/VectorPool';
import { TERRAIN_FEATURE_CONFIG, TerrainFeature } from '@/data/maps';
import { computeORCAVelocity } from '../pathfinding/RVO';
import { debugPerformance } from '@/utils/debugLogger';

// Steering behavior constants - SC2-style soft separation (units can overlap and clump)
const SEPARATION_RADIUS = 1.0; // Units only avoid when nearly overlapping
const SEPARATION_STRENGTH = 2.0; // Very soft push - allows clumping like SC2
const MAX_AVOIDANCE_FORCE = 1.5; // Low cap - units can stack
const BUILDING_AVOIDANCE_STRENGTH = 25.0; // Push from buildings (still solid)
const BUILDING_AVOIDANCE_MARGIN = 0.25; // Minimal margin around buildings - hitbox should match model

// RVO/ORCA settings
const USE_RVO_AVOIDANCE = true; // Enable ORCA-based local avoidance (recast-style)
const RVO_NEIGHBOR_RADIUS = 5.0; // How far to look for neighbors
const RVO_TIME_HORIZON = 1.5; // How far ahead to plan avoidance (seconds)

// Path request cooldown to prevent spamming
const PATH_REQUEST_COOLDOWN_MS = 500; // Minimum time between path requests per unit

// Static temp vectors to avoid allocations in hot loops
const tempSeparation: PooledVector2 = { x: 0, y: 0 };
const tempBuildingAvoid: PooledVector2 = { x: 0, y: 0 };
const zeroVector: PooledVector2 = { x: 0, y: 0 };

export class MovementSystem extends System {
  public priority = 10;

  private arrivalThreshold = 0.5;
  private decelerationThreshold = 2.0; // Start slowing down at this distance

  // Track last path request time per entity to prevent spam
  private lastPathRequestTime: Map<number, number> = new Map();

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Handle move commands
    this.game.eventBus.on('command:move', this.handleMoveCommand.bind(this));
    this.game.eventBus.on('command:patrol', this.handlePatrolCommand.bind(this));
  }

  /**
   * Request a path with cooldown to prevent spam.
   * Returns true if request was sent, false if on cooldown.
   */
  private requestPathWithCooldown(entityId: number, targetX: number, targetY: number, force: boolean = false): boolean {
    const now = Date.now();
    const lastRequest = this.lastPathRequestTime.get(entityId) || 0;

    if (!force && now - lastRequest < PATH_REQUEST_COOLDOWN_MS) {
      return false; // On cooldown
    }

    this.lastPathRequestTime.set(entityId, now);
    this.game.eventBus.emit('pathfinding:request', {
      entityId: entityId,
      targetX: targetX,
      targetY: targetY,
    });
    return true;
  }

  private handleMoveCommand(data: {
    entityIds: number[];
    targetPosition: { x: number; y: number };
    queue?: boolean; // If true, queue the command instead of replacing
  }): void {
    const { entityIds, targetPosition, queue } = data;

    // Calculate formation positions for multiple units
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
        // Add to command queue instead of executing immediately
        unit.queueCommand({
          type: 'move',
          targetX: pos.x,
          targetY: pos.y,
        });
      } else {
        // If worker is currently constructing, release them from construction (SC2-style)
        // The building will pause and can be resumed by another worker
        if (unit.state === 'building' && unit.constructingBuildingId !== null) {
          unit.cancelBuilding();
        }

        // Execute immediately
        unit.setMoveTarget(pos.x, pos.y);
        unit.path = [];
        unit.pathIndex = 0;

        // Request a path from the pathfinding system (force=true for user commands)
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
        // Queue the patrol command instead of executing immediately
        unit.queueCommand({
          type: 'patrol',
          targetX: targetPosition.x,
          targetY: targetPosition.y,
        });
      } else {
        // Set patrol between current position and target
        unit.setPatrol(transform.x, transform.y, targetPosition.x, targetPosition.y);

        // Request path to first patrol destination (force=true for user commands)
        this.requestPathWithCooldown(entityId, targetPosition.x, targetPosition.y, true);
      }
    }
  }

  private calculateFormationPositions(
    targetX: number,
    targetY: number,
    count: number
  ): Array<{ x: number; y: number }> {
    if (count === 1) {
      return [{ x: targetX, y: targetY }];
    }

    const positions: Array<{ x: number; y: number }> = [];
    const spacing = 1.5;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const offsetX = ((cols - 1) * spacing) / 2;
    const offsetY = ((rows - 1) * spacing) / 2;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: targetX + col * spacing - offsetX,
        y: targetY + row * spacing - offsetY,
      });
    }

    return positions;
  }

  /**
   * Calculate separation force (SC2-style soft avoidance)
   * Units can overlap and clump - separation is very soft
   * Gathering workers skip separation entirely (like SC2 mining)
   * Uses spatial grid for O(1) lookups instead of checking all entities
   * @param out - Output vector to write result (avoids allocation)
   */
  private calculateSeparationForce(
    selfId: number,
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2
  ): void {
    // SC2-style: gathering workers walk through each other completely
    if (selfUnit.state === 'gathering') {
      out.x = 0;
      out.y = 0;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    // Use spatial grid to find nearby units - only check units within separation radius
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

      // Skip dead units
      if (otherUnit.state === 'dead') continue;

      // Flying units don't collide with ground units
      if (selfUnit.isFlying !== otherUnit.isFlying) continue;

      // SC2-style: skip separation with gathering workers (they walk through)
      if (otherUnit.state === 'gathering') continue;

      const dx = selfTransform.x - otherTransform.x;
      const dy = selfTransform.y - otherTransform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Combined radius for collision - only push when nearly overlapping
      const combinedRadius = selfUnit.collisionRadius + otherUnit.collisionRadius;
      const separationDist = Math.max(combinedRadius * 0.5, SEPARATION_RADIUS);

      if (distance < separationDist && distance > 0.01) {
        // Very soft push - allows clumping like SC2
        const strength = SEPARATION_STRENGTH * (1 - distance / separationDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      }
    }

    // Clamp the force magnitude - low cap allows stacking
    const magnitude = Math.sqrt(forceX * forceX + forceY * forceY);
    if (magnitude > MAX_AVOIDANCE_FORCE) {
      const scale = MAX_AVOIDANCE_FORCE / magnitude;
      forceX *= scale;
      forceY *= scale;
    }

    out.x = forceX;
    out.y = forceY;
  }

  /**
   * Calculate building avoidance force
   * Units are pushed away from buildings they're overlapping with
   * Uses spatial grid for O(1) lookups
   * @param out - Output vector to write result (avoids allocation)
   */
  private calculateBuildingAvoidanceForce(
    selfTransform: Transform,
    selfUnit: Unit,
    out: PooledVector2
  ): void {
    // Flying units don't collide with buildings
    if (selfUnit.isFlying) {
      out.x = 0;
      out.y = 0;
      return;
    }

    let forceX = 0;
    let forceY = 0;

    // Use spatial grid to find nearby buildings
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      selfTransform.x,
      selfTransform.y,
      BUILDING_AVOIDANCE_MARGIN + selfUnit.collisionRadius + 5 // Extra range for large buildings
    );

    // Resource drop-off buildings - workers carrying resources skip avoidance for these
    const dropOffBuildings = [
      'headquarters', 'orbital_station', 'bastion',
      'nexus', 'hatchery', 'lair', 'hive'
    ];
    const isCarryingResources = selfUnit.isWorker &&
      (selfUnit.carryingMinerals > 0 || selfUnit.carryingVespene > 0);

    // For workers gathering vespene, find the extractor they're targeting
    let gatheringExtractorId: number | null = null;
    if (selfUnit.isWorker && selfUnit.state === 'gathering' && selfUnit.gatherTargetId !== null) {
      const resourceEntity = this.world.getEntity(selfUnit.gatherTargetId);
      if (resourceEntity) {
        const resource = resourceEntity.get<Resource>('Resource');
        if (resource && resource.resourceType === 'vespene' && resource.extractorEntityId !== null) {
          gatheringExtractorId = resource.extractorEntityId;
        }
      }
    }

    for (const buildingId of nearbyBuildingIds) {
      // Skip the building this worker is constructing - they need to get close to it
      if (selfUnit.constructingBuildingId === buildingId) {
        continue;
      }

      // Skip the extractor this worker is gathering from - they need to get close to it
      if (gatheringExtractorId === buildingId) {
        continue;
      }

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      // Skip drop-off buildings for workers carrying resources - they need to get close
      if (isCarryingResources && dropOffBuildings.includes(building.buildingId)) {
        continue;
      }

      // Get building bounds (center-based)
      const halfWidth = building.width / 2 + BUILDING_AVOIDANCE_MARGIN;
      const halfHeight = building.height / 2 + BUILDING_AVOIDANCE_MARGIN;

      // Calculate closest point on building to unit
      const clampedX = Math.max(
        buildingTransform.x - halfWidth,
        Math.min(selfTransform.x, buildingTransform.x + halfWidth)
      );
      const clampedY = Math.max(
        buildingTransform.y - halfHeight,
        Math.min(selfTransform.y, buildingTransform.y + halfHeight)
      );

      // Distance from unit to closest point on building
      const dx = selfTransform.x - clampedX;
      const dy = selfTransform.y - clampedY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // If unit is overlapping with building (within collision radius)
      const collisionDist = selfUnit.collisionRadius + BUILDING_AVOIDANCE_MARGIN;

      if (distance < collisionDist && distance > 0.01) {
        // Push unit away from building
        const strength = BUILDING_AVOIDANCE_STRENGTH * (1 - distance / collisionDist);
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        forceX += normalizedDx * strength;
        forceY += normalizedDy * strength;
      } else if (distance < 0.01) {
        // Unit is inside building - push toward center direction
        const toCenterX = selfTransform.x - buildingTransform.x;
        const toCenterY = selfTransform.y - buildingTransform.y;
        const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

        if (toCenterDist > 0.01) {
          forceX += (toCenterX / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH;
          forceY += (toCenterY / toCenterDist) * BUILDING_AVOIDANCE_STRENGTH;
        } else {
          // Exactly at center - push in random direction
          forceX += BUILDING_AVOIDANCE_STRENGTH;
        }
      }
    }

    out.x = forceX;
    out.y = forceY;
  }

  public update(deltaTime: number): void {
    const updateStart = performance.now();
    const entities = this.world.getEntitiesWith('Transform', 'Unit', 'Velocity');
    const dt = deltaTime / 1000; // Convert to seconds

    // Update all unit positions in spatial grid at start of frame
    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      if (unit.state !== 'dead') {
        this.world.unitGrid.update(entity.id, transform.x, transform.y, unit.collisionRadius);
      }
    }

    for (const entity of entities) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const velocity = entity.get<Velocity>('Velocity')!;

      // Skip dead units
      if (unit.state === 'dead') {
        velocity.zero();
        this.world.unitGrid.remove(entity.id);
        continue;
      }

      // Allow movement for moving, attackmoving, attacking, gathering, patrolling, and building states
      const canMove = unit.state === 'moving' || unit.state === 'attackmoving' ||
                      unit.state === 'attacking' || unit.state === 'gathering' ||
                      unit.state === 'patrolling' || unit.state === 'building';

      if (!canMove) {
        // Decelerate to stop
        if (unit.currentSpeed > 0) {
          unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.acceleration * dt * 2);
        }
        velocity.zero();
        continue;
      }

      // Get current target from path or direct target
      let targetX: number | null = null;
      let targetY: number | null = null;

      if (unit.path.length > 0 && unit.pathIndex < unit.path.length) {
        const waypoint = unit.path[unit.pathIndex];
        targetX = waypoint.x;
        targetY = waypoint.y;
      } else if (unit.targetX !== null && unit.targetY !== null) {
        targetX = unit.targetX;
        targetY = unit.targetY;

        // No path but has target - request path if distance is significant
        // This handles edge cases where path request was missed or path is empty
        // Uses cooldown to prevent spamming when no path can be found
        // Flying units don't need pathfinding - they move direct
        if (!unit.isFlying) {
          const directDx = unit.targetX - transform.x;
          const directDy = unit.targetY - transform.y;
          const directDistance = Math.sqrt(directDx * directDx + directDy * directDy);

          // Request path for distances > 3 units (short movements can go direct)
          // Include gathering and building states so workers can pathfind to resources/construction sites
          const needsPath = unit.state === 'moving' || unit.state === 'gathering' || unit.state === 'building';
          if (directDistance > 3 && needsPath) {
            this.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY);
          }
        }
      }

      // If attacking, we need to get the target's position
      if (unit.state === 'attacking' && unit.targetEntityId !== null) {
        const targetEntity = this.world.getEntity(unit.targetEntityId);
        if (targetEntity) {
          const targetTransform = targetEntity.get<Transform>('Transform');
          const targetBuilding = targetEntity.get<Building>('Building');
          if (targetTransform) {
            // For buildings, calculate distance to edge, not center
            let effectiveDistance: number;
            let attackTargetX = targetTransform.x;
            let attackTargetY = targetTransform.y;

            // Flag to force movement when unit needs to escape from inside building
            let needsToEscape = false;

            if (targetBuilding) {
              // Calculate closest point on building edge
              const halfW = targetBuilding.width / 2;
              const halfH = targetBuilding.height / 2;
              const clampedX = Math.max(targetTransform.x - halfW, Math.min(transform.x, targetTransform.x + halfW));
              const clampedY = Math.max(targetTransform.y - halfH, Math.min(transform.y, targetTransform.y + halfH));
              const edgeDx = transform.x - clampedX;
              const edgeDy = transform.y - clampedY;
              effectiveDistance = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

              // Dynamic standoff based on unit's attack range
              // Position at 80% of attack range from building edge
              const standOffDistance = unit.attackRange * 0.8;
              // Minimum safe distance to prevent unit from clipping into building
              const minSafeDistance = unit.collisionRadius + 0.5;

              if (effectiveDistance > minSafeDistance) {
                // Unit is outside - target a position at attack range from building edge
                const dirX = edgeDx / effectiveDistance;
                const dirY = edgeDy / effectiveDistance;
                attackTargetX = clampedX + dirX * standOffDistance;
                attackTargetY = clampedY + dirY * standOffDistance;
              } else {
                // Unit is too close to or inside building - MUST escape first
                needsToEscape = true;
                const awayDx = transform.x - targetTransform.x;
                const awayDy = transform.y - targetTransform.y;
                const awayDist = Math.sqrt(awayDx * awayDx + awayDy * awayDy);
                if (awayDist > 0.1) {
                  // Move to a position outside the building at attack range
                  const escapeDistance = Math.max(halfW, halfH) + standOffDistance + 0.5;
                  attackTargetX = targetTransform.x + (awayDx / awayDist) * escapeDistance;
                  attackTargetY = targetTransform.y + (awayDy / awayDist) * escapeDistance;
                } else {
                  // At center - move to any edge at attack range
                  attackTargetX = targetTransform.x + halfW + standOffDistance + 0.5;
                  attackTargetY = targetTransform.y;
                }
              }
            } else {
              effectiveDistance = transform.distanceTo(targetTransform);
            }

            // Move if out of range OR if unit needs to escape from inside building
            if (effectiveDistance > unit.attackRange || needsToEscape) {
              // Move toward target position (outside building for buildings, near center for units)
              targetX = attackTargetX;
              targetY = attackTargetY;
            } else {
              // In range, stop moving but keep facing target
              transform.rotation = Math.atan2(
                targetTransform.y - transform.y,
                targetTransform.x - transform.x
              );
              // Decelerate
              unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.acceleration * dt * 2);
              velocity.zero();
              continue;
            }
          }
        } else {
          // Target no longer exists - check for queued commands
          if (!unit.executeNextCommand()) {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      if (targetX === null || targetY === null) {
        // No target - check for queued commands
        if (unit.executeNextCommand()) {
          // Queued command executed - request path if it's a move
          if (unit.targetX !== null && unit.targetY !== null) {
            unit.path = [];
            unit.pathIndex = 0;
            this.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY, true);
          }
        } else {
          // Decelerate
          unit.currentSpeed = Math.max(0, unit.currentSpeed - unit.acceleration * dt * 2);
        }
        velocity.zero();
        continue;
      }

      // Calculate direction to target
      const dx = targetX - transform.x;
      const dy = targetY - transform.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if arrived at waypoint
      if (distance < this.arrivalThreshold) {
        if (unit.path.length > 0 && unit.pathIndex < unit.path.length - 1) {
          // Move to next waypoint
          unit.pathIndex++;
        } else if (unit.state === 'patrolling') {
          // Advance to next patrol point and request new path
          unit.nextPatrolPoint();
          unit.path = [];
          unit.pathIndex = 0;
          if (unit.targetX !== null && unit.targetY !== null) {
            this.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY, true);
          }
        } else {
          // Arrived at final destination
          if (unit.state === 'gathering') {
            unit.targetX = null;
            unit.targetY = null;
            velocity.zero();
            continue;
          }

          // Workers building should stay locked to construction site
          if (unit.state === 'building') {
            unit.targetX = null;
            unit.targetY = null;
            unit.currentSpeed = 0;
            velocity.zero();
            continue;
          }

          // Check for queued commands before going idle
          if (unit.executeNextCommand()) {
            // Queued command executed - request path if it's a move
            if (unit.targetX !== null && unit.targetY !== null) {
              unit.path = [];
              unit.pathIndex = 0;
              this.requestPathWithCooldown(entity.id, unit.targetX, unit.targetY, true);
            }
          } else {
            unit.clearTarget();
          }
          velocity.zero();
          continue;
        }
      }

      // Calculate target speed with deceleration near destination
      let targetSpeed = unit.maxSpeed;

      // Apply terrain speed modifier based on current position
      const terrainSpeedMod = this.getTerrainSpeedModifier(transform.x, transform.y, unit.isFlying);
      targetSpeed *= terrainSpeedMod;

      if (distance < this.decelerationThreshold) {
        // Smooth deceleration as we approach target
        targetSpeed = targetSpeed * (distance / this.decelerationThreshold);
        targetSpeed = Math.max(targetSpeed, unit.maxSpeed * terrainSpeedMod * 0.3); // Minimum speed
      }

      // Accelerate or decelerate toward target speed
      if (unit.currentSpeed < targetSpeed) {
        unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + unit.acceleration * dt);
      } else if (unit.currentSpeed > targetSpeed) {
        unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - unit.acceleration * dt * 2);
      }

      // Calculate preferred velocity toward target
      let prefVx = 0;
      let prefVy = 0;
      if (distance > 0.01) {
        prefVx = (dx / distance) * unit.currentSpeed;
        prefVy = (dy / distance) * unit.currentSpeed;
      }

      // Final velocity calculation
      let finalVx = prefVx;
      let finalVy = prefVy;

      // Use RVO/ORCA for local collision avoidance (recast-style)
      if (USE_RVO_AVOIDANCE && distance > this.arrivalThreshold * 2 && !unit.isFlying) {
        // Gathering workers skip RVO (they walk through each other like SC2)
        if (unit.state !== 'gathering') {
          // Get nearby units for ORCA
          const nearbyIds = this.world.unitGrid.queryRadius(
            transform.x,
            transform.y,
            RVO_NEIGHBOR_RADIUS
          );

          const neighbors: Array<{
            x: number;
            y: number;
            vx: number;
            vy: number;
            radius: number;
          }> = [];

          for (const neighborId of nearbyIds) {
            if (neighborId === entity.id) continue;

            const neighborEntity = this.world.getEntity(neighborId);
            if (!neighborEntity) continue;

            const neighborTransform = neighborEntity.get<Transform>('Transform');
            const neighborUnit = neighborEntity.get<Unit>('Unit');
            const neighborVelocity = neighborEntity.get<Velocity>('Velocity');
            if (!neighborTransform || !neighborUnit || !neighborVelocity) continue;

            // Skip dead units
            if (neighborUnit.state === 'dead') continue;

            // Flying units don't collide with ground units
            if (neighborUnit.isFlying !== unit.isFlying) continue;

            // Skip gathering workers (they walk through)
            if (neighborUnit.state === 'gathering') continue;

            neighbors.push({
              x: neighborTransform.x,
              y: neighborTransform.y,
              vx: neighborVelocity.x,
              vy: neighborVelocity.y,
              radius: neighborUnit.collisionRadius,
            });
          }

          // Compute ORCA velocity
          const orcaResult = computeORCAVelocity(
            {
              x: transform.x,
              y: transform.y,
              vx: velocity.x,
              vy: velocity.y,
              prefVx,
              prefVy,
              radius: unit.collisionRadius,
              maxSpeed: unit.currentSpeed,
            },
            neighbors,
            RVO_TIME_HORIZON
          );

          finalVx = orcaResult.vx;
          finalVy = orcaResult.vy;
        }
      } else if (!USE_RVO_AVOIDANCE) {
        // Fallback to simple separation force
        const separationWeight = distance > this.decelerationThreshold ? 0.5 : 0.1;
        if (distance > this.arrivalThreshold * 2) {
          this.calculateSeparationForce(entity.id, transform, unit, tempSeparation);
        } else {
          tempSeparation.x = 0;
          tempSeparation.y = 0;
        }

        // Normalize direction to target
        let dirX = distance > 0.01 ? dx / distance : 0;
        let dirY = distance > 0.01 ? dy / distance : 0;

        // Add separation force to direction (reduced near destination)
        dirX += tempSeparation.x * separationWeight;
        dirY += tempSeparation.y * separationWeight;

        // Re-normalize
        const newMag = Math.sqrt(dirX * dirX + dirY * dirY);
        if (newMag > 0.01) {
          dirX /= newMag;
          dirY /= newMag;
        }

        finalVx = dirX * unit.currentSpeed;
        finalVy = dirY * unit.currentSpeed;
      }

      // Calculate building avoidance (always active, not handled by RVO)
      this.calculateBuildingAvoidanceForce(transform, unit, tempBuildingAvoid);

      // Add building avoidance force
      finalVx += tempBuildingAvoid.x;
      finalVy += tempBuildingAvoid.y;

      // Apply velocity with damping for nearly-stopped units
      // This prevents oscillation/twitching when units are at rest
      const speedDamping = unit.currentSpeed < unit.maxSpeed * 0.2 ? 0.5 : 1.0;
      velocity.x = finalVx * speedDamping;
      velocity.y = finalVy * speedDamping;

      // Update rotation to face movement direction (smooth rotation)
      const targetRotation = Math.atan2(dy, dx);
      const rotationDiff = targetRotation - transform.rotation;

      // Normalize rotation difference to [-PI, PI]
      let normalizedDiff = rotationDiff;
      while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
      while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;

      // Smooth rotation (turn rate based on speed)
      const turnRate = 8 * dt;
      if (Math.abs(normalizedDiff) < turnRate) {
        transform.rotation = targetRotation;
      } else {
        transform.rotation += Math.sign(normalizedDiff) * turnRate;
      }

      // Apply velocity
      transform.translate(velocity.x * dt, velocity.y * dt);

      // Hard collision resolution - push unit out of buildings if overlapping
      if (!unit.isFlying) {
        this.resolveHardBuildingCollision(transform, unit);
      }
    }

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) { // More than one frame at 60fps
      debugPerformance.warn(`[MovementSystem] UPDATE: ${entities.length} entities took ${updateElapsed.toFixed(1)}ms`);
    }
  }

  /**
   * Get terrain speed modifier at a given position.
   * Returns a multiplier for unit movement speed based on terrain features.
   */
  private getTerrainSpeedModifier(x: number, y: number, isFlying: boolean): number {
    // Flying units ignore terrain speed modifiers
    if (isFlying) return 1.0;

    // Get terrain cell at position using Game's method
    const cell = this.game.getTerrainAt(x, y);
    if (!cell) return 1.0;

    // Get feature configuration
    const feature: TerrainFeature = (cell.feature as TerrainFeature) || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    // Flying units can ignore most features
    if (isFlying && config.flyingIgnores) {
      return 1.0;
    }

    return config.speedModifier;
  }

  /**
   * Push unit out of any building they're overlapping with.
   * This is a hard collision resolution that runs after movement.
   */
  private resolveHardBuildingCollision(transform: Transform, unit: Unit): void {
    const nearbyBuildingIds = this.world.buildingGrid.queryRadius(
      transform.x,
      transform.y,
      unit.collisionRadius + 8 // Increased range for large buildings
    );

    // Resource drop-off buildings - workers carrying resources skip collision for these
    const dropOffBuildings = [
      'headquarters', 'orbital_station', 'bastion',
      'nexus', 'hatchery', 'lair', 'hive'
    ];
    const isCarryingResources = unit.isWorker &&
      (unit.carryingMinerals > 0 || unit.carryingVespene > 0);

    for (const buildingId of nearbyBuildingIds) {
      // Skip the building this worker is constructing - they need to be at it
      if (unit.constructingBuildingId === buildingId) {
        continue;
      }

      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const buildingTransform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!buildingTransform || !building) continue;

      // Skip drop-off buildings for workers carrying resources
      if (isCarryingResources && dropOffBuildings.includes(building.buildingId)) {
        continue;
      }

      // Check if unit is inside building bounds - use tighter collision
      // Building collision radius = actual building size + small margin
      const collisionMargin = 0.5; // Small margin to prevent units from touching buildings
      const halfWidth = building.width / 2 + collisionMargin;
      const halfHeight = building.height / 2 + collisionMargin;

      const dx = transform.x - buildingTransform.x;
      const dy = transform.y - buildingTransform.y;

      if (Math.abs(dx) < halfWidth && Math.abs(dy) < halfHeight) {
        // Unit is inside building - push them out immediately
        // Find the shortest escape direction
        const escapeLeft = -(halfWidth + dx);  // Distance to left edge
        const escapeRight = halfWidth - dx;     // Distance to right edge
        const escapeUp = -(halfHeight + dy);    // Distance to top edge
        const escapeDown = halfHeight - dy;     // Distance to bottom edge

        // Find minimum absolute escape distance
        const escapeX = Math.abs(escapeLeft) < Math.abs(escapeRight) ? escapeLeft : escapeRight;
        const escapeY = Math.abs(escapeUp) < Math.abs(escapeDown) ? escapeUp : escapeDown;

        // Push in the direction requiring least movement + extra buffer
        if (Math.abs(escapeX) < Math.abs(escapeY)) {
          transform.x += escapeX + (escapeX > 0 ? 0.2 : -0.2);
        } else {
          transform.y += escapeY + (escapeY > 0 ? 0.2 : -0.2);
        }
      }
    }
  }
}
